/**
 * HSN-based GST treatment suggestions.
 *
 * A wrong classification is a wrong return, so the rule these tests defend is
 * that the suggester says NOTHING when it is not sure, and never overrules a
 * shopkeeper who has already decided.
 */
import { suggestGstTreatment, shouldApplySuggestion } from '@/lib/gst-treatment'

describe('the rate overrules the code', () => {
  it('calls anything carrying tax taxable, whatever its HSN', () => {
    // Packaged atta is 1101 AND 5%. Treating it as exempt because of the
    // chapter would push taxed sales into the exempt box of a filed return.
    expect(suggestGstTreatment('1101', 5)).toBe('taxable')
    expect(suggestGstTreatment('0401', 12)).toBe('taxable')
    expect(suggestGstTreatment('2501', 18)).toBe('taxable')
  })
})

describe('zero-rated goods are sorted into the right box', () => {
  /*
   * REWRITTEN 29 Aug 2026, and the split below is the whole point.
   *
   * These used to assert that honey, dal, rice and atta are 'exempt'. They no
   * longer are — not because the law changed, but because this file used to
   * encode a guess. Every one of those four is exempt in Notification 10/2025
   * ONLY "other than pre-packaged and labelled", and the old list wrote that
   * condition into a code comment reading "(unbranded)". A comment cannot be
   * read at runtime, so the code answered "exempt" for branded packaged atta
   * exactly as readily as for loose atta.
   *
   * Updating a test to match new behaviour is normally a smell, so the reason
   * is stated per case rather than assumed: the app cannot see the packet, and
   * putting a taxed sale in the exempt box of GSTR-1 is a wrong return.
   */
  it.each([
    ['0401', 'fresh milk — exempt however it is sold'],
    ['2501', 'salt — no condition in the notification'],
    ['0407', 'eggs in shell — no condition'],
    ['0406', 'paneer — exempt WHETHER OR NOT pre-packaged'],
  ])('%s (%s) → exempt', (hsn) => {
    expect(suggestGstTreatment(hsn, 0)).toBe('exempt')
  })

  it.each([
    ['0409', 'honey — exempt only if not pre-packaged and labelled'],
    ['0713', 'dal and pulses — same condition'],
    ['1006', 'rice — same condition'],
    ['1101', 'atta — same condition'],
    ['0403', 'curd — same condition'],
  ])('%s (%s) → stays silent, because only the shopkeeper knows', (hsn) => {
    /*
     * Null means "leave whatever is there". This IS a deliberate loss of
     * coverage — loose rice and loose dal are common, and they used to get a
     * confident answer. The trade is correct: the condition is packaging, the
     * app cannot see the packet, and #93 asks on the item screen where the
     * shopkeeper is looking at the thing.
     */
    expect(suggestGstTreatment(hsn, 0)).toBeNull()
  })

  it('0403 and 0406 are treated differently, though they read almost alike', () => {
    /*
     * The single sharpest case in the notification:
     *   0403  "Curd, Lassi, Butter milk, OTHER THAN pre-packaged and labelled"
     *   0406  "Chena or paneer, WHETHER OR NOT pre-packaged and labelled"
     * Same shape, opposite meaning. A substring match on "pre-packaged and
     * labelled" marks both conditional and asks a pointless question about
     * paneer — and a shopkeeper asked a question that has no bearing on the
     * answer learns to dismiss the ones that do.
     */
    expect(suggestGstTreatment('0403', 0)).toBeNull()
    expect(suggestGstTreatment('0406', 0)).toBe('exempt')
  })

  it.each([
    ['2710', 'petrol and diesel'],
    ['2208', 'spirits'],
    ['2203', 'beer'],
  ])('%s (%s) → non-GST', (hsn) => {
    expect(suggestGstTreatment(hsn, 0)).toBe('nonGst')
  })

  it('a 0% good with a known code on neither list → nil-rated', () => {
    // "Taxable supply, tariff rate zero" — the correct residual.
    expect(suggestGstTreatment('9503', 0)).toBe('nil')
  })

  it('matches on prefix, so 6- and 8-digit codes work', () => {
    expect(suggestGstTreatment('040110', 0)).toBe('exempt')
    expect(suggestGstTreatment('27101990', 0)).toBe('nonGst')
  })
})

describe('it stays silent when it does not know', () => {
  it('offers nothing for a 0% product with no HSN', () => {
    // Genuinely ambiguous — could be exempt produce or a nil-rated good.
    // A missing suggestion beats a guessed one on a tax return.
    expect(suggestGstTreatment(null, 0)).toBeNull()
    expect(suggestGstTreatment('', 0)).toBeNull()
    expect(suggestGstTreatment('   ', 0)).toBeNull()
  })
})

describe('a shopkeeper’s own decision is never overwritten', () => {
  it('fills a blank', () => {
    expect(shouldApplySuggestion(null, 'exempt')).toBe(true)
  })

  it('corrects the untouched "taxable" default on a zero-tax product', () => {
    // Every product starts 'taxable' by schema default. On a 0% good that is
    // not a decision, it is an absence of one.
    expect(shouldApplySuggestion('taxable', 'exempt')).toBe(true)
  })

  it('leaves an explicit choice alone, even if the table disagrees', () => {
    // The shopkeeper knows whether their rice is branded. This knows a prefix.
    expect(shouldApplySuggestion('nil', 'exempt')).toBe(false)
    expect(shouldApplySuggestion('exempt', 'nil')).toBe(false)
    expect(shouldApplySuggestion('nonGst', 'exempt')).toBe(false)
  })

  it('does nothing when there is no suggestion to make', () => {
    expect(shouldApplySuggestion('taxable', null)).toBe(false)
    expect(shouldApplySuggestion(null, null)).toBe(false)
  })
})

describe('goods whose zero rate would be a data error, not a fact', () => {
  it('does not call sugar exempt, even at 0%', () => {
    /*
     * Sugar (1701) is 5% GST. It was on the exempt list initially, reasoned
     * safe because the rate check would catch it — and the rate check does
     * work. But a shop's record had sugar at 0%, so the check passed and the
     * suggester confidently classified a 5% commodity as exempt.
     *
     * The rate guard protects a correctly-priced product with a misleading HSN.
     * It cannot protect a MIS-priced one — and a shopkeeper who typed the wrong
     * rate is precisely who needs this to be conservative.
     *
     * ── THE ANSWER IMPROVED ON 29 Aug 2026: 'nil' → null ──────────────────
     *
     * This used to expect 'nil'. Silence is better, and the reason is a fact
     * about the tariff I did not know when I wrote the line above: heading
     * 1701 carries BOTH refined sugar (5%) AND jaggery/gur, which Notification
     * 10/2025 exempts when sold loose. One code, two goods, opposite answers.
     *
     * So a 0% product marked 1701 is genuinely ambiguous — it could be loose
     * gur, correctly exempt, or mis-priced sugar. 'nil' asserted the wrong box
     * for gur while merely being unhelpful for sugar. Null asserts neither and
     * leaves the shopkeeper's own value alone, which is what this whole file
     * is built on.
     */
    expect(suggestGstTreatment('1701', 0)).toBeNull()
    expect(suggestGstTreatment('1701', 5)).toBe('taxable')
  })
})

describe('services are not guessed at', () => {
  it('offers no suggestion for a zero-rated service', () => {
    /*
     * This app serves every kind of shop, not only a kirana. The exempt list
     * here is GOODS, exempted by Notification 10/2025 (which superseded
     * 2/2017, cited here until 29 Aug 2026). Services are exempted by
     * a different notification (12/2017) with a different list, which this file
     * does not carry — so for a zero-rated service the honest answer is "I do
     * not know", not the residual "nil-rated".
     */
    expect(suggestGstTreatment('998314', 0)).toBeNull()   // IT consulting
    expect(suggestGstTreatment('9963', 0)).toBeNull()     // accommodation, food
  })

  it('still calls a taxed service taxable', () => {
    // The rate answers this one regardless of goods-vs-services.
    expect(suggestGstTreatment('998314', 18)).toBe('taxable')
  })

  it('does not mistake a goods code beginning with 9 for a service', () => {
    // 9503 is toys — goods. Only the two-digit prefix 99 means services.
    expect(suggestGstTreatment('9503', 0)).toBe('nil')
  })
})
