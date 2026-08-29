/**
 * #91 — one bill cannot carry taxable and exempt items for a REGISTERED buyer.
 *
 * Tax invoice for taxable (Section 31(1)), bill of supply for exempt (Section
 * 31(3)(c)). Rule 46A allows ONE combined "invoice-cum-bill-of-supply" — but
 * only where the buyer is UNREGISTERED.
 *
 * That exception is most of a kirana's day, which is exactly why the rule is
 * easy to get wrong in the other direction: warn on everything and the warning
 * is noise.
 */

import { checkMixedSupply } from '@/lib/mixed-supply-invoice'
import { readCode } from '@/test-support/read-source'

const TAXABLE = { gstRate: 18 }
const EXEMPT = { gstRate: 0, gstTreatment: 'exempt' }
const NIL = { gstRate: 0, gstTreatment: 'nil' }
const GSTIN = '27AAPFU0939F1ZV'

describe('the exception that covers most of the day', () => {
  test('a walk-in customer can have one combined bill', () => {
    /*
     * Rule 46A exists for exactly this: rice and soap in the same basket. If
     * this warned, it would fire on nearly every kirana sale and be switched
     * off in a week.
     */
    for (const buyer of [null, undefined, '', '   ']) {
      expect(checkMixedSupply([TAXABLE, EXEMPT], buyer).needsSplit).toBe(false)
    }
  })

  test('a registered buyer needs two documents', () => {
    const r = checkMixedSupply([TAXABLE, EXEMPT], GSTIN)
    expect(r.needsSplit).toBe(true)
    expect(r.taxableCount).toBe(1)
    expect(r.exemptCount).toBe(1)
    expect(r.documents).toHaveLength(2)
  })
})

describe('only a genuine mix is flagged', () => {
  test('all taxable is fine', () => {
    expect(checkMixedSupply([TAXABLE, TAXABLE], GSTIN).needsSplit).toBe(false)
  })

  test('all exempt is fine — that is simply a bill of supply', () => {
    expect(checkMixedSupply([EXEMPT, NIL], GSTIN).needsSplit).toBe(false)
  })

  test('an empty bill is fine', () => {
    expect(checkMixedSupply([], GSTIN).needsSplit).toBe(false)
  })
})

describe('a 0% line is not automatically an exempt line', () => {
  test('taxable at 0% belongs on the tax invoice', () => {
    /*
     * A line marked 'taxable' at a nil tariff is still a taxable supply.
     * Counting it as exempt would split bills that need no splitting — and
     * this app now creates such lines deliberately, because the item screen
     * leaves a conditional item as 'taxable' until the shopkeeper answers.
     */
    const r = checkMixedSupply([TAXABLE, { gstRate: 0, gstTreatment: 'taxable' }], GSTIN)
    expect(r.needsSplit).toBe(false)
  })

  test('nil, exempt and non-GST all count as needing a bill of supply', () => {
    for (const t of ['nil', 'exempt', 'nonGst']) {
      const r = checkMixedSupply([TAXABLE, { gstRate: 0, gstTreatment: t }], GSTIN)
      expect({ t, split: r.needsSplit }).toEqual({ t, split: true })
    }
  })

  test('a 0% line with no treatment recorded is read as exempt', () => {
    // The honest reading of a zero-rate line with nothing else said about it,
    // and what older rows in a shop's books look like.
    expect(checkMixedSupply([TAXABLE, { gstRate: 0 }], GSTIN).needsSplit).toBe(true)
  })
})

describe('the message tells them what to do, not just what is wrong', () => {
  test('it names both documents and why one bill is not enough', () => {
    const r = checkMixedSupply([TAXABLE, TAXABLE, EXEMPT], GSTIN)
    expect(r.message).toMatch(/2 items with GST and 1 without/)
    expect(r.message).toMatch(/tax invoice/i)
    expect(r.message).toMatch(/bill of supply/i)
    // The exception matters as much as the rule — otherwise a shopkeeper
    // concludes they can never combine anything.
    expect(r.message).toMatch(/without a GSTIN/)
  })

  test('singular and plural are both handled', () => {
    // A tax warning that says "1 items" is one a shopkeeper trusts less.
    expect(checkMixedSupply([TAXABLE, EXEMPT], GSTIN).message).toMatch(/1 item with GST and 1 without/)
  })
})

describe('it reaches the screen where the bill is written', () => {
  const ui = readCode('src/components/ledger/TransactionEntry.tsx')

  test('the sale screen checks it as lines are added', () => {
    // A correct rule with no surface is not a feature — this codebase has
    // shipped that four times.
    expect(ui).toContain('checkMixedSupply')
    expect(ui).toContain('mixedSupply.needsSplit')
  })

  test('the line carries its treatment, so 0% is not assumed exempt', () => {
    /*
     * Without this the check reads every zero-rate line as exempt and splits
     * bills that need no splitting — and that matters now, because the item
     * screen deliberately leaves a conditional item as 'taxable' until the
     * shopkeeper answers the packaging question.
     */
    expect(ui).toContain('gstTreatment: product.gstTreatment ?? null')
    expect(ui).toContain('gstTreatment: i.gstTreatment')
  })

  test('it warns and does not block the sale', () => {
    /*
     * Someone at the counter with a customer waiting is the worst moment to
     * refuse a sale over a documentation rule. Blocking teaches them the app
     * gets in the way; the next thing they learn is how to work around it.
     */
    expect(ui).not.toMatch(/mixedSupply\.needsSplit[^\n]*return\b/)
    expect(ui).not.toMatch(/disabled=\{[^}]*mixedSupply/)
  })
})
