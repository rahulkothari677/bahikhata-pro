/**
 * The month's advances, fetched and totalled once for both returns.
 *
 * WHY THIS IS SHARED (2026-08-09). The same two quantities appear in both
 * returns: an advance received and not yet billed is GSTR-1 Table 11A AND is
 * added into GSTR-3B 3.1(a); an advance released against an invoice is Table 11B
 * AND is subtracted from 3.1(a). If each route fetched and computed them for
 * itself, the two returns would drift — which is exactly what happened with
 * nil/exempt supplies, and is not being repeated.
 *
 * So the query, the place-of-supply derivation, and the tax split all live here.
 */
import { db } from '@/lib/db'
import { deriveStateCode } from '@/lib/gst'
import { advanceTax, isTaxableAdvance, type AdvanceReceipt } from '@/lib/advance-tax'
import { roundMoney } from '@/lib/money'

export interface AdvanceTotals {
  adAmt: number
  cgst: number
  sgst: number
  igst: number
}

export interface PeriodAdvances {
  /** Dated inside the period — candidates for Table 11A. */
  receivedThisPeriod: AdvanceReceipt[]
  /** Dated before the period — candidates for Table 11B. */
  fromEarlierPeriods: AdvanceReceipt[]
  /** Totals for GSTR-3B 3.1(a). */
  totals: { received: AdvanceTotals; adjusted: AdvanceTotals }
}

const ZERO: AdvanceTotals = { adAmt: 0, cgst: 0, sgst: 0, igst: 0 }

function add(a: AdvanceTotals, b: AdvanceTotals): AdvanceTotals {
  return {
    adAmt: roundMoney(a.adAmt + b.adAmt),
    cgst: roundMoney(a.cgst + b.cgst),
    sgst: roundMoney(a.sgst + b.sgst),
    igst: roundMoney(a.igst + b.igst),
  }
}

/**
 * @param shopStateCode two-digit state code of the shop, for the inter/intra call
 */
export async function getAdvancesForPeriod(
  userId: string,
  periodStart: Date,
  periodEnd: Date,
  shopStateCode: string | null,
): Promise<PeriodAdvances> {
  /*
   * Only receipts carrying a rate are taxable at all — advances for goods are
   * exempt under Notification 66/2017 — so a shop that never takes a service
   * advance matches nothing and pays no query cost beyond the index lookup.
   */
  const rows = await db.payment.findMany({
    where: {
      userId,
      type: 'received',
      deletedAt: null,
      advanceGstRate: { not: null },
      OR: [
        { date: { gte: periodStart, lt: periodEnd } },
        {
          date: { lt: periodStart },
          allocations: { some: { createdAt: { gte: periodStart, lt: periodEnd } } },
        },
      ],
    },
    select: {
      id: true, amount: true, date: true, advanceGstRate: true,
      party: { select: { state: true, gstin: true } },
      allocations: { select: { amount: true, createdAt: true } },
    },
  })

  const mapped: AdvanceReceipt[] = rows.map((p) => {
    const partyStateCode = deriveStateCode(p.party?.state || null, null, p.party?.gstin || null, null)
    const sum = (rs: typeof p.allocations) => rs.reduce((a, x) => a + x.amount, 0)
    return {
      id: p.id,
      amount: p.amount,
      date: p.date,
      advanceGstRate: p.advanceGstRate,
      isInterState: !!partyStateCode && !!shopStateCode && partyStateCode !== shopStateCode,
      pos: partyStateCode || shopStateCode || '',
      adjustedByPeriodEnd: sum(p.allocations.filter((a) => a.createdAt < periodEnd)),
      adjustedInPeriod: sum(
        p.allocations.filter((a) => a.createdAt >= periodStart && a.createdAt < periodEnd),
      ),
    }
  })

  const receivedThisPeriod = mapped.filter((a) => a.date >= periodStart && a.date < periodEnd)
  const fromEarlierPeriods = mapped.filter((a) => a.date < periodStart)

  /*
   * The totals mirror the tables exactly: 11A is the still-unbilled part of this
   * period's receipts, 11B is what earlier receipts released this period.
   */
  let received = ZERO
  for (const r of receivedThisPeriod) {
    if (!isTaxableAdvance(r)) continue
    const unbilled = r.amount - r.adjustedByPeriodEnd
    if (unbilled <= 0) continue
    const t = advanceTax(unbilled, r.advanceGstRate as number, r.isInterState)
    received = add(received, { adAmt: t.adAmt, cgst: t.cgst, sgst: t.sgst, igst: t.igst })
  }

  let adjusted = ZERO
  for (const r of fromEarlierPeriods) {
    if (!isTaxableAdvance(r)) continue
    if (r.adjustedInPeriod <= 0) continue
    const t = advanceTax(r.adjustedInPeriod, r.advanceGstRate as number, r.isInterState)
    adjusted = add(adjusted, { adAmt: t.adAmt, cgst: t.cgst, sgst: t.sgst, igst: t.igst })
  }

  return { receivedThisPeriod, fromEarlierPeriods, totals: { received, adjusted } }
}
