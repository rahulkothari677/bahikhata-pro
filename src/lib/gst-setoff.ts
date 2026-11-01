/**
 * #133 (8e): what a shop actually PAYS once its credit is set off — never a
 * negative "net tax payable".
 *
 * GSTR-3B has no negative payable. Credit is used head by head, in the order
 * the law fixes, and what is left over is carried to next month:
 *
 *   s.49(5)(a) + Rule 88A  IGST credit goes first against IGST, then against
 *                          CGST and SGST in any order, and must be used up
 *                          before any CGST or SGST credit is touched.
 *   s.49(5)(b)             CGST credit: against CGST, then IGST. Never SGST.
 *   s.49(5)(c)             SGST credit: against SGST, then IGST. Never CGST.
 *   s.49(4) + s.9(3)       Tax under reverse charge is paid in cash. Credit
 *                          cannot pay it (the caller passes it as `rcmCash`).
 *
 * So a month can owe CGST in cash while SGST credit sits unused: that credit
 * may not cross over. "Output − input" hides this and shows a negative total.
 *
 * Where Rule 88A leaves a choice (IGST credit across CGST and SGST), it is
 * spent where the head's own credit falls short first. That is the split that
 * leaves the least to pay in cash.
 */
import { roundMoney } from '@/lib/money'

export interface Heads { igst: number; cgst: number; sgst: number }
export interface SetOff {
  /** Paid in cash, per head, reverse charge included. */
  cash: Heads & { total: number }
  /** Credit left after this month, carried to the next. */
  carryForward: Heads & { total: number }
}

const r = roundMoney
const pos = (n: number) => Math.max(0, r(n))

/**
 * @param liability output tax per head, already net of credit notes (a negative head counts as 0)
 * @param credit    input credit per head, already net of debit notes (a negative head counts as 0)
 * @param rcmCash   reverse-charge tax per head, paid in cash whatever the credit
 */
export function setOffGst(liability: Heads, credit: Heads, rcmCash: Heads = { igst: 0, cgst: 0, sgst: 0 }): SetOff {
  const L = { igst: pos(liability.igst), cgst: pos(liability.cgst), sgst: pos(liability.sgst) }
  const C = { igst: pos(credit.igst), cgst: pos(credit.cgst), sgst: pos(credit.sgst) }

  // 1. IGST credit against IGST.
  let use = Math.min(C.igst, L.igst); C.igst = r(C.igst - use); L.igst = r(L.igst - use)

  // 2. What is left of it against CGST and SGST — the shortfalls their own credit cannot meet first.
  const shortC = pos(L.cgst - C.cgst)
  const shortS = pos(L.sgst - C.sgst)
  use = Math.min(C.igst, shortC); C.igst = r(C.igst - use); L.cgst = r(L.cgst - use)
  use = Math.min(C.igst, shortS); C.igst = r(C.igst - use); L.sgst = r(L.sgst - use)
  // Rule 88A: any IGST credit still left must be used up before CGST/SGST credit.
  use = Math.min(C.igst, L.cgst); C.igst = r(C.igst - use); L.cgst = r(L.cgst - use)
  use = Math.min(C.igst, L.sgst); C.igst = r(C.igst - use); L.sgst = r(L.sgst - use)

  // 3. CGST credit: CGST, then IGST.
  use = Math.min(C.cgst, L.cgst); C.cgst = r(C.cgst - use); L.cgst = r(L.cgst - use)
  use = Math.min(C.cgst, L.igst); C.cgst = r(C.cgst - use); L.igst = r(L.igst - use)

  // 4. SGST credit: SGST, then IGST.
  use = Math.min(C.sgst, L.sgst); C.sgst = r(C.sgst - use); L.sgst = r(L.sgst - use)
  use = Math.min(C.sgst, L.igst); C.sgst = r(C.sgst - use); L.igst = r(L.igst - use)

  const cash = {
    igst: r(L.igst + pos(rcmCash.igst)),
    cgst: r(L.cgst + pos(rcmCash.cgst)),
    sgst: r(L.sgst + pos(rcmCash.sgst)),
  }
  return {
    cash: { ...cash, total: r(cash.igst + cash.cgst + cash.sgst) },
    carryForward: { ...C, total: r(C.igst + C.cgst + C.sgst) },
  }
}
