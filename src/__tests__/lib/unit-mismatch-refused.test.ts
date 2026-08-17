/**
 * @jest-environment node
 *
 * An unconvertible unit must REFUSE, not guess.
 *
 * WHY (audit 2026-08-17, reproduced live in a chemist account). A customer asks
 * for 4 tablets from a strip of 15. The sale returned 200 OK and stock went
 * 40 → 36 — four whole STRIPS taken off the shelf where 0.27 was correct.
 * Fifteen times too much.
 *
 * The money was right: 4 × ₹2.07 is what the customer pays. So the bill looked
 * perfect, nothing was reported, and for a chemist — where loose-tablet sales
 * are most sales — the shelf drifts from reality every hour of trading. Within
 * a week the app says they are out of a drug they hold 30 strips of.
 *
 * The cause was one line in `normalizeToUnit`: when the units could not be
 * converted it returned the quantity untouched, and the caller spent it as
 * though it were already in the product's unit. The comment said a guardrail
 * would flag anything implausible — but that guardrail watches MONEY, and here
 * the money is exactly right.
 *
 * We do not know how many tablets make a strip. That factor is per-product and
 * no per-product factor exists yet. So the fix is not a better guess, it is
 * refusing to guess at all.
 */
import { normalizeToUnit, resolveEnteredQuantity, normalizeUnitName } from '@/lib/units'
import fs from 'fs'
import path from 'path'

describe('the exact case that was reproduced live', () => {
  it('does not convert tablets into strips', () => {
    const r = normalizeToUnit(4, 'tablet', 'strip')
    expect(r.incompatible).toBe(true)
    expect(r.converted).toBe(false)
  })

  it('flags it rather than silently returning 4', () => {
    // The quantity still comes back — callers need it for the error message —
    // but `incompatible` is what stops it being spent as stock.
    const r = normalizeToUnit(4, 'tablet', 'strip')
    expect(r.quantity).toBe(4)
    expect(r.incompatible).toBe(true)
  })
})

describe('conversions that DO work must stay working', () => {
  // The fix must not make the app stricter than it was for units that have a
  // real, unambiguous factor. This is the regression half of the test.
  it.each([
    ['500 gm on a kg product', 500, 'gm', 'kg', 0.5],
    ['2 kg on a gm product', 2, 'kg', 'gm', 2000],
    ['250 ml on a ltr product', 250, 'ml', 'ltr', 0.25],
    ['1 dozen on a pcs product', 1, 'dozen', 'pcs', 12],
    ['50 cm on a m product', 50, 'cm', 'm', 0.5],
  ])('%s', (_label, qty, from, to, expected) => {
    const r = normalizeToUnit(qty, from, to)
    expect(r.incompatible).toBe(false)
    expect(r.quantity).toBeCloseTo(expected, 6)
  })

  it('the same unit is never incompatible', () => {
    expect(normalizeToUnit(3, 'strip', 'strip').incompatible).toBe(false)
    expect(normalizeToUnit(3, 'box', 'box').incompatible).toBe(false)
  })
})

describe('plurals and synonyms must not be mistaken for a mismatch', () => {
  /*
   * The docstring on normalizeUnitName promised it stripped a trailing "s" and
   * it never did — only the alias map was consulted. Harmless while unmatched
   * units were silently tolerated. NOT harmless now that a mismatch refuses the
   * write: a supplier bill saying "2 Packets" against a product measured in
   * `packet` would have been rejected.
   */
  it.each([
    ['packets', 'packet'], ['Pkt', 'packet'], ['packs', 'packet'],
    ['boxes', 'box'], ['bags', 'bag'], ['strips', 'strip'],
    ['bottles', 'bottle'], ['tins', 'tin'], ['sachets', 'sachet'],
    ['Nos', 'pcs'], ['pieces', 'pcs'], ['pc', 'pcs'],
    ['litres', 'ltr'], ['grams', 'gm'], ['metre', 'm'],
  ])('%s resolves to %s', (input, expected) => {
    expect(normalizeUnitName(input)).toBe(expected)
  })

  it('so "2 Packets" against a packet product is accepted, not refused', () => {
    const r = normalizeToUnit(2, 'Packets', 'packet')
    expect(r.incompatible).toBe(false)
    expect(r.quantity).toBe(2)
  })
})

describe('the other pack units that share this cause', () => {
  // D-09: buying 1 box of 24 raised stock by 1. Same root, quieter symptom.
  it.each([
    ['box → pcs', 'box', 'pcs'],
    ['packet → kg', 'packet', 'kg'],
    ['bag → kg', 'bag', 'kg'],
    ['bottle → ltr', 'bottle', 'ltr'],
    ['strip → pcs', 'strip', 'pcs'],
  ])('%s is refused rather than guessed', (_l, from, to) => {
    expect(normalizeToUnit(1, from, to).incompatible).toBe(true)
  })
})

describe('resolveEnteredQuantity carries the flag through', () => {
  it('for a product-linked line', () => {
    expect(resolveEnteredQuantity(4, 'tablet', 'strip').incompatible).toBe(true)
    expect(resolveEnteredQuantity(500, 'gm', 'kg').incompatible).toBe(false)
  })

  it('an unlinked line is never incompatible — there is no stock to corrupt', () => {
    // A custom line with no catalog product moves no stock, so nothing to guard.
    expect(resolveEnteredQuantity(4, 'tablet', null).incompatible).toBe(false)
  })
})

describe('both write paths actually refuse', () => {
  // Source checks on purpose: they assert the WIRING, which the unit tests
  // above cannot see. The rule that produced them is R10 — never assert a
  // guard exists without checking.
  const CREATE = fs.readFileSync(
    path.join(process.cwd(), 'src/app/api/transactions/route.ts'), 'utf8')
  const EDIT = fs.readFileSync(
    path.join(process.cwd(), 'src/app/api/transactions/[id]/route.ts'), 'utf8')

  it('create: checks the flag and returns 400 rather than writing stock', () => {
    expect(CREATE).toMatch(/if \(norm\.incompatible\)/)
    expect(CREATE).toMatch(/unitConflicts\.length > 0/)
    expect(CREATE).toMatch(/status: 400/)
  })

  it('create: the refused line never reaches the stock map', () => {
    const at = CREATE.indexOf('if (norm.incompatible)')
    const after = CREATE.slice(at, at + 400)
    // `continue` must come before qtyByProduct.set for that line.
    expect(after).toMatch(/continue/)
    expect(after.indexOf('continue')).toBeLessThan(
      after.indexOf('qtyByProduct.set') === -1 ? Infinity : after.indexOf('qtyByProduct.set'))
  })

  it('edit: throws so the interactive transaction rolls back', () => {
    expect(EDIT).toMatch(/if \(normNew\.incompatible\)/)
    expect(EDIT).toMatch(/throw new UnitMismatchError\(/)
    expect(EDIT).toMatch(/error instanceof UnitMismatchError/)
  })

  it('edit: the REVERSAL path is deliberately left lenient', () => {
    /*
     * Reversing an old line must undo exactly what was applied at the time,
     * incompatible unit and all. Refusing there would make historical
     * transactions uneditable AND would leave stock double-counted, because
     * the reversal is one half of a pair.
     */
    const revStart = EDIT.indexOf('for (const oldItem of oldItems)')
    const revEnd = EDIT.indexOf('// New items: apply their stock impact')
    expect(revStart).toBeGreaterThan(-1)
    expect(revEnd).toBeGreaterThan(revStart)
    expect(EDIT.slice(revStart, revEnd)).not.toMatch(/incompatible/)
  })

  it('the message names the product and both units', () => {
    expect(CREATE).toMatch(/is measured in \$\{c\.productUnit\}/)
    expect(CREATE).toMatch(/does not know how many \$\{c\.enteredUnit\} make one \$\{c\.productUnit\}/)
  })
})
