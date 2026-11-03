/**
 * Phase 8d (#116, #117) — the input credit one GSTR-3B may claim, by the law.
 *
 * THE THREE RULES (law report, "IMS and input credit"):
 *   Rule 36(4) / s.16(2)(aa) — credit only for an invoice that appears in the
 *     shop's GSTR-2B (Notification 40/2021-CT, from 1 Jan 2022). Rule 88D then
 *     sends a notice when 3B claims more than 2B.
 *   Timing — a supplier who files late puts the invoice in a LATER month's 2B
 *     (GSTN files records by the supplier's filing date). It is claimed in the
 *     period it first appears: "a June invoice that first appears in the July
 *     GSTR-2B is claimed in the July GSTR-3B".
 *   s.16(4) — no credit after 30 November following the end of the invoice's
 *     financial year, or after the annual return if earlier (Circular
 *     237/31/2024-GST).
 *
 * WHAT WAS WRONG:
 *   #116  a 2B match claimed the BOOK tax. Supplier files ₹10,000 of tax, the
 *         books say ₹12,000 → the app claimed ₹12,000. Now: the lower of the
 *         two, head by head (IGST, CGST, SGST), with the difference shown.
 *   #117  only purchases DATED in the period were matched against that
 *         period's 2B, so a June bill in July's 2B was never claimed —
 *         permanently "deferred". Now every purchase not yet claimed (still
 *         inside 16(4)) is matched against each period's 2B, and the period it
 *         was claimed in is stamped on it when that 3B is filed
 *         (Transaction.itcClaimedIn), so it is never claimed twice.
 *
 * Pure: the route fetches, this decides. Same match key as the 2B
 * reconciliation screen (itcMatchKey), so the screen and the return agree on
 * what "in 2B" means.
 */
import { roundMoney } from '@/lib/money'

/** Supplier GSTIN + invoice number, trimmed and upper-cased: "inv-001" in the books is "INV-001" on the portal. */
export function itcMatchKey(gstin: string | null | undefined, invoiceNo: string | null | undefined): string {
  return `${(gstin || '').trim().toUpperCase()}|${(invoiceNo || '').trim().toUpperCase()}`
}

/** "MMYYYY" → a number that sorts: 072026 → 202607. */
const ord = (fp: string) => Number(fp.slice(2) + fp.slice(0, 2))

/** The financial year an "MMYYYY" period belongs to, as its starting calendar year (Jan–Mar belong to the year before). */
export function fyStart(fp: string): number {
  const m = Number(fp.slice(0, 2))
  const y = Number(fp.slice(2))
  return m >= 4 ? y : y - 1
}

/**
 * s.16(4): the LAST GSTR-3B period that can still carry credit for a bill of
 * period `billFp`. The deadline is 30 November after the bill's financial year;
 * a November return is filed in December, so the October return (due 20
 * November) is the last that can — October of the following year.
 * (A GSTR-9 filed earlier closes it sooner; the app does not hold that date yet.)
 */
export function lastClaimPeriod(billFp: string): string {
  return `10${fyStart(billFp) + 1}`
}

/** The earliest bill period still claimable in `fp`: April of the financial year before. Bounds the candidate query. */
export function earliestClaimableBill(fp: string): { month: number; year: number } {
  const y = fyStart(fp)
  const m = Number(fp.slice(0, 2))
  // April–October: last financial year's bills are still claimable (until the October return).
  // November–March: only this financial year's.
  return { month: 4, year: m >= 4 && m <= 10 ? y - 1 : y }
}

export interface ItcPurchase {
  id: string
  /** The bill's own period (MMYYYY, IST). */
  billFp: string
  gstin: string | null
  invoiceNo: string | null
  taxable: number
  cgst: number
  sgst: number
  igst: number
  /** The period its credit was claimed in, once a 3B claiming it was filed. */
  itcClaimedIn: string | null
  /** Supplier name, for the ending-soon list (#112). */
  supplier?: string | null
}

export interface TwoBLine {
  supplierGstin: string
  invoiceNumber: string
  taxableValue: number
  cgst: number
  sgst: number
  igst: number
  /** False when 2B marks the bill "ITC not available" (itcavl N) — #353. Absent means available. */
  itcAvailable?: boolean
}

export interface ClaimLine {
  id: string
  billFp: string
  /** Claimed now, though billed in an earlier month: the supplier filed late (#117). */
  late: boolean
  book: { taxable: number; cgst: number; sgst: number; igst: number }
  twoB: { taxable: number; cgst: number; sgst: number; igst: number }
  claim: { taxable: number; cgst: number; sgst: number; igst: number }
  /** Book tax above what the supplier filed — credit NOT claimed this time (#116). */
  shortBy: number
}

export interface ItcClaim {
  claimed: ClaimLine[]
  /** Billed this month, not yet in 2B — waits for a later 2B. */
  deferred: ItcPurchase[]
  /** Billed earlier, still not in any 2B — still waiting. */
  stillWaiting: ItcPurchase[]
  /** Past the s.16(4) window for this period — can no longer be claimed. */
  lapsed: ItcPurchase[]
  /** 9a-1: in this period's 2B, but 2B says no credit on it (itcavl N) — never claimed, and not "waiting". */
  notAvailable: ItcPurchase[]
  /**
   * #112: still waiting, and the window closes with THIS return (final) or the
   * next one. These are the bills to chase a supplier about, by name.
   */
  endingSoon: Array<ItcPurchase & { lastFp: string; final: boolean }>
  totals: {
    claim: { taxable: number; cgst: number; sgst: number; igst: number }
    shortBy: number
    deferredTax: number
    stillWaitingTax: number
    lapsedTax: number
    notAvailableTax: number
    lateCount: number
    endingSoonTax: number
  }
}

/** The period after `fp` (MMYYYY). */
export function nextPeriod(fp: string): string {
  const m = Number(fp.slice(0, 2))
  const y = Number(fp.slice(2))
  return m === 12 ? `01${y + 1}` : `${String(m + 1).padStart(2, '0')}${y}`
}

const tax = (p: { cgst: number; sgst: number; igst: number }) => roundMoney(p.cgst + p.sgst + p.igst)

/**
 * The credit one period may claim.
 *
 * @param fp         the GSTR-3B period (MMYYYY)
 * @param purchases  candidates: not RCM, not blocked (s.17(5)), billed up to this period, and either
 *                   unclaimed or claimed in THIS period (a filed month recomputes to the same answer)
 * @param twoB       this period's GSTR-2B lines
 */
export function claimForPeriod(
  fp: string,
  purchases: ItcPurchase[],
  twoB: TwoBLine[],
  /** 9a-2: keys of bills an EARLIER month's 2B marked "no credit" — not "waiting" when absent from this 2B. */
  noCreditKeys: ReadonlySet<string> = new Set(),
): ItcClaim {
  const in2b = new Map<string, TwoBLine>()
  for (const l of twoB) in2b.set(itcMatchKey(l.supplierGstin, l.invoiceNumber), l)

  const claimed: ClaimLine[] = []
  const deferred: ItcPurchase[] = []
  const stillWaiting: ItcPurchase[] = []
  const lapsed: ItcPurchase[] = []
  const notAvailable: ItcPurchase[] = []

  for (const p of purchases) {
    if (p.itcClaimedIn && p.itcClaimedIn !== fp) continue // claimed in another period — never twice
    if (ord(p.billFp) > ord(fp)) continue                  // billed after this period
    if (ord(fp) > ord(lastClaimPeriod(p.billFp))) { if (!p.itcClaimedIn) lapsed.push(p); continue }

    const line = in2b.get(itcMatchKey(p.gstin, p.invoiceNo))
    if (!line) {
      if (noCreditKeys.has(itcMatchKey(p.gstin, p.invoiceNo))) { notAvailable.push(p); continue }
      if (p.billFp === fp) deferred.push(p)
      else stillWaiting.push(p)
      continue
    }
    if (line.itcAvailable === false) { notAvailable.push(p); continue }
    const book = { taxable: roundMoney(p.taxable), cgst: roundMoney(p.cgst), sgst: roundMoney(p.sgst), igst: roundMoney(p.igst) }
    const twoBv = { taxable: roundMoney(line.taxableValue), cgst: roundMoney(line.cgst), sgst: roundMoney(line.sgst), igst: roundMoney(line.igst) }
    // #116: never more than the supplier filed, head by head.
    const claim = {
      taxable: Math.min(book.taxable, twoBv.taxable),
      cgst: Math.min(book.cgst, twoBv.cgst),
      sgst: Math.min(book.sgst, twoBv.sgst),
      igst: Math.min(book.igst, twoBv.igst),
    }
    claimed.push({ id: p.id, billFp: p.billFp, late: p.billFp !== fp, book, twoB: twoBv, claim, shortBy: roundMoney(tax(book) - tax(claim)) })
  }

  // #112: the window (s.16(4)) shuts after the October return; warn this period and the one before it.
  const endingSoon = [...deferred, ...stillWaiting]
    .map((p) => ({ ...p, lastFp: lastClaimPeriod(p.billFp) }))
    .filter((p) => p.lastFp === fp || p.lastFp === nextPeriod(fp))
    .map((p) => ({ ...p, final: p.lastFp === fp }))
    .sort((a, b) => Number(b.final) - Number(a.final) || tax(b) - tax(a))

  const sum = (xs: Array<{ taxable: number; cgst: number; sgst: number; igst: number }>) => ({
    taxable: roundMoney(xs.reduce((s, x) => s + x.taxable, 0)),
    cgst: roundMoney(xs.reduce((s, x) => s + x.cgst, 0)),
    sgst: roundMoney(xs.reduce((s, x) => s + x.sgst, 0)),
    igst: roundMoney(xs.reduce((s, x) => s + x.igst, 0)),
  })
  return {
    claimed, deferred, stillWaiting, lapsed, notAvailable, endingSoon,
    totals: {
      claim: sum(claimed.map((c) => c.claim)),
      shortBy: roundMoney(claimed.reduce((s, c) => s + c.shortBy, 0)),
      deferredTax: roundMoney(deferred.reduce((s, p) => s + tax(p), 0)),
      stillWaitingTax: roundMoney(stillWaiting.reduce((s, p) => s + tax(p), 0)),
      lapsedTax: roundMoney(lapsed.reduce((s, p) => s + tax(p), 0)),
      notAvailableTax: roundMoney(notAvailable.reduce((s, p) => s + tax(p), 0)),
      lateCount: claimed.filter((c) => c.late).length,
      endingSoonTax: roundMoney(endingSoon.reduce((s, p) => s + tax(p), 0)),
    },
  }
}
