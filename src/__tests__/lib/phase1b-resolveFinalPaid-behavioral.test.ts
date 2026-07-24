/**
 * 🔒 Phase 1b — resolveFinalPaid behavioral tests.
 *
 * THE PROBLEM: resolveFinalPaid decides the stored paidAmount for every
 * transaction. The V24 §1 fix changed the default for credit/debit notes
 * from totalAmount to 0 — but this was never behaviorally tested. A regression
 * here silently overstates/understates every party's balance.
 *
 * WHAT THIS TESTS:
 *   1. Sale with missing paid → defaults to totalAmount (full payment)
 *   2. Sale with explicit paid → uses that value
 *   3. Sale with partial paid → uses partial, no snap
 *   4. Sale with paid within ₹0.005 above total → snaps to total (round-off absorption)
 *   5. Sale with paid > total → clamped to total (no negative outstanding)
 *   6. Credit-note with missing paid → defaults to 0 (khata adjustment, NOT total)
 *   7. Credit-note with explicit paid → uses that value, NO snap
 *   8. Credit-note with paid > total → clamped to total
 *   9. Debit-note with missing paid → defaults to 0
 *  10. Negative paid → clamped to 0
 *  11. The "₹999.50 on ₹1,000" edge case: stays partial (not snapped — the V26 N7 fix)
 *  12. The "₹1,000.50 on ₹1,000" edge case: snaps to total (round-off artifact)
 */

import { resolveFinalPaid, isNoteType, NOTE_TYPES } from '@/lib/paid-amount'
import { roundMoney } from '@/lib/money'

describe('🔒 Phase 1b — resolveFinalPaid behavioral tests', () => {

  // ═════════════════════════════════════════════════════════════════
  // Sale defaults
  // ═════════════════════════════════════════════════════════════════
  test('sale with missing paid → defaults to totalAmount (full payment)', () => {
    expect(resolveFinalPaid('sale', undefined, 1000)).toBe(1000)
    expect(resolveFinalPaid('sale', null, 1000)).toBe(1000)
    expect(resolveFinalPaid('sale', '', 1000)).toBe(1000)
    expect(resolveFinalPaid('sale', NaN, 1000)).toBe(1000)
  })

  test('sale with explicit paid → uses that value', () => {
    expect(resolveFinalPaid('sale', 500, 1000)).toBe(500)
    expect(resolveFinalPaid('sale', 1000, 1000)).toBe(1000)
    expect(resolveFinalPaid('sale', 0, 1000)).toBe(0)  // full credit
  })

  test('sale with partial paid → uses partial, no snap', () => {
    // ₹999.50 on a ₹1,000 invoice → stays ₹999.50 (the V26 N7 fix)
    expect(resolveFinalPaid('sale', 999.50, 1000)).toBe(999.50)
    expect(resolveFinalPaid('sale', 995, 1000)).toBe(995)
    expect(resolveFinalPaid('sale', 500.01, 1000)).toBe(500.01)
  })

  // ═════════════════════════════════════════════════════════════════
  // Snap zone (the FIX M3 / V26 N7 narrowed snap)
  // ═════════════════════════════════════════════════════════════════
  test('sale with paid within ₹0.005 above total → snaps to total', () => {
    // ₹1000.005 → snaps to 1000 (within upper snap band)
    expect(resolveFinalPaid('sale', 1000.005, 1000)).toBe(1000)
    // ₹1000.50 → snaps to 1000 (within ₹1 upper band)
    expect(resolveFinalPaid('sale', 1000.50, 1000)).toBe(1000)
    // ₹1001.01 → does NOT snap (outside band), clamped to total
    expect(resolveFinalPaid('sale', 1001.01, 1000)).toBe(1000)
  })

  test('sale with paid > total → clamped to total (no negative outstanding)', () => {
    expect(resolveFinalPaid('sale', 1500, 1000)).toBe(1000)
    expect(resolveFinalPaid('sale', 1001, 1000)).toBe(1000)
  })

  // ═════════════════════════════════════════════════════════════════
  // Credit/debit note defaults (the V24 §1 fix)
  // ═════════════════════════════════════════════════════════════════
  test('credit-note with missing paid → defaults to 0 (khata adjustment)', () => {
    expect(resolveFinalPaid('credit-note', undefined, 500)).toBe(0)
    expect(resolveFinalPaid('credit-note', null, 500)).toBe(0)
    expect(resolveFinalPaid('credit-note', '', 500)).toBe(0)
  })

  test('credit-note with explicit paid → uses that value, NO snap', () => {
    // ₹4.50 refund on a ₹5 credit note → stays ₹4.50 (the V26 N7 fix)
    expect(resolveFinalPaid('credit-note', 4.50, 5)).toBe(4.50)
    expect(resolveFinalPaid('credit-note', 5, 5)).toBe(5)
    expect(resolveFinalPaid('credit-note', 0, 5)).toBe(0)
  })

  test('credit-note with paid > total → clamped to total', () => {
    expect(resolveFinalPaid('credit-note', 10, 5)).toBe(5)
  })

  test('debit-note with missing paid → defaults to 0', () => {
    expect(resolveFinalPaid('debit-note', undefined, 500)).toBe(0)
    expect(resolveFinalPaid('debit-note', null, 500)).toBe(0)
  })

  // ═════════════════════════════════════════════════════════════════
  // Edge cases
  // ═════════════════════════════════════════════════════════════════
  test('negative paid → clamped to 0', () => {
    expect(resolveFinalPaid('sale', -50, 1000)).toBe(0)
    expect(resolveFinalPaid('credit-note', -10, 500)).toBe(0)
  })

  test('the ₹999.50 on ₹1,000 edge case: stays partial (V26 N7)', () => {
    // This was the bug: any value within ₹1 of total snapped to total,
    // silently upgrading a genuine ₹999.50 partial to "fully paid".
    const result = resolveFinalPaid('sale', 999.50, 1000)
    expect(result).toBe(999.50)
    expect(result).not.toBe(1000)
  })

  test('the ₹1,000.50 on ₹1,000 edge case: snaps to total (round-off artifact)', () => {
    // A pre-round-off client value of ₹1000.50 on a ₹1000 invoice should
    // snap to total — this is the original FIX M3 intent.
    const result = resolveFinalPaid('sale', 1000.50, 1000)
    expect(result).toBe(1000)
  })

  test('income/expense with missing paid → defaults to totalAmount', () => {
    expect(resolveFinalPaid('income', undefined, 5000)).toBe(5000)
    expect(resolveFinalPaid('expense', undefined, 3000)).toBe(3000)
  })

  test('purchase with missing paid → defaults to totalAmount', () => {
    expect(resolveFinalPaid('purchase', undefined, 2000)).toBe(2000)
  })

  // ═════════════════════════════════════════════════════════════════
  // Helper functions
  // ═════════════════════════════════════════════════════════════════
  test('isNoteType correctly identifies credit/debit notes', () => {
    expect(isNoteType('credit-note')).toBe(true)
    expect(isNoteType('debit-note')).toBe(true)
    expect(isNoteType('sale')).toBe(false)
    expect(isNoteType('purchase')).toBe(false)
    expect(isNoteType('income')).toBe(false)
    expect(isNoteType('expense')).toBe(false)
    expect(isNoteType('estimate')).toBe(false)
  })

  test('NOTE_TYPES array contains exactly credit-note and debit-note', () => {
    expect(NOTE_TYPES).toEqual(['credit-note', 'debit-note'])
  })

  // ═════════════════════════════════════════════════════════════════
  // String input (from form submission)
  // ═════════════════════════════════════════════════════════════════
  test('string paid amount is parsed correctly', () => {
    expect(resolveFinalPaid('sale', '500', 1000)).toBe(500)
    expect(resolveFinalPaid('sale', '1000', 1000)).toBe(1000)
    expect(resolveFinalPaid('sale', '0', 1000)).toBe(0)
  })
})
