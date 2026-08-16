import { NextRequest, NextResponse } from 'next/server'
import { findDuplicateParty, duplicatePartyMessage, duplicatePartyFieldError } from '@/lib/party-duplicate'
import { db, withConnectionRetry } from '@/lib/db'
import { getAuthUserIdWithModule, getAuthContextForWrite } from '@/lib/get-auth'
import { withCache, noStore } from '@/lib/cache'
import { roundMoney } from '@/lib/money'
import { apiError } from '@/lib/api-error'
import { getReceivablePayable } from '@/lib/party-balance'
import { validateBody, createPartySchema } from '@/lib/validation'
import { findUnknownFields, schemaFields } from '@/lib/unknown-fields'
import { buildCustomValues, CustomFieldError } from '@/lib/custom-fields-server'

export async function GET() {
  try {
    const { userId, error } = await getAuthUserIdWithModule('parties')
    if (error || !userId) return error || NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    // ⚡ PERFORMANCE (Audit fix Phase 3.2): Compute balances with SQL aggregates
    // instead of loading every transaction into memory and reducing in JS.
    //
    // 🔒 V7 H2: Was doing its own groupBy aggregates WITHOUT filtering
    // deletedAt: null — so soft-deleted sales still inflated party-list
    // balances. Now uses the shared getReceivablePayable() helper which
    // filters deletedAt: null correctly. This is the SAME bug as V5-HA
    // (fixed in parties/[id] but not here). Now fixed.
    //
    // 🔒 V7 H4: Was returning { parties: [] } with HTTP 200 on DB error —
    // the user saw an empty ledger during a blip. Now returns 503 so the
    // UI shows a retry state.
    //
    // 🔒 V7 L7: Removed duplicated console.error.
    // 🔒 V26 R15 (Phase 5): Wrapped in withConnectionRetry — Neon cold-start
    // pool timeouts surface as raw 500s on the first tap after idle. Was: only
    // the dashboard had the retry wrapper.
    /*
     * 🔒 #71: THE FUSE STAYS. THE SILENCE DOES NOT.
     *
     * `take: 5000` is a deliberate fuse, and removing it would be the wrong
     * fix — loading 50,000 parties onto a phone is a worse app, not a better
     * one. What was wrong is that the shop was never TOLD. Party 5,001 simply
     * did not exist, on this screen and in everything that reads it.
     *
     * So the true count comes back beside the rows, and the client can say
     * "showing 5,000 of 6,200 — use search". A cap that is declared is a
     * design decision; a cap that is hidden is a lie with a number on it.
     */
    const parties = await withConnectionRetry(() => db.party.findMany({
      where: { userId, deletedAt: null },
      orderBy: { name: 'asc' },
      take: 5000,
      select: {
        id: true,
        name: true,
        type: true,
        phone: true,
        email: true,
        gstin: true,
        address: true,
        state: true,
        openingBalance: true,
        createdAt: true,
        updatedAt: true,
        shopId: true,
      },
    }))

    if (parties.length === 0) {
      // 🔒 AUDIT V25 FIX BUG-031 (Batch 5): Was withCache({ maxAge: 60, swr: 300 }).
      // Money-bearing endpoint — stale party balances for up to 60s after a
      // return/payment erode trust. Now noStore (always fresh).
      return noStore({ parties: [] })
    }

    // 🔒 V7 H1+H2: Use the shared helper. This computes balances with
    // deletedAt: null filtering AND gives us receivable/payable totals.
    // One call, three benefits: correct balances, soft-delete filtering,
    // and consistency with the dashboard.
    const { partyBalances } = await getReceivablePayable(userId)

    // Attach balance + transactionCount to each party using the helper's results
    const partiesWithBalance = parties.map(p => {
      const balanceInfo = partyBalances.get(p.id) || {
        balance: p.openingBalance,  // fallback to opening balance if no transactions
        salesOutstanding: 0,
        purchaseOutstanding: 0,
        transactionCount: 0,
      }
      return {
        ...p,
        balance: balanceInfo.balance,
        transactionCount: balanceInfo.transactionCount,
        // positive = they owe us (receivable); negative = we owe them (payable)
        isReceivable: balanceInfo.balance > 0,
      }
    })

    // 🔒 AUDIT V25 FIX BUG-031 (Batch 5): Was withCache({ maxAge: 60, swr: 300 }).
    // Money-bearing endpoint — party balances + receivable/payable totals must
    // always be fresh. A shopkeeper who just recorded a ₹700 credit note (after
    // a ₹1,000 sale) would see the stale ₹1,000 balance for up to 60s while the
    // browser HTTP cache served the old response. Now noStore (always fresh).
    // React-query invalidation still refetches after a mutation; this fix ensures
    // the refetch actually hits the server instead of returning the cached 200.
    // The true number, so nothing on screen can imply the list is all of it.
    const totalParties = await db.party.count({ where: { userId, deletedAt: null } })
    return noStore({
      parties: partiesWithBalance,
      total: totalParties,
      truncated: totalParties > parties.length,
    })
  } catch (error) {
    // 🔒 V11 §4.2: Use apiError() for consistent errorId logging.
    return apiError(error, 'Failed to load parties. The database might be warming up — please retry.', 503)
  }
}

export async function POST(req: NextRequest) {
  try {
    // 🔒 V17-Ext Tier 3 Step 3: Use getAuthContextForWrite — combines module
    // check ('parties') + write block (CA = read-only). Was: getAuthUserIdWithModule
    // which allowed CAs to create parties (read-only bypass).
    const authCtx = await getAuthContextForWrite('parties')
    if (authCtx.error || !authCtx.userId) return authCtx.error || NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const userId = authCtx.userId

    const body = await req.json()

    // 🔒 V17-Ext §2.3: Validate with zod before touching the DB.
    // WAS: `parseFloat(body.openingBalance) || 0` — silently turned a typo
    // like "abc" into ₹0 opening balance (a real money value) with no error.
    // Now: zod rejects non-numeric input with a clear 400 error.
    // Same pattern as transactions POST and products POST.
    const unknownFields = findUnknownFields(body, schemaFields(createPartySchema))
    if (unknownFields) {
      return NextResponse.json({
        error: 'Unknown field',
        message: unknownFields.message,
        unknownFields: unknownFields.unknown,
        suggestions: unknownFields.suggestions,
      }, { status: 400 })
    }

    const validation = validateBody(createPartySchema, body)
    if (!validation.success) {
      return NextResponse.json({ error: 'Validation failed', detail: validation.error }, { status: 400 })
    }

    const { name, type, phone, email, gstin, address, state, openingBalance } = validation.data as any

    /*
     * 🔒 DUPLICATE PARTY BLOCK (2026-08-03, reported by Rahul).
     *
     * Two ledgers for one real person split their dues, so the outstanding
     * shown is only part of what is owed and a payment settles bills on one
     * while the other keeps chasing. It never appears as an error — it appears
     * as a customer being asked for money they already paid.
     *
     * A hard block is what Tally, QuickBooks, Zoho Books, Xero and Vyapar all
     * do with contact/ledger names. Two genuine same-name customers are still
     * recordable by distinguishing them, which is what makes the ledger
     * readable later. See src/lib/party-duplicate.ts for the full reasoning.
     */
    const duplicate = await findDuplicateParty(userId, { name, phone })
    if (duplicate) {
      return NextResponse.json(
        {
          error: duplicatePartyMessage(duplicate),
          code: 'DUPLICATE_PARTY',
          field: duplicate.field,
          // Short text for the line under the field. `error` keeps the full
          // reason, for surfaces with room (offline sync, API consumers).
          fieldError: duplicatePartyFieldError(duplicate),
          existingParty: duplicate.party,
        },
        { status: 409 },
      )
    }

    // 📄 Phase 5 — the shop's own fields on this customer. Same helper the
    // bill uses, so the two cannot disagree about a required field.
    let partyCustomFields: unknown = null
    try {
      partyCustomFields = await buildCustomValues(userId, 'party', (validation.data as any).customFields)
    } catch (e) {
      if (e instanceof CustomFieldError) {
        return NextResponse.json({ error: 'Validation failed', message: e.message }, { status: 400 })
      }
      throw e
    }

    const party = await db.party.create({
      data: {
        userId,
        name,
        type: type || 'customer',
        phone: phone || null,
        email: email || null,
        gstin: gstin || null,
        address: address || null,
        state: state || null,
        openingBalance: roundMoney(openingBalance || 0),
        customFields: partyCustomFields as any,
      },
    })
    return NextResponse.json({ party })
  } catch (error) {
    return apiError(error, 'Failed to create party', 500)
  }
}
