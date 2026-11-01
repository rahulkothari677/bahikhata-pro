/**
 * #133 (8e): GSTR-3B set-off, head by head (s.49(5), Rule 88A, s.49(4)).
 * Each case is worked by hand in rupees.
 */
import { setOffGst } from '@/lib/gst-setoff'

const H = (igst = 0, cgst = 0, sgst = 0) => ({ igst, cgst, sgst })

describe('#133: never a negative payable', () => {
  test('the live case (1 Oct): IGST owed ₹121.43, credit ₹91.31 CGST + ₹91.31 SGST → pay ₹0, carry ₹61.19 SGST', () => {
    // CGST credit pays ₹91.31 of the IGST; SGST credit pays the last ₹30.12.
    // The app showed "Net tax payable −₹61.19"; the return says ₹0 and ₹61.19 carried.
    const s = setOffGst(H(121.43), H(0, 91.31, 91.31))
    expect(s.cash.total).toBe(0)
    expect(s.carryForward).toEqual({ igst: 0, cgst: 0, sgst: 61.19, total: 61.19 })
  })

  test('SGST credit cannot pay CGST: ₹100 CGST owed, ₹100 SGST credit → ₹100 cash AND ₹100 carried', () => {
    // "Output − input" says ₹0. The law says pay ₹100.
    const s = setOffGst(H(0, 100, 0), H(0, 0, 100))
    expect(s.cash).toEqual({ igst: 0, cgst: 100, sgst: 0, total: 100 })
    expect(s.carryForward.sgst).toBe(100)
  })

  test('IGST credit goes where the head falls short: ₹100+₹100 owed, credit ₹100 IGST + ₹100 CGST → ₹0 cash', () => {
    // CGST is covered by its own credit, so the IGST credit pays the SGST.
    // Spending it on CGST first would leave ₹100 of SGST to pay in cash.
    const s = setOffGst(H(0, 100, 100), H(100, 100, 0))
    expect(s.cash.total).toBe(0)
    expect(s.carryForward.total).toBe(0) // IGST paid SGST, CGST paid CGST — all used
  })

  test('Rule 88A: IGST credit is used up before CGST/SGST credit, even when not needed', () => {
    // Owed ₹100 CGST + ₹100 SGST; credit ₹150 IGST, ₹100 CGST, ₹100 SGST.
    // IGST ₹150 → ₹100 CGST + ₹50 SGST. Then SGST credit pays the other ₹50.
    const s = setOffGst(H(0, 100, 100), H(150, 100, 100))
    expect(s.cash.total).toBe(0)
    expect(s.carryForward).toEqual({ igst: 0, cgst: 100, sgst: 50, total: 150 })
  })

  test('reverse charge is cash, whatever the credit', () => {
    const s = setOffGst(H(0, 0, 0), H(0, 500, 500), H(0, 50, 50))
    expect(s.cash).toEqual({ igst: 0, cgst: 50, sgst: 50, total: 100 })
    expect(s.carryForward.total).toBe(1000)
  })

  test('more owed than credit: the rest is cash, nothing carried', () => {
    const s = setOffGst(H(200, 50, 50), H(100, 20, 20))
    // IGST 100 vs 200 → 100 left. CGST 20 vs 50 → 30 left; SGST 20 vs 50 → 30 left.
    expect(s.cash).toEqual({ igst: 100, cgst: 30, sgst: 30, total: 160 })
    expect(s.carryForward.total).toBe(0)
  })

  test('a negative head (credit notes above sales) counts as nothing owed, not as credit', () => {
    const s = setOffGst(H(-40, 10, 10), H(0, 0, 0))
    expect(s.cash).toEqual({ igst: 0, cgst: 10, sgst: 10, total: 20 })
  })

  test('paise stay exact', () => {
    const s = setOffGst(H(0.1, 0.2, 0.2), H(0.3, 0, 0))
    expect(s.cash.total).toBe(0.2)
    expect(s.carryForward.total).toBe(0)
  })
})
