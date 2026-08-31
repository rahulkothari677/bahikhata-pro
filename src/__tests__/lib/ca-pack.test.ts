/**
 * #33 — the month in the form a CA actually asks for.
 *
 * CA *access* already existed: a read-only login. This is the other thing,
 * because most CAs will not create an account in their client's app — they ask
 * for the figures over WhatsApp once a month.
 */

import { buildCaPack, type CaPackInput } from '@/lib/ca-pack'
import { readCode } from '@/test-support/read-source'

const BASE: CaPackInput = {
  shopName: 'Sharma Tailors',
  gstin: '27AAPFU0939F1ZV',
  monthLabel: 'August 2026',
  gstr1: { filingStatus: 'filed', taxableValue: 3350, outputTax: 174.5, invoiceCount: 3 },
  gstr3b: { filingStatus: 'draft', outputTax: 174.5, itcClaimed: 1800, netPayable: 0 },
  returnsAgree: { agree: true, difference: 0 },
  warnings: [],
}

describe('what a CA sees first', () => {
  test('warnings come BEFORE any figure', () => {
    /*
     * The whole design. A pack that opens with tables gets skimmed; one that
     * opens with "3 things need your attention" gets read — and these are the
     * items a CA would otherwise spend the monthly call hunting for.
     */
    const out = buildCaPack({
      ...BASE,
      warnings: [{ title: 'Input credit at risk', amount: '₹10,800', detail: 'Supplier unpaid past 180 days.' }],
    })
    expect(out.indexOf('NEEDING ATTENTION')).toBeLessThan(out.indexOf('GSTR-1'))
  })

  test('a clean month SAYS it is clean', () => {
    /*
     * Said explicitly rather than by omission. "Nothing here" and "we did not
     * check" look identical on a page that simply has no section, and a CA
     * cannot tell which they are reading.
     */
    const out = buildCaPack(BASE)
    expect(out).toContain('NOTHING NEEDS ATTENTION')
    expect(out).toMatch(/No filing risks/)
  })

  test('the count is singular or plural correctly', () => {
    const one = buildCaPack({ ...BASE, warnings: [{ title: 'A', amount: '', detail: 'x' }] })
    expect(one).toContain('1 THING NEEDING ATTENTION')
    const two = buildCaPack({
      ...BASE,
      warnings: [{ title: 'A', amount: '', detail: 'x' }, { title: 'B', amount: '', detail: 'y' }],
    })
    expect(two).toContain('2 THINGS NEEDING ATTENTION')
  })
})

describe('the reconciliation a CA does by hand', () => {
  test('a disagreement is stated as a NUMBER, not as an alarm', () => {
    // "They do not agree" is an alarm. "They differ by ₹1,620" is something to
    // go and look up.
    const out = buildCaPack({ ...BASE, returnsAgree: { agree: false, difference: 1620 } })
    expect(out).toContain('₹1,620.00')
    expect(out).toMatch(/Rule 88C/)
  })

  test('agreement is stated plainly', () => {
    expect(buildCaPack(BASE)).toMatch(/Yes\. Both declare the same tax/)
  })

  test('an unavailable return says so rather than showing zero', () => {
    /*
     * A missing return rendered as ₹0.00 reads as "nothing was sold", which is
     * a different and much worse claim.
     */
    const out = buildCaPack({ ...BASE, gstr1: null, returnsAgree: null })
    expect(out).toContain('Not available for this month.')
    expect(out).toMatch(/Could not be checked/)
  })
})

describe('filing status is never ambiguous', () => {
  test('draft is spelled out, not left as a word a CA must interpret', () => {
    // "draft" alone is easy to skim past. A CA needs to know at a glance that
    // this month is NOT filed.
    expect(buildCaPack(BASE)).toContain('DRAFT — not filed')
    expect(buildCaPack(BASE)).toContain('FILED')
  })
})

describe('it assembles, it never recalculates', () => {
  test('the pack builder takes figures and does no arithmetic on money', () => {
    /*
     * A second arithmetic path for the same month is the drift class behind
     * four bugs in this codebase, and it would be worst here: a pack that
     * disagrees with the screen it came from destroys the trust the feature
     * exists for.
     *
     * Asserted structurally — the builder may format, but must not add,
     * subtract or multiply money.
     */
    const src = readCode('src/lib/ca-pack.ts')
    expect(src).not.toMatch(/outputTax\s*[-+*]/)
    expect(src).not.toMatch(/itcClaimed\s*[-+*]/)
    expect(src).not.toMatch(/taxableValue\s*[-+*]/)
  })

  test('it says on the page that nothing was recalculated', () => {
    // So a CA reconciling against the screen knows a mismatch would be a bug,
    // not a different basis.
    expect(buildCaPack(BASE)).toMatch(/nothing is recalculated/)
  })
})

describe('the route assembles and the button reaches it', () => {
  const api = readCode('src/app/api/ca-pack/route.ts')
  const ui = readCode('src/components/reports/Gstr3bReport.tsx')

  test('figures come from the STORED snapshots, not a fresh computation', () => {
    /*
     * The constraint the whole feature depends on. Recomputing from
     * transactions could legitimately differ from what was filed if the books
     * moved afterwards — and a pack that disagrees with the screen it came
     * from destroys the trust it exists for.
     */
    expect(api).toContain('gstr1Snapshot.findUnique')
    expect(api).toContain('gstReturn.findUnique')
  })

  test('warnings reuse the same rules the screens use', () => {
    // Not re-derived. Two rules answering "is this credit at risk?" would
    // drift, and the pack would list things the app does not show.
    for (const fn of ['assessItcReversal', 'reviewProduct', 'imsWindow']) {
      expect({ fn, used: api.includes(fn) }).toEqual({ fn, used: true })
    }
  })

  test('the IMS warning is dropped once it can no longer be acted on', () => {
    // After the 14th the shopkeeper cannot change what was deemed accepted
    // from here, so listing it would be noise on a pack about a closed month.
    expect(api).toContain("ims.state === 'closing' || ims.state === 'open'")
  })

  test('the button exists and falls back when the clipboard refuses', () => {
    /*
     * Clipboard first because the destination is WhatsApp — a downloaded .txt
     * on a phone lands somewhere the shopkeeper must then go and find. But an
     * insecure context or a refusing browser must not lose the pack.
     */
    expect(ui).toContain('handleCaPack')
    expect(ui).toContain('Send to CA')
    expect(ui).toContain('navigator.clipboard.writeText')
    expect(ui).toContain("a.download = `GST_Pack_${month}.txt`")
  })
})
