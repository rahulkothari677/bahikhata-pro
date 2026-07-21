/**
 * 🔒 V26 Phase 8 — Payment paise round-trip guard test.
 *
 * The user reported ₹100 payment showing as ₹10,000 in the app. The DB stores
 * 10000 paise (= ₹100) — that's correct. This test verifies the conversion
 * functions work correctly: rupees → paise on write, paise → rupees on read.
 *
 * If this test fails, the money extension or fromPaise/toPaise is broken.
 */

import { describe, test, expect } from '@jest/globals'
import { toPaise, fromPaise, roundMoney } from '@/lib/money'

describe('Phase 8 — Payment paise round-trip', () => {
  test('₹100 → 10000 paise (write) → ₹100 (read)', () => {
    const userInput = 100 // rupees
    const paiseInDB = toPaise(userInput) // what the extension stores
    expect(paiseInDB).toBe(10000) // 100 rupees = 10000 paise

    const displayedToUser = fromPaise(paiseInDB) // what the extension returns on read
    expect(displayedToUser).toBe(100) // back to rupees
  })

  test('₹10 → 1000 paise → ₹10', () => {
    expect(toPaise(10)).toBe(1000)
    expect(fromPaise(1000)).toBe(10)
  })

  test('₹1,058.40 → 105840 paise → ₹1,058.40', () => {
    expect(toPaise(1058.40)).toBe(105840)
    expect(fromPaise(105840)).toBe(1058.40)
  })

  test('₹0.50 → 50 paise → ₹0.50', () => {
    expect(toPaise(0.50)).toBe(50)
    expect(fromPaise(50)).toBe(0.50)
  })

  test('roundMoney does NOT multiply by 100 (it rounds to 2 decimals)', () => {
    // roundMoney is a rupee-level operation — it should NOT convert to paise.
    // If it did, ₹100 → ₹10000 (the bug the user reported).
    expect(roundMoney(100)).toBe(100) // NOT 10000
    expect(roundMoney(1058.40)).toBe(1058.40) // NOT 105840
  })

  test('fromPaise does NOT multiply by 100', () => {
    // If fromPaise returned paise instead of rupees, 10000 → 10000 (the bug).
    expect(fromPaise(10000)).toBe(100) // NOT 10000
    expect(fromPaise(1000)).toBe(10) // NOT 1000
  })
})
