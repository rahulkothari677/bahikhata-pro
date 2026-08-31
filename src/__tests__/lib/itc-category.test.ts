/**
 * #36 — Inputs / Capital Goods / Input Services, the split GSTR-9 Table 6 wants.
 *
 * Logged for weeks as "blocked on a CA". It was not. The definitions are clear;
 * what is NOT derivable is one of them:
 *
 *   capital goods = goods CAPITALISED IN THE BOOKS OF ACCOUNT   s.2(19)
 *
 * That is the buyer's accounting decision, not a property of the thing bought.
 * The same fridge is stock to an appliance dealer and a capital asset to a
 * chemist. No CA can answer it for a shop; only the shopkeeper can.
 */

import {
  deriveItcCategory,
  splitItc,
  isItcCategory,
} from '@/lib/itc-category'
import { readCode } from '@/test-support/read-source'
import { readFileSync } from 'fs'
import { join } from 'path'

describe('what can be derived, and the one thing that cannot', () => {
  test('a SAC is an input service', () => {
    // Same Chapter-99 test the product screen already uses to pre-tick "this
    // is a service" — one rule, so a purchase cannot be a service on one
    // screen and goods on another.
    expect(deriveItcCategory('998314')).toBe('services')
    expect(deriveItcCategory('9963')).toBe('services')
  })

  test('goods default to inputs', () => {
    for (const hsn of ['1006', '8471', '6109', null, undefined, '']) {
      expect({ hsn, cat: deriveItcCategory(hsn) }).toEqual({ hsn, cat: 'inputs' })
    }
  })

  test('CAPITAL GOODS IS NEVER DERIVED — the whole point', () => {
    /*
     * A suggester that guessed this would put equipment credit in the wrong
     * GSTR-9 row on every shop that never looked. It is reachable only by an
     * explicit choice.
     */
    const codes = ['8418', '8703', '9403', '84', '87', '99', '1006', '']
    for (const hsn of codes) {
      expect(deriveItcCategory(hsn)).not.toBe('capitalGoods')
    }
  })

  test('only the three real values are accepted', () => {
    expect(isItcCategory('inputs')).toBe(true)
    expect(isItcCategory('capitalGoods')).toBe(true)
    expect(isItcCategory('services')).toBe(true)
    for (const bad of ['input', 'capital', 'goods', '', null, undefined, 0]) {
      expect({ bad, ok: isItcCategory(bad) }).toEqual({ bad, ok: false })
    }
  })
})

describe('the split keeps the unrecorded part visible', () => {
  test('it adds up three ways', () => {
    const s = splitItc([
      { itcCategory: 'inputs', cgst: 90, sgst: 90, igst: 0 },
      { itcCategory: 'capitalGoods', cgst: 900, sgst: 900, igst: 0 },
      { itcCategory: 'services', cgst: 0, sgst: 0, igst: 180 },
    ])
    expect(s.inputs).toEqual({ cgst: 90, sgst: 90, igst: 0 })
    expect(s.capitalGoods).toEqual({ cgst: 900, sgst: 900, igst: 0 })
    expect(s.services).toEqual({ cgst: 0, sgst: 0, igst: 180 })
    expect(s.partial).toBe(false)
  })

  test('purchases predating the column are NOT counted as inputs', () => {
    /*
     * The most important assertion in this file.
     *
     * Every purchase made before 29 Aug 2026 has no category. Folding those
     * into 'inputs' would produce a Table 6 that looks complete and is mostly
     * assumption — exactly what `splitUnavailable` was protecting against. A
     * CA needs to see which part is recorded and which part is merely old.
     */
    const s = splitItc([
      { itcCategory: 'inputs', cgst: 90, sgst: 90, igst: 0 },
      { itcCategory: null, cgst: 500, sgst: 500, igst: 0 },
      { cgst: 10, sgst: 10, igst: 0 },
    ])
    expect(s.inputs).toEqual({ cgst: 90, sgst: 90, igst: 0 })
    expect(s.unclassified).toEqual({ cgst: 510, sgst: 510, igst: 0 })
    expect(s.partial).toBe(true)
  })

  test('an unrecognised value falls to unclassified, not to a guess', () => {
    // Refusing beats guessing. A typo in the column must not silently become
    // an input.
    const s = splitItc([{ itcCategory: 'capital', cgst: 100, sgst: 100, igst: 0 }])
    expect(s.unclassified.cgst).toBe(100)
    expect(s.inputs.cgst).toBe(0)
  })
})

describe('it is wired without guessing anywhere', () => {
  test('the server derives it, and an explicit choice wins', () => {
    const api = readCode('src/app/api/transactions/route.ts')
    // Derived server-side so a client cannot forget it and so one rule decides
    // it everywhere.
    expect(api).toContain('deriveItcCategory(')
    expect(api).toContain("itcCategory || deriveItcCategory")
  })

  test('a SALE never carries an input-credit category', () => {
    // A sale claims no input credit; a category on one would be meaningless
    // data that Table 6 might later add up.
    expect(readCode('src/app/api/transactions/route.ts'))
      .toContain("itcCategory: type === 'purchase'")
  })

  test('the migration does not backfill', () => {
    /*
     * Backfilling to 'inputs' would be a guess wearing the appearance of data,
     * and it would make Table 6 look complete when most of it was assumed.
     */
    /* Read with fs, not readCode — readCode resolves relative to src/ and
       cannot reach prisma/. Cost me one run. */
    const sql = readFileSync(
      join(process.cwd(), 'prisma/migrations/20260829000003_add_itc_category/migration.sql'),
      'utf8',
    )
    expect(sql).toContain('ADD COLUMN "itcCategory" TEXT')
    expect(sql).not.toMatch(/UPDATE\s+"Transaction"/i)
  })

  test('GSTR-9 still says "unavailable" when nothing is recorded', () => {
    /*
     * Three zeroes plus an unclassified bucket holding the whole year is
     * technically true and reads as a broken report. The flag stays.
     */
    expect(readCode('src/lib/gstr9-builder.ts')).toContain('splitUnavailable: recorded === 0')
  })
})
