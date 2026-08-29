/**
 * #94 — finding the products the CANCELLED notification classified.
 *
 * Every product entered before 29 Aug 2026 had its GST treatment decided
 * against Notification 2/2017, superseded by 10/2025. Fixing the rule going
 * forward leaves those rows untouched, and GSTR-1 reads them every month.
 *
 * `reviewProduct` is a pure function of three values precisely so these can be
 * run both ways without a database — the rule CLAUDE.md earned after five
 * guards that could not fail.
 */

import { reviewProduct } from '@/lib/exempt-reclassification'
import { readCode } from '@/test-support/read-source'

const P = (hsn: string | null, gstRate: number, gstTreatment: string) =>
  reviewProduct({ hsn, gstRate, gstTreatment })

describe('the eleven prefixes the old list got wrong', () => {
  /*
   * These are the ones that matter. All twenty-one prefixes on the cancelled
   * list were marked exempt with NO condition. Under 10/2025 eleven of them
   * carry one — and the condition is something only the shopkeeper can see.
   */
  test.each([
    ['1006', 'rice'],
    ['1101', 'atta'],
    ['0713', 'dal and pulses'],
    ['0409', 'honey'],
    ['1001', 'wheat'],
    ['1102', 'other cereal flours'],
    ['0403', 'curd, lassi, buttermilk'],
    ['0701', 'potatoes'],
    ['0702', 'tomatoes'],
    ['0703', 'onions and garlic'],
    ['0706', 'carrots'],
  ])('%s (%s) marked exempt is flagged for confirmation', (hsn) => {
    const r = P(hsn, 0, 'exempt')
    expect(r.verdict).toBe('needs-answer')
    expect(r.conditions.length).toBeGreaterThan(0)
  })

  test('an already-exempt item is called UNVERIFIED, not wrong', () => {
    /*
     * Wording matters more than usual here. "Exempt" may well still be right
     * for this shop — loose rice genuinely is exempt. Telling a shopkeeper
     * their books are wrong when they are probably right destroys trust in
     * every other thing the app says.
     */
    const r = P('1006', 0, 'exempt')
    expect(r.reason).toMatch(/old notification/)
    expect(r.reason).toMatch(/confirm/)
    expect(r.reason).not.toMatch(/wrong|incorrect|error/i)
  })

  test('the ten still-unconditional prefixes are NOT flagged', () => {
    // Milk, paneer, eggs, salt, fruit. Flagging these would bury the eleven
    // that need looking at under eleven more that do not.
    for (const hsn of ['0401', '0406', '0407', '2501', '0801', '0803', '0804', '0805', '0806']) {
      expect({ hsn, verdict: P(hsn, 0, 'exempt').verdict }).toEqual({ hsn, verdict: 'ok' })
    }
  })
})

describe('items pointing the other way', () => {
  test('an outright-exempt good marked nil-rated is flagged', () => {
    // Salt is exempt with no condition. Nil-rated and exempt are different
    // boxes in GSTR-1 — this is the CA's "wrong treatment" in the other
    // direction, and it is the one case safe to offer a one-click fix for.
    const r = P('2501', 0, 'nil')
    expect(r.verdict).toBe('should-be-exempt')
    expect(r.suggested).toBe('exempt')
  })

  test('exempt with a tax rate on it is a contradiction, and named as one', () => {
    const r = P('1006', 5, 'exempt')
    expect(r.verdict).toBe('should-be-exempt')
    expect(r.reason).toMatch(/cannot both be true/)
    expect(r.suggested).toBe('taxable')
  })

  test('an exempt claim on a code the notification does not list', () => {
    const r = P('8471', 0, 'exempt')     // computers
    expect(r.verdict).toBe('no-longer-listed')
  })

  test('...and NO fix is offered for it, deliberately', () => {
    /*
     * Either the HSN is wrong or the treatment is, and this cannot tell which.
     * A one-click "make it taxable" on a screen designed to be clicked through
     * quickly would push people into changing the half that is probably right.
     * Refusing beats guessing.
     */
    expect(P('8471', 0, 'exempt').suggested).toBeNull()
  })
})

describe('what it must stay quiet about', () => {
  test('a taxed product is not questioned, whatever its HSN', () => {
    // A rate above zero means the shopkeeper has said they charge tax. Same
    // precedence as suggestGstTreatment and the item screen — three places
    // deciding one product must decide it the same way.
    expect(P('1006', 5, 'taxable').verdict).toBe('ok')
    expect(P('0401', 18, 'taxable').verdict).toBe('ok')
  })

  test('a product with no HSN is not flagged', () => {
    /*
     * The notification cannot be consulted without a code. Saying "this might
     * be wrong" about every code-less product would bury the real rows in
     * noise, and the HSN report already asks for the code.
     */
    expect(P(null, 0, 'taxable').verdict).toBe('ok')
    expect(P('', 0, 'exempt').verdict).toBe('ok')
  })

  test('services are left alone', () => {
    // Chapter 99 services are exempted by notification 12/2017, which this
    // table does not carry. Silence, not a guess.
    expect(P('998314', 0, 'exempt').verdict).toBe('ok')
    expect(P('9963', 0, 'nil').verdict).toBe('ok')
  })

  test('an ordinary 0% good not on the list is not flagged', () => {
    // "Not exempt" is the ordinary state of most goods and says nothing.
    expect(P('9503', 0, 'nil').verdict).toBe('ok')
    expect(P('8471', 0, 'taxable').verdict).toBe('ok')
  })
})

describe('every finding can be acted on, or explains why not', () => {
  test('a flagged row carries the notification’s own words and its entry', () => {
    // §0 — every figure shows receipts that open the real record. A row that
    // says "this needs a look" without saying what the law says is just an
    // alarm.
    const r = P('1006', 0, 'exempt')
    expect(r.description).toMatch(/Rice/)
    expect(r.source).toMatch(/10\/2025/)
    expect(typeof r.serial).toBe('number')
  })
})

describe('the review never writes on its own', () => {
  const api = readCode('src/app/api/products/exempt-review/route.ts')
  const ui = readCode('src/components/inventory/ExemptReclassifyReview.tsx')

  test('there is no bulk-apply endpoint', () => {
    /*
     * The whole point is that a PERSON decided each row. An "apply all" would
     * recreate the defect being repaired: hundreds of treatments set by a rule
     * rather than by the shopkeeper, and this time with their consent implied
     * rather than given.
     */
    expect(api).not.toMatch(/updateMany\(\{\s*where:\s*\{\s*userId[^}]*\}\s*,\s*data/)
    expect(api).toContain('productId')
  })

  test('the write is scoped by userId in the WHERE, not checked after loading', () => {
    // One shop's data must never depend on our code remembering to compare an
    // id. The database refuses instead.
    expect(api).toMatch(/where:\s*\{\s*id:\s*productId,\s*userId:/)
  })

  test('the scan is capped, and says so when the cap bites', () => {
    /*
     * A silent limit on a compliance screen is a lie with a number on it: the
     * shopkeeper fixes nine rows, sees an empty list, and believes they are
     * done.
     */
    expect(api).toContain('SCAN_CAP')
    expect(api).toContain('truncated')
    expect(api).toContain('truncationNote')
  })

  test('the database does the narrowing, not the app', () => {
    // Only zero-rated rows can disagree. Reading the whole catalogue to filter
    // in memory stops working long before anyone notices it started.
    expect(api).toMatch(/where:\s*\{\s*userId,\s*gstRate:\s*0\s*\}/)
  })

  test('the card hides itself when there is nothing to review', () => {
    // A healthy shop should not carry a permanent compliance banner it can
    // never clear.
    expect(ui).toContain('data.findingCount === 0) return null')
  })

  test('the count is shown against a denominator', () => {
    // "12 problems" reads as a disaster; "12 of your 340 zero-rated items"
    // reads as an afternoon. A compliance screen that frightens people gets
    // closed and never reopened.
    expect(ui).toContain('zeroRatedScanned')
  })
})
