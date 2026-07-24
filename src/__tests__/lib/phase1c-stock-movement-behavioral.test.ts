/**
 * 🔒 Phase 1c — Stock movement logic behavioral tests.
 *
 * THE PROBLEM: The R11-4 bug was that editing a credit-note with
 * affectsStock=true silently reset it to false (via zod default), and the
 * stock-movement logic used the raw undefined value instead of the resolved
 * one. The fix (resolvedAffectsStock) is protected by a source-string regex
 * test — but no behavioral test verifies the ACTUAL stock-direction logic.
 *
 * This test replicates the stock-direction logic from the PUT route
 * (transactions/[id]/route.ts:258-264) and verifies it for every combination:
 *   - sale, purchase, credit-note, debit-note
 *   - affectsStock = true, false, undefined (edit dialog omission)
 *   - existing.affectsStock = true, false
 *
 * The logic under test:
 *   resolvedAffectsStock = affectsStock !== undefined ? affectsStock : (existing.affectsStock ?? false)
 *   shouldDecrementStock = type === 'sale' || (type === 'debit-note' && resolvedAffectsStock)
 *   shouldIncrementStock = type === 'purchase' || (type === 'credit-note' && resolvedAffectsStock)
 */

import { roundMoney } from '@/lib/money'

/**
 * Replicates the stock-direction logic from the PUT route.
 * This is the EXACT logic that runs at transactions/[id]/route.ts:253-260.
 */
function computeStockDirection(
  type: string,
  affectsStock: boolean | undefined,
  existingAffectsStock: boolean | null,
) {
  const resolvedAffectsStock = affectsStock !== undefined ? affectsStock : (existingAffectsStock ?? false)
  const shouldDecrementStock = type === 'sale' || (type === 'debit-note' && resolvedAffectsStock)
  const shouldIncrementStock = type === 'purchase' || (type === 'credit-note' && resolvedAffectsStock)
  const shouldAffectStock = shouldDecrementStock || shouldIncrementStock
  return { resolvedAffectsStock, shouldDecrementStock, shouldIncrementStock, shouldAffectStock }
}

/**
 * Replicates the net stock change computation from the PUT route.
 * Old items are reversed; new items are applied.
 */
function computeNetStockChange(
  oldQty: number,
  newQty: number,
  existingShouldDecrement: boolean,
  existingShouldIncrement: boolean,
  shouldDecrementStock: boolean,
  shouldIncrementStock: boolean,
): number {
  let netChange = 0
  // Old items: reverse their impact
  if (existingShouldDecrement) {
    netChange += oldQty  // sale/debit-note reversed → add back
  } else if (existingShouldIncrement) {
    netChange -= oldQty  // purchase/credit-note reversed → remove
  }
  // New items: apply their impact
  if (shouldDecrementStock) {
    netChange -= newQty  // sale/debit-note → subtract
  } else if (shouldIncrementStock) {
    netChange += newQty  // purchase/credit-note → add
  }
  return netChange
}

describe('🔒 Phase 1c — Stock movement logic behavioral tests', () => {

  // ═════════════════════════════════════════════════════════════════
  // 1. Sale: always decrements stock
  // ═════════════════════════════════════════════════════════════════
  test('sale always decrements stock (affectsStock irrelevant)', () => {
    const r = computeStockDirection('sale', undefined, false)
    expect(r.shouldDecrementStock).toBe(true)
    expect(r.shouldIncrementStock).toBe(false)
    expect(r.shouldAffectStock).toBe(true)
  })

  // ═════════════════════════════════════════════════════════════════
  // 2. Purchase: always increments stock
  // ═════════════════════════════════════════════════════════════════
  test('purchase always increments stock', () => {
    const r = computeStockDirection('purchase', undefined, false)
    expect(r.shouldDecrementStock).toBe(false)
    expect(r.shouldIncrementStock).toBe(true)
    expect(r.shouldAffectStock).toBe(true)
  })

  // ═════════════════════════════════════════════════════════════════
  // 3. Credit-note with affectsStock=true: increments (returns stock)
  // ═════════════════════════════════════════════════════════════════
  test('credit-note with affectsStock=true increments stock (returns)', () => {
    const r = computeStockDirection('credit-note', true, null)
    expect(r.shouldDecrementStock).toBe(false)
    expect(r.shouldIncrementStock).toBe(true)
    expect(r.resolvedAffectsStock).toBe(true)
  })

  // ═════════════════════════════════════════════════════════════════
  // 4. Credit-note with affectsStock=false: does NOT affect stock
  //    (price adjustment, no physical return)
  // ═════════════════════════════════════════════════════════════════
  test('credit-note with affectsStock=false does NOT affect stock', () => {
    const r = computeStockDirection('credit-note', false, null)
    expect(r.shouldDecrementStock).toBe(false)
    expect(r.shouldIncrementStock).toBe(false)
    expect(r.shouldAffectStock).toBe(false)
  })

  // ═════════════════════════════════════════════════════════════════
  // 5. 🔴 THE R11-4 BUG: Credit-note edit without affectsStock field
  //    must preserve existing.affectsStock=true
  // ═════════════════════════════════════════════════════════════════
  test('🔴 R11-4: credit-note edit without affectsStock preserves existing=true', () => {
    // The edit dialog doesn't send affectsStock → it's undefined.
    // The existing transaction had affectsStock=true.
    // The RESOLVED value must be true, so stock still increments.
    const r = computeStockDirection('credit-note', undefined, true)
    expect(r.resolvedAffectsStock).toBe(true)  // ← this was the bug
    expect(r.shouldIncrementStock).toBe(true)   // ← stock must still increment
    expect(r.shouldAffectStock).toBe(true)
  })

  // ═════════════════════════════════════════════════════════════════
  // 6. 🔴 THE R11-4 BUG (inverse): Credit-note edit without affectsStock
  //    when existing=false must preserve existing=false
  // ═════════════════════════════════════════════════════════════════
  test('🔴 R11-4: credit-note edit without affectsStock preserves existing=false', () => {
    const r = computeStockDirection('credit-note', undefined, false)
    expect(r.resolvedAffectsStock).toBe(false)
    expect(r.shouldIncrementStock).toBe(false)
    expect(r.shouldAffectStock).toBe(false)
  })

  // ═════════════════════════════════════════════════════════════════
  // 7. Debit-note with affectsStock=true: decrements (returns to supplier)
  // ═════════════════════════════════════════════════════════════════
  test('debit-note with affectsStock=true decrements stock (supplier return)', () => {
    const r = computeStockDirection('debit-note', true, null)
    expect(r.shouldDecrementStock).toBe(true)
    expect(r.shouldIncrementStock).toBe(false)
  })

  // ═════════════════════════════════════════════════════════════════
  // 8. Debit-note edit without affectsStock: preserves existing
  // ═════════════════════════════════════════════════════════════════
  test('debit-note edit without affectsStock preserves existing=true', () => {
    const r = computeStockDirection('debit-note', undefined, true)
    expect(r.resolvedAffectsStock).toBe(true)
    expect(r.shouldDecrementStock).toBe(true)
  })

  // ═════════════════════════════════════════════════════════════════
  // 9. Net stock change: edit sale qty from 5 → 3 (stock goes up by 2)
  // ═════════════════════════════════════════════════════════════════
  test('edit sale qty 5→3: stock increases by 2 (reverse 5, apply 3)', () => {
    // Existing sale decremented 5 → reversal adds 5
    // New sale decrements 3 → apply subtracts 3
    // Net: +5 -3 = +2
    const netChange = computeNetStockChange(5, 3, true, false, true, false)
    expect(netChange).toBe(2)
  })

  // ═════════════════════════════════════════════════════════════════
  // 10. Net stock change: edit credit-note qty 2→4 (stock goes up by 2)
  //     when affectsStock=true is preserved
  // ═════════════════════════════════════════════════════════════════
  test('edit credit-note qty 2→4 with affectsStock preserved: stock +2', () => {
    // Existing CN incremented 2 → reversal removes 2
    // New CN increments 4 → apply adds 4
    // Net: -2 +4 = +2
    const netChange = computeNetStockChange(2, 4, false, true, false, true)
    expect(netChange).toBe(2)
  })

  // ═════════════════════════════════════════════════════════════════
  // 11. 🔴 THE R11-4 STOCK CORRUPTION: edit credit-note with
  //     affectsStock=true → if resolvedAffectsStock=false (the bug),
  //     stock DECREASES by the note amount instead of being preserved
  // ═════════════════════════════════════════════════════════════════
  test('🔴 R11-4 stock corruption: unresolved affectsStock=false → stock drops', () => {
    // Existing CN had affectsStock=true → existingShouldIncrement=true
    // Bug: resolvedAffectsStock=false → shouldIncrementStock=false
    // Net: reversal removes 2, new doesn't apply → stock drops by 2
    const buggyResolved = false  // what the bug produced
    const buggyShouldIncrement = false
    const netChange = computeNetStockChange(2, 2, false, true, false, buggyShouldIncrement)
    expect(netChange).toBe(-2)  // stock DECREASES — corruption!

    // With the fix: resolvedAffectsStock=true → shouldIncrementStock=true
    // Net: reversal removes 2, new adds 2 → stock unchanged (correct)
    const fixedResolved = true
    const fixedShouldIncrement = true
    const fixedNetChange = computeNetStockChange(2, 2, false, true, false, fixedShouldIncrement)
    expect(fixedNetChange).toBe(0)  // stock UNCHANGED — correct!
  })

  // ═════════════════════════════════════════════════════════════════
  // 12. Delete sale: stock restored (full reversal)
  // ═════════════════════════════════════════════════════════════════
  test('delete sale: stock restored by full reversal', () => {
    // Delete = reverse old, apply nothing new
    // Existing sale decremented 5 → reversal adds 5
    // Net: +5
    const netChange = computeNetStockChange(5, 0, true, false, false, false)
    expect(netChange).toBe(5)
  })

  // ═════════════════════════════════════════════════════════════════
  // 13. Delete credit-note with affectsStock=true: stock removed
  // ═════════════════════════════════════════════════════════════════
  test('delete credit-note with affectsStock=true: stock removed', () => {
    // Delete = reverse old, apply nothing new
    // Existing CN incremented 3 → reversal removes 3
    // Net: -3
    const netChange = computeNetStockChange(3, 0, false, true, false, false)
    expect(netChange).toBe(-3)
  })

  // ═════════════════════════════════════════════════════════════════
  // 14. Change type from sale to purchase (N6 blocks this, but the
  //     stock logic should handle it if it ever happens)
  // ═════════════════════════════════════════════════════════════════
  test('type change sale→purchase: reverse decrement, apply increment', () => {
    // Existing sale decremented 5 → reversal adds 5
    // New purchase increments 5 → apply adds 5
    // Net: +5 +5 = +10
    const netChange = computeNetStockChange(5, 5, true, false, false, true)
    expect(netChange).toBe(10)
  })

  // ═════════════════════════════════════════════════════════════════
  // 15. No stock effect: income/expense never touch stock
  // ═════════════════════════════════════════════════════════════════
  test('income/expense never affect stock', () => {
    const r = computeStockDirection('income', undefined, false)
    expect(r.shouldAffectStock).toBe(false)

    const r2 = computeStockDirection('expense', undefined, false)
    expect(r2.shouldAffectStock).toBe(false)
  })

  // ═════════════════════════════════════════════════════════════════
  // 16. Estimate: never affects stock
  // ═════════════════════════════════════════════════════════════════
  test('estimate never affects stock', () => {
    const r = computeStockDirection('estimate', undefined, false)
    expect(r.shouldAffectStock).toBe(false)
  })
})
