/**
 * #349 (1 Nov 2026): Rule 37 with goods returned to the supplier.
 * A purchase of ₹1,050 (₹1,000 + ₹50 GST); half goes back on a debit note
 * (₹525 = ₹500 + ₹25 GST). The ₹25 of credit on the returned half is reversed
 * by the debit note itself, so only the kept half's ₹25 can be "at risk".
 */
import { assessItcReversal, debitNotesForItc } from '@/lib/itc-180-day'

const ASOF = new Date(2026, 10, 1)
const daysBefore = (n: number) => { const d = new Date(ASOF); d.setDate(d.getDate() - n); return d }
const BILL = { invoiceDate: daysBefore(200), totalAmount: 1050, paidAmount: 0, taxAmount: 50 }
const HALF_BACK = (daysAgo: number) => ({ date: daysBefore(daysAgo), totalAmount: 525, paidAmount: 0, taxAmount: 25 })

test('before: the whole ₹1,050 read as unpaid and ₹50 at risk — now ₹525 unpaid, ₹25 at risk', () => {
  const plain = assessItcReversal(BILL, ASOF)
  expect([plain.status, plain.unpaidAmount, plain.itcAtRisk]).toEqual(['overdue', 1050, 50])
  const withReturn = assessItcReversal({ ...BILL, notes: [HALF_BACK(190)] }, ASOF)
  expect([withReturn.status, withReturn.unpaidAmount, withReturn.itcAtRisk]).toEqual(['overdue', 525, 25])
})

test('everything taxed went back → nothing to reverse here (the debit note reversed it)', () => {
  const a = assessItcReversal({ ...BILL, notes: [{ date: daysBefore(190), totalAmount: 1050, paidAmount: 0, taxAmount: 50 }] }, ASOF)
  expect(a.status).toBe('not-applicable')
})

test('a return BY day 180 counts like a payment in time; one after it does not', () => {
  // Kept half paid on day 190 (10 days ago → after the deadline at day 180).
  const paidLate = { amount: 525, date: daysBefore(10) }
  // Returned on day 10: at day 180 only the kept ₹525 was unpaid → ₹25 should have been reversed.
  const early = assessItcReversal({ ...BILL, allocations: [paidLate], notes: [HALF_BACK(190)] }, ASOF)
  expect([early.status, early.itcAtRisk]).toEqual(['paid-late', 25])
  // Returned on day 195 (after day 180): at day 180 all ₹1,050 was unpaid and not returned → ₹50.
  const late = assessItcReversal({ ...BILL, allocations: [paidLate], notes: [HALF_BACK(5)] }, ASOF)
  expect([late.status, late.itcAtRisk]).toEqual(['paid-late', 50])
})

test('a refund the supplier paid in cash on the note does not lower what is still owed', () => {
  const a = assessItcReversal({ ...BILL, notes: [{ ...HALF_BACK(190), paidAmount: 525 }] }, ASOF)
  expect(a.unpaidAmount).toBe(1050)
})

test('the callers\' mapping: CGST + SGST + IGST make the note\'s tax', () => {
  expect(debitNotesForItc([{ date: '2026-05-10', totalAmount: 525, paidAmount: null, cgst: 12.5, sgst: 12.5, igst: 0 }]))
    .toEqual([{ date: '2026-05-10', totalAmount: 525, paidAmount: 0, taxAmount: 25 }])
  expect(debitNotesForItc(undefined)).toEqual([])
})
