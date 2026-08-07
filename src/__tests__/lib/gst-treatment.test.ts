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
  it.each([
    ['0401', 'fresh milk'],
    ['0409', 'natural honey, unbranded'],
    ['0713', 'dal and pulses, unbranded'],
    ['1006', 'rice, unbranded'],
    ['1101', 'atta, unbranded'],
    ['2501', 'salt'],
    ['0407', 'eggs'],
  ])('%s (%s) → exempt', (hsn) => {
    expect(suggestGstTreatment(hsn, 0)).toBe('exempt')
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
     */
    expect(suggestGstTreatment('1701', 0)).toBe('nil')
    expect(suggestGstTreatment('1701', 5)).toBe('taxable')
  })
})
