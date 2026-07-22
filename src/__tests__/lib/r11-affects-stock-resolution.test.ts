/**
 * 🔒 R11-4 COMPLETION GUARD — affectsStock must be resolved ONCE, before use.
 *
 * THE BUG THIS LOCKS OUT
 * ----------------------
 * The EditTransactionDialog does not expose the credit/debit-note fields, so
 * `affectsStock` arrives as `undefined` on every edit and zod defaults it to
 * false. R11-4 added a "fall back to the existing value" rule — but applied it
 * ONLY in the update payload. The stock-direction variables a hundred lines
 * earlier still read the raw, un-defaulted value, so:
 *
 *   Edit a credit note that had affectsStock = true
 *     existingShouldIncrement = true  (from existing.affectsStock)
 *       -> reversal SUBTRACTS the stock
 *     shouldIncrementStock    = false (raw undefined -> false)
 *       -> the new impact is never applied
 *     net: stock silently DROPS by the note quantity, on every edit
 *
 * i.e. the stored flag looked correct while the actual stock kept corrupting —
 * exactly the failure the fix was written to prevent. The stored value and the
 * stock movement must derive from ONE resolved value.
 */

import fs from 'fs'
import path from 'path'

const ROUTE = path.join(process.cwd(), 'src/app/api/transactions/[id]/route.ts')

describe('R11-4 — affectsStock resolution in the edit path', () => {
  const src = fs.readFileSync(ROUTE, 'utf8')

  test('a single resolved value is computed', () => {
    expect(src).toMatch(/const resolvedAffectsStock = affectsStock !== undefined/)
  })

  test('stock DIRECTION uses the resolved value, not the raw field', () => {
    expect(src).toMatch(/shouldDecrementStock = type === 'sale' \|\| \(type === 'debit-note' && resolvedAffectsStock\)/)
    expect(src).toMatch(/shouldIncrementStock = type === 'purchase' \|\| \(type === 'credit-note' && resolvedAffectsStock\)/)
    // The raw form is what silently corrupted stock.
    expect(src).not.toMatch(/type === 'debit-note' && affectsStock\)/)
    expect(src).not.toMatch(/type === 'credit-note' && affectsStock\)/)
  })

  test('the STORED flag uses the same resolved value (they cannot disagree)', () => {
    expect(src).toMatch(/affectsStock: resolvedAffectsStock/)
    expect(src).not.toMatch(/affectsStock: affectsStock !== undefined \? affectsStock/)
  })

  describe('behavioural: the net stock impact of an unchanged-flag edit is zero', () => {
    /** Mirrors the route's direction logic for a credit note. */
    const directions = (existingAffects: boolean, incomingAffects: boolean | undefined) => {
      const resolved = incomingAffects !== undefined ? incomingAffects : (existingAffects ?? false)
      return {
        existingIncrements: existingAffects === true,
        newIncrements: resolved === true,
      }
    }

    test('editing a stock-affecting credit note re-applies what it reversed', () => {
      // Client omits the field (the real edit dialog behaviour).
      const d = directions(true, undefined)
      expect(d.existingIncrements).toBe(true)
      expect(d.newIncrements).toBe(true)   // was false before this fix
      // Reversal and re-application cancel -> net zero change to stock.
      expect(d.newIncrements).toBe(d.existingIncrements)
    })

    test('a deliberate change to the flag is still honoured', () => {
      const d = directions(true, false)
      expect(d.existingIncrements).toBe(true)
      expect(d.newIncrements).toBe(false)  // explicit false must NOT be overridden
    })

    test('a note that never affected stock stays unaffected', () => {
      const d = directions(false, undefined)
      expect(d.existingIncrements).toBe(false)
      expect(d.newIncrements).toBe(false)
    })
  })
})
