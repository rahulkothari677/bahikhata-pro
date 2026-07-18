import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getAuthContext } from '@/lib/get-auth'
import { computePartyBalance, getReceivablePayable } from '@/lib/party-balance'
import { roundMoney, fromPaise } from '@/lib/money'
import { apiError } from '@/lib/api-error'

/**
 * GET /api/debug/party-balance-detail?partyId=<id>
 *
 * V26 M11 deep diagnostic: for a single party, show the FULL breakdown of
 * both balance-computation paths (computePartyBalance = Prisma managed
 * aggregate; getReceivablePayable = raw $queryRaw) side-by-side, plus every
 * raw transaction/payment row, plus a NULL-value scan + stale-data detection.
 *
 * Purpose: when the two paths disagree (the auditor's M11 finding — e.g.
 * Anita Singh diverged by ₹990 on Neon), this endpoint tells you EXACTLY
 * which component differs and which raw rows are responsible. It answers:
 *   - Is this a LIVE code bug (fresh data would reproduce)?
 *   - Or STALE DATA from before a prior fix (e.g. V24 §1 paidAmount default)?
 *
 * Auth: owner only.
 *
 * Response shape:
 *   {
 *     party: { id, name, phone, gstin, openingBalance, createdAt, updatedAt },
 *     detail: { ...computePartyBalance output... },
 *     list: { ...getReceivablePayable output for THIS party only... },
 *     difference: { balance: number, whichIsHigher: 'detail' | 'list' | 'equal' },
 *     rawTransactions: [ { id, type, date, totalAmount, paidAmount, deletedAt, originalTransactionId, affectsStock, ... } ],
 *     rawPayments: [ { id, type, date, amount, deletedAt, ... } ],
 *     dataQuality: {
 *       nullPaidAmountCount: number,        // transactions with NULL paidAmount
 *       nullPaidAmountRows: [...],          // the actual rows
 *       deletedButLinkedCount: number,      // notes pointing to deleted originals
 *       staleNotePaidAmountCount: number,   // notes with paidAmount = totalAmount (pre-V24-§1 default)
 *       staleNotePaidAmountRows: [...],
 *       orphanedNotesCount: number,         // notes with no originalTransactionId
 *     },
 *     componentComparison: {
 *       openingBalance: { detail, list, diff },
 *       salesOutstanding: { detail, list, diff },
 *       purchaseOutstanding: { detail, list, diff },
 *       creditNoteOutstanding: { detail, list, diff },
 *       debitNoteOutstanding: { detail, list, diff },
 *       paymentsReceived: { detail, list, diff },
 *       paymentsPaid: { detail, list, diff },
 *     },
 *     interpretation: string  // human-readable root-cause analysis
 *   }
 */
export const maxDuration = 60

export async function GET(req: NextRequest) {
  try {
    const authCtx = await getAuthContext()
    if (authCtx.error || !authCtx.userId) {
      return authCtx.error || NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    if (authCtx.role !== 'owner') {
      return NextResponse.json({ error: 'Owner only' }, { status: 403 })
    }
    const userId = authCtx.userId

    const { searchParams } = new URL(req.url)
    const partyId = searchParams.get('partyId')
    if (!partyId) {
      return NextResponse.json({ error: 'partyId query param is required' }, { status: 400 })
    }

    // ─── Verify party exists + belongs to this user ──────────────────────
    const party = await db.party.findFirst({
      where: { id: partyId, userId, deletedAt: null },
      select: {
        id: true, name: true, phone: true, gstin: true,
        openingBalance: true, createdAt: true, updatedAt: true,
        deletedAt: true,
      },
    })
    if (!party) {
      return NextResponse.json({ error: 'Party not found' }, { status: 404 })
    }

    // ─── Path 1: computePartyBalance (Prisma managed aggregate) ─────────
    const detail = await computePartyBalance(userId, partyId)

    // ─── Path 2: getReceivablePayable (raw $queryRaw) ────────────────────
    // This returns ALL parties; we extract just this one.
    const listAll = await getReceivablePayable(userId)
    const listEntry = listAll.partyBalances.get(partyId)
    const list = listEntry
      ? {
          balance: listEntry.balance,
          salesOutstanding: listEntry.salesOutstanding,
          purchaseOutstanding: listEntry.purchaseOutstanding,
          // getReceivablePayable doesn't return these separately, but we can
          // re-derive them from the raw SQL below for comparison.
          creditNoteOutstanding: 0, // placeholder — filled from raw SQL below
          debitNoteOutstanding: 0,  // placeholder
          paymentsReceived: 0,     // placeholder
          paymentsPaid: 0,         // placeholder
        }
      : null

    // ─── Raw rows: every transaction for this party ─────────────────────
    // Include deleted ones (with deletedAt) so we can spot stale/orphaned data.
    const rawTransactions = await db.transaction.findMany({
      where: { userId, partyId },  // intentionally NOT filtering deletedAt — show all
      select: {
        id: true, type: true, invoiceNo: true, date: true,
        subtotal: true, discountAmount: true,
        totalAmount: true, paidAmount: true,
        cgst: true, sgst: true, igst: true,
        isInterState: true, isReverseCharge: true,
        grossProfit: true, paymentMode: true,
        originalTransactionId: true, noteType: true, noteReason: true,
        affectsStock: true, roundOff: true,
        deletedAt: true, createdAt: true, updatedAt: true,
      },
      orderBy: { date: 'asc' },
    })

    // ─── Raw rows: every payment for this party ─────────────────────────
    const rawPayments = await db.payment.findMany({
      where: { userId, partyId },  // intentionally NOT filtering deletedAt
      select: {
        id: true, type: true, date: true, amount: true,
        mode: true, notes: true, clientMutationId: true,
        deletedAt: true, createdAt: true,
      },
      orderBy: { date: 'asc' },
    })

    // ─── Data-quality scan: NULLs, stale defaults, orphaned notes ───────
    // 1. NULL paidAmount on transactions (should never happen — schema has
    //    @default(0) — but legacy data could have it).
    const nullPaidAmountRows = rawTransactions.filter(
      t => t.paidAmount === null || t.paidAmount === undefined,
    )
    // 2. Notes (credit-note/debit-note) with paidAmount = totalAmount.
    //    This is the pre-V24-§1 default — a note created before that fix with
    //    a missing paidAmount was stored as totalAmount ("fully cash refunded")
    //    instead of the correct 0 ("khata adjustment"). These stale records
    //    make the party balance look wrong until repaired.
    const staleNotePaidAmountRows = rawTransactions.filter(
      t => (t.type === 'credit-note' || t.type === 'debit-note')
        && t.paidAmount !== null
        && t.paidAmount === t.totalAmount
        && t.totalAmount > 0,
    )
    // 3. Notes pointing to a deleted original transaction.
    const originalIds = rawTransactions
      .filter(t => t.originalTransactionId)
      .map(t => t.originalTransactionId as string)
    const deletedOriginals = originalIds.length > 0
      ? await db.transaction.findMany({
          where: { id: { in: originalIds }, deletedAt: { not: null } },
          select: { id: true, type: true, deletedAt: true },
        })
      : []
    const deletedButLinkedCount = deletedOriginals.length
    // 4. Orphaned notes: notes with no originalTransactionId at all.
    const orphanedNotesCount = rawTransactions.filter(
      t => (t.type === 'credit-note' || t.type === 'debit-note')
        && !t.originalTransactionId,
    ).length

    // ─── Component-by-component comparison ──────────────────────────────
    // Re-run the raw SQL for THIS party only, to get the per-component
    // breakdown from the getReceivablePayable path (which normally only
    // returns balance + salesOutstanding + purchaseOutstanding).
    const listComponents = await db.$queryRaw<Array<{
      salesOutstandingPaise: string
      purchaseOutstandingPaise: string
      creditNoteOutstandingPaise: string
      debitNoteOutstandingPaise: string
      paymentsReceivedPaise: string
      paymentsPaidPaise: string
    }>>`
      SELECT
        COALESCE(SUM(CASE WHEN "type" = 'sale' THEN ("totalAmount" - "paidAmount")::numeric ELSE 0 END), 0) AS "salesOutstandingPaise",
        COALESCE(SUM(CASE WHEN "type" = 'purchase' THEN ("totalAmount" - "paidAmount")::numeric ELSE 0 END), 0) AS "purchaseOutstandingPaise",
        COALESCE(SUM(CASE WHEN "type" = 'credit-note' THEN ("totalAmount" - "paidAmount")::numeric ELSE 0 END), 0) AS "creditNoteOutstandingPaise",
        COALESCE(SUM(CASE WHEN "type" = 'debit-note' THEN ("totalAmount" - "paidAmount")::numeric ELSE 0 END), 0) AS "debitNoteOutstandingPaise",
        COALESCE((SELECT SUM("amount") FROM "Payment" WHERE "partyId" = ${partyId} AND "userId" = ${userId} AND "deletedAt" IS NULL AND "type" = 'received'), 0) AS "paymentsReceivedPaise",
        COALESCE((SELECT SUM("amount") FROM "Payment" WHERE "partyId" = ${partyId} AND "userId" = ${userId} AND "deletedAt" IS NULL AND "type" = 'paid'), 0) AS "paymentsPaidPaise"
      FROM "Transaction"
      WHERE "userId" = ${userId}
        AND "partyId" = ${partyId}
        AND "deletedAt" IS NULL
    `
    const lc = listComponents[0] || {
      salesOutstandingPaise: '0', purchaseOutstandingPaise: '0',
      creditNoteOutstandingPaise: '0', debitNoteOutstandingPaise: '0',
      paymentsReceivedPaise: '0', paymentsPaidPaise: '0',
    }

    const listBreakdown = {
      openingBalance: fromPaise(party.openingBalance),
      salesOutstanding: fromPaise(Number(lc.salesOutstandingPaise)),
      purchaseOutstanding: fromPaise(Number(lc.purchaseOutstandingPaise)),
      creditNoteOutstanding: fromPaise(Number(lc.creditNoteOutstandingPaise)),
      debitNoteOutstanding: fromPaise(Number(lc.debitNoteOutstandingPaise)),
      paymentsReceived: fromPaise(Number(lc.paymentsReceivedPaise)),
      paymentsPaid: fromPaise(Number(lc.paymentsPaidPaise)),
    }

    const componentComparison = {
      openingBalance: {
        detail: fromPaise(party.openingBalance),
        list: listBreakdown.openingBalance,
        diff: roundMoney(fromPaise(party.openingBalance) - listBreakdown.openingBalance),
      },
      salesOutstanding: {
        detail: detail.salesOutstanding,
        list: listBreakdown.salesOutstanding,
        diff: roundMoney(detail.salesOutstanding - listBreakdown.salesOutstanding),
      },
      purchaseOutstanding: {
        detail: detail.purchaseOutstanding,
        list: listBreakdown.purchaseOutstanding,
        diff: roundMoney(detail.purchaseOutstanding - listBreakdown.purchaseOutstanding),
      },
      creditNoteOutstanding: {
        detail: detail.creditNoteOutstanding,
        list: listBreakdown.creditNoteOutstanding,
        diff: roundMoney(detail.creditNoteOutstanding - listBreakdown.creditNoteOutstanding),
      },
      debitNoteOutstanding: {
        detail: detail.debitNoteOutstanding,
        list: listBreakdown.debitNoteOutstanding,
        diff: roundMoney(detail.debitNoteOutstanding - listBreakdown.debitNoteOutstanding),
      },
      paymentsReceived: {
        detail: detail.paymentsReceived,
        list: listBreakdown.paymentsReceived,
        diff: roundMoney(detail.paymentsReceived - listBreakdown.paymentsReceived),
      },
      paymentsPaid: {
        detail: detail.paymentsPaid,
        list: listBreakdown.paymentsPaid,
        diff: roundMoney(detail.paymentsPaid - listBreakdown.paymentsPaid),
      },
    }

    // ─── Difference + interpretation ────────────────────────────────────
    const detailBalance = detail.balance
    const listBalance = listEntry?.balance ?? 0
    const balanceDiff = roundMoney(detailBalance - listBalance)

    let interpretation = ''
    if (Math.abs(balanceDiff) < 0.01) {
      interpretation = '✅ Both paths agree — no divergence for this party. The M11 issue is NOT reproducible for this party at this time.'
    } else {
      // Find which component(s) differ
      const differingComponents = Object.entries(componentComparison)
        .filter(([_, v]) => Math.abs((v as any).diff) >= 0.01)
        .map(([k, v]) => `${k} (detail: ₹${(v as any).detail}, list: ₹${(v as any).list}, diff: ₹${(v as any).diff})`)

      interpretation = `❌ DIVERGENCE: detail (computePartyBalance) = ₹${detailBalance}, list (getReceivablePayable) = ₹${listBalance}, difference = ₹${balanceDiff}.\n\nDiffering component(s): ${differingComponents.join('; ')}.\n\n`

      if (nullPaidAmountRows.length > 0) {
        interpretation += `\n⚠️ FOUND ${nullPaidAmountRows.length} transaction(s) with NULL paidAmount — this is the likely root cause. SQL's (totalAmount - NULL) = NULL, which SUM skips entirely, while Prisma's _sum returns null which JS coerces to 0. This produces a deterministic divergence equal to the totalAmount of the NULL-paidAmount row(s). Affected row(s): ${nullPaidAmountRows.map(r => `${r.id} (${r.type}, ₹${fromPaise(r.totalAmount)})`).join(', ')}.`
      } else if (staleNotePaidAmountRows.length > 0) {
        interpretation += `\n⚠️ FOUND ${staleNotePaidAmountRows.length} note(s) with paidAmount = totalAmount (the pre-V24-§1 stale default). These were likely created before the V24 §1 fix (which changed the note paidAmount default from totalAmount to 0). Both balance functions read the same stale value from DB, so this would NOT cause a divergence BETWEEN the two functions — but it DOES mean the balance itself is wrong (the note is treated as 'fully cash refunded' instead of 'khata adjustment'). Repair: set paidAmount = 0 on these notes. Affected row(s): ${staleNotePaidAmountRows.map(r => `${r.id} (${r.type}, total ₹${fromPaise(r.totalAmount)}, paid ₹${fromPaise(r.paidAmount!)})`).join(', ')}.`
      } else if (deletedButLinkedCount > 0) {
        interpretation += `\n⚠️ FOUND ${deletedButLinkedCount} note(s) pointing to a DELETED original transaction. The note's originalTransactionId references a transaction that has been soft-deleted. This shouldn't cause a divergence between the two balance functions (both filter on the NOTE's deletedAt, not the original's), but it's a data-integrity issue worth cleaning up.`
      } else if (differingComponents.length > 0) {
        interpretation += `\n🔍 No NULL paidAmount, no stale note defaults, no orphaned notes found — but the component(s) above still differ. This suggests a SUBTLE SQL-vs-Prisma difference (possibly float-precision or GROUP BY edge case). Send this full response to the developer for deeper investigation.`
      }
    }

    return NextResponse.json({
      party: {
        ...party,
        openingBalancePaise: party.openingBalance,
        openingBalanceRupees: fromPaise(party.openingBalance),
      },
      detail: {
        balance: detailBalance,
        salesOutstanding: detail.salesOutstanding,
        purchaseOutstanding: detail.purchaseOutstanding,
        creditNoteOutstanding: detail.creditNoteOutstanding,
        debitNoteOutstanding: detail.debitNoteOutstanding,
        totalSales: detail.totalSales,
        totalPurchases: detail.totalPurchases,
        totalReceived: detail.totalReceived,
        totalPaid: detail.totalPaid,
        paymentsReceived: detail.paymentsReceived,
        paymentsPaid: detail.paymentsPaid,
      },
      list: listEntry ? {
        balance: listBalance,
        salesOutstanding: listEntry.salesOutstanding,
        purchaseOutstanding: listEntry.purchaseOutstanding,
        transactionCount: listEntry.transactionCount,
      } : null,
      listBreakdown,
      difference: {
        balance: balanceDiff,
        whichIsHigher: balanceDiff > 0.01 ? 'detail' : balanceDiff < -0.01 ? 'list' : 'equal',
      },
      rawTransactions: rawTransactions.map(t => ({
        ...t,
        totalAmountRupees: fromPaise(t.totalAmount),
        paidAmountRupees: t.paidAmount === null ? null : fromPaise(t.paidAmount),
        subtotalRupees: fromPaise(t.subtotal),
        discountAmountRupees: fromPaise(t.discountAmount),
        isStaleNoteDefault: (t.type === 'credit-note' || t.type === 'debit-note')
          && t.paidAmount !== null
          && t.paidAmount === t.totalAmount
          && t.totalAmount > 0,
      })),
      rawPayments: rawPayments.map(p => ({
        ...p,
        amountRupees: fromPaise(p.amount),
      })),
      dataQuality: {
        nullPaidAmountCount: nullPaidAmountRows.length,
        nullPaidAmountRows: nullPaidAmountRows.map(r => ({
          id: r.id, type: r.type, invoiceNo: r.invoiceNo,
          totalAmountPaise: r.totalAmount, paidAmount: r.paidAmount,
          deletedAt: r.deletedAt, createdAt: r.createdAt,
        })),
        staleNotePaidAmountCount: staleNotePaidAmountRows.length,
        staleNotePaidAmountRows: staleNotePaidAmountRows.map(r => ({
          id: r.id, type: r.type, invoiceNo: r.invoiceNo,
          totalAmountPaise: r.totalAmount, paidAmountPaise: r.paidAmount,
          createdAt: r.createdAt,
        })),
        deletedButLinkedCount,
        deletedOriginals,
        orphanedNotesCount,
      },
      componentComparison,
      interpretation,
    })
  } catch (err) {
    return apiError(err, 'Failed to run party-balance detail diagnostic', 500)
  }
}
