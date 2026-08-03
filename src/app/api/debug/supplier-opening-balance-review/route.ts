import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireFounder } from '@/lib/debug-auth'
import { apiError } from '@/lib/api-error'

/**
 * GET /api/debug/supplier-opening-balance-review
 *
 * 🔒 V-2 data-repair review (read-only, founder-only).
 *
 * WHY THIS EXISTS
 * ---------------
 * The V-2 audit found that supplier opening balances were stored with the
 * WRONG sign before the V-2 fix. The convention is "positive = they owe us",
 * but the add-party form's placeholder hint ("positive = they owe you") made
 * it easy for a shopkeeper adding a supplier they owe ₹7,410 to type `7410`,
 * which the app then booked as the supplier owing THEM ₹7,410.
 *
 * The fix (Parties.tsx:416) negates the input for new supplier entries:
 *   `openingBalance = form.type === 'supplier' ? -Math.abs(rawOpening) : rawOpening`
 *
 * But that fix only affects NEW rows. EXISTING supplier rows with positive
 * openingBalance (created before the fix) still display "they owe you" when
 * you actually owe them. Mahalaxmi in the live data is one such example.
 *
 * This endpoint LISTS those rows for manual review. It does NOT auto-flip —
 * genuine advances to suppliers exist (you pay them first, they owe you), so
 * a blanket `UPDATE ... SET openingBalance = -openingBalance WHERE type='supplier'
 * AND openingBalance > 0` would corrupt legitimate data.
 *
 * The shopkeeper reviews each row and decides:
 *   - If the positive balance is a genuine advance → leave it alone.
 *   - If the positive balance is a sign error → use the per-row flip endpoint
 *     (POST /api/debug/supplier-opening-balance-review with { partyId }).
 *
 * WHAT IT RETURNS
 * ---------------
 *   {
 *     suspectCount: number,
 *     rows: [{
 *       id, name, phone, type, openingBalancePaise, openingBalanceRupees,
 *       purchaseTotalRupees, purchasePaidRupees, currentBalanceRupees,
 *       recommendation: 'review' | 'genuine-advance',
 *       reason: string,
 *     }]
 *   }
 *
 * A row is flagged `recommendation: 'review'` when:
 *   - The supplier has positive openingBalance, AND
 *   - They have NO purchases recorded (you've never bought from them) — a
 *     genuine advance usually corresponds to a real supplier relationship.
 *
 * A row is flagged `recommendation: 'genuine-advance'` when:
 *   - The supplier has positive openingBalance, AND
 *   - They have purchases recorded (consistent with a real supplier you've
 *     paid in advance).
 *
 * Either way the shopkeeper makes the final call.
 */

export const maxDuration = 30

export async function GET(req: Request) {
  try {
    /*
     * 🔒 AUTHENTICATION BYPASS + CROSS-TENANT LEAK (fixed 2026-08-03, Phase 5).
     *
     * This was:
     *
     *     if (!(await requireFounder())) { return 403 }
     *
     * `requireFounder()` returns `{ userId } | { error: NextResponse }` — an
     * OBJECT either way, and every object is truthy. So `!result` was always
     * false and the 403 was unreachable. The gate did nothing.
     *
     * Combined with a `findMany` carrying no `userId`, ANY authenticated user
     * could read every party in every shop that had a positive opening
     * balance — names, PHONE NUMBERS, balances and the owning userId. The POST
     * below then let them flip any of those balances.
     *
     * Every other debug route in this codebase already uses the correct
     * `if ('error' in x) return x.error`. This file was the only one that did
     * not, which is exactly why a type-level mistake survived: it looked like
     * the others at a glance.
     *
     * Now: the real gate, PLUS an explicit target shop. That second part
     * follows the precedent set in debug/repair-headers, whose own comment
     * reads "Cross-user scans are not allowed." — the same reasoning applies
     * here and simply had not been carried across.
     */
    const gate = await requireFounder()
    if ('error' in gate) return gate.error

    const targetUserId = new URL(req.url).searchParams.get('userId')
    if (!targetUserId) {
      return NextResponse.json({
        error: 'userId query parameter is required',
        message: 'Pass ?userId=<id> to scope the review to one shop. Cross-user scans are not allowed.',
      }, { status: 400 })
    }

    // Find every supplier with a positive opening balance. The money extension
    // converts paise → rupees on read, so openingBalance is in RUPEES here.
    // We include `type: 'both'` parties too — they may also have a sign error.
    const suspectParties = await db.party.findMany({
      where: {
        userId: targetUserId,
        OR: [
          { type: 'supplier' },
          { type: 'both' },
        ],
        openingBalance: { gt: 0 },
        deletedAt: null,
      },
      orderBy: { openingBalance: 'desc' },
      select: {
        id: true,
        name: true,
        phone: true,
        type: true,
        openingBalance: true,
        createdAt: true,
        userId: true,
      },
    })

    // For each suspect, fetch their purchase activity so the shopkeeper can
    // tell a sign error (no purchases, but positive opening) from a genuine
    // advance (has purchases, positive opening = prepaid).
    const rows = await Promise.all(
      suspectParties.map(async (p) => {
        const purchaseAgg = await db.transaction.aggregate({
          where: {
            userId: p.userId,
            partyId: p.id,
            type: 'purchase',
            deletedAt: null,
          },
          _sum: { totalAmount: true, paidAmount: true },
          _count: true,
        })
        const purchaseTotalRupees = purchaseAgg._sum.totalAmount ?? 0
        const purchasePaidRupees = purchaseAgg._sum.paidAmount ?? 0
        const purchaseCount = purchaseAgg._count
        // p.openingBalance is already in RUPEES — the money extension's read
        // converter (prisma-money-extension.ts) converts paise → rupees on read.
        const openingBalanceRupees = p.openingBalance ?? 0

        const recommendation =
          purchaseCount === 0
            ? ('review' as const)
            : ('genuine-advance' as const)

        const reason =
          purchaseCount === 0
            ? 'Positive opening balance but no purchases on record — likely a sign error. The supplier was probably added with the wrong direction.'
            : `Has ${purchaseCount} purchases on record — could be a genuine advance, or a sign error on top of real activity. Review manually.`

        return {
          id: p.id,
          name: p.name,
          phone: p.phone,
          type: p.type,
          openingBalanceRupees,
          purchaseTotalRupees,
          purchasePaidRupees,
          purchaseCount,
          currentBalanceRupees: openingBalanceRupees + purchaseTotalRupees - purchasePaidRupees,
          recommendation,
          reason,
          createdAt: p.createdAt,
        }
      })
    )

    return NextResponse.json({
      suspectCount: rows.length,
      rows,
      // The shopkeeper's manual action: for each `review` row, decide whether
      // to flip the sign. The flip endpoint is POST below.
      instructions:
        'Review each row. If the positive opening balance is a sign error (you actually owe them), POST to this endpoint with { partyId } to flip the sign. If it is a genuine advance, no action needed.',
    })
  } catch (error) {
    return apiError(error, 'Failed to load supplier opening-balance review')
  }
}

/**
 * POST /api/debug/supplier-opening-balance-review
 * Body: { partyId: string }
 *
 * Flips the sign of one supplier's openingBalance (positive → negative).
 * Use ONLY after manual review via the GET endpoint above.
 *
 * Returns the updated openingBalance (in rupees).
 */
export async function POST(req: Request) {
  try {
    /*
     * 🔒 Same bypass as the GET above — `!(await requireFounder())` was always
     * false, so this endpoint was reachable by ANY authenticated user, and it
     * WRITES: it flips the sign of a party's opening balance, which directly
     * changes what a supplier is owed.
     *
     * `userId` is now required and the lookup is scoped by it, so a partyId
     * belonging to another shop 404s instead of being silently edited. Without
     * that, even a legitimate founder fixing a typo could flip the wrong
     * shop's supplier and the route could not tell.
     */
    const gate = await requireFounder()
    if ('error' in gate) return gate.error

    const body = await req.json()
    const { partyId, userId: targetUserId } = body
    if (!partyId || typeof partyId !== 'string') {
      return NextResponse.json({ error: 'partyId is required' }, { status: 400 })
    }
    if (!targetUserId || typeof targetUserId !== 'string') {
      return NextResponse.json({
        error: 'userId is required',
        message: 'Pass the owning shop\'s userId so the party can be verified before it is modified.',
      }, { status: 400 })
    }

    // Lock the operation to supplier/both parties with a POSITIVE opening.
    // Refuses to flip negative or zero openings, or non-supplier parties.
    const party = await db.party.findFirst({
      where: { id: partyId, userId: targetUserId, deletedAt: null },
      select: { id: true, type: true, openingBalance: true, name: true },
    })
    if (!party) {
      return NextResponse.json({ error: 'Party not found' }, { status: 404 })
    }
    if (party.type !== 'supplier' && party.type !== 'both') {
      return NextResponse.json({ error: `Refusing to flip: party type is "${party.type}", not "supplier" or "both".` }, { status: 400 })
    }
    if (party.openingBalance === null || party.openingBalance <= 0) {
      return NextResponse.json({ error: `Refusing to flip: openingBalance is ${party.openingBalance ?? 'null'}, not positive.` }, { status: 400 })
    }

    // Flip the sign. The money extension's write converter will toPaise() the
    // negated rupee value, so the stored column becomes -|paise| as intended.
    const newOpening = -party.openingBalance
    await db.party.update({
      where: { id: partyId },
      data: { openingBalance: newOpening },
    })

    return NextResponse.json({
      ok: true,
      partyId,
      partyName: party.name,
      previousOpeningBalanceRupees: party.openingBalance,
      newOpeningBalanceRupees: newOpening,
      message: `Flipped ${party.name}'s opening balance from ₹${party.openingBalance} to ₹${newOpening}. The supplier now correctly shows as "you owe them".`,
    })
  } catch (error) {
    return apiError(error, 'Failed to flip supplier opening balance')
  }
}
