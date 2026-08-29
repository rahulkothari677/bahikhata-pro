/**
 * Intra-state e-way bill thresholds.
 *
 * THE BUG the CA review found: we warned at ₹50,000 for movement INSIDE
 * Maharashtra, where the notified threshold is ₹1,00,000. Every consignment
 * between those figures got a warning it did not need — and a warning that is
 * usually wrong teaches a shopkeeper to dismiss the one that matters.
 *
 * THE ASYMMETRY THESE TESTS PROTECT. A wrong LOW threshold nags. A wrong HIGH
 * threshold lets goods move without a bill: ₹10,000 penalty and a detained
 * vehicle. So an unknown state must always fall back to ₹50,000, never to a
 * guess — that is the assertion that matters most here.
 */
import { ewayBillNeed, thresholdFor, EWAY_BILL_THRESHOLD, INTRA_STATE_THRESHOLDS } from '@/lib/eway-bill'

const goods = { movesGoods: true }

describe('Maharashtra, the state the CA named', () => {
  test('₹60,000 moving inside Maharashtra does NOT need one', () => {
    // This is the exact false positive he reported.
    const r = ewayBillNeed({ ...goods, consignmentValue: 60_000, isInterState: false, stateCode: '27' })
    expect(r.status).toBe('not-required')
    expect(r.reason).toMatch(/1,00,000/)
    expect(r.reason).toMatch(/Maharashtra/)
  })

  test('₹1,20,000 inside Maharashtra DOES, and cites the notification', () => {
    const r = ewayBillNeed({ ...goods, consignmentValue: 120_000, isInterState: false, stateCode: '27' })
    expect(r.status).toBe('likely-required')
    expect(r.reason).toMatch(/Notification 15E/)
  })

  test('exactly ₹1,00,000 does not — the rule says ABOVE', () => {
    expect(ewayBillNeed({ ...goods, consignmentValue: 100_000, isInterState: false, stateCode: '27' }).status)
      .toBe('not-required')
  })
})

describe('the safe direction is preserved', () => {
  test('an unknown state still uses ₹50,000, never a guess', () => {
    // Gujarat (24) is not in the table. It may well have a higher limit — but
    // assuming one would silently stop warning, which is the costly failure.
    const r = ewayBillNeed({ ...goods, consignmentValue: 60_000, isInterState: false, stateCode: '24' })
    expect(r.status).toBe('likely-required')
    expect(thresholdFor(false, '24').amount).toBe(EWAY_BILL_THRESHOLD)
  })

  test('no state code at all falls back to ₹50,000', () => {
    expect(thresholdFor(false, null).amount).toBe(EWAY_BILL_THRESHOLD)
    expect(thresholdFor(false, undefined).amount).toBe(EWAY_BILL_THRESHOLD)
  })

  test('INTER-state is always ₹50,000, even for a state with a higher intra limit', () => {
    // Rule 138 sets the inter-state figure centrally; no state can raise it.
    // Applying Maharashtra's ₹1L to a consignment leaving the state would be
    // the dangerous direction.
    const r = ewayBillNeed({ ...goods, consignmentValue: 60_000, isInterState: true, stateCode: '27' })
    expect(r.status).toBe('likely-required')
    expect(thresholdFor(true, '27').amount).toBe(EWAY_BILL_THRESHOLD)
  })

  test('every entry in the table cites its notification', () => {
    // A threshold with no source cannot be checked by a CA, and an unverifiable
    // higher limit is exactly what this file warns against.
    for (const [code, rule] of Object.entries(INTRA_STATE_THRESHOLDS)) {
      expect(code).toMatch(/^\d{2}$/)
      expect(rule.amount).toBeGreaterThan(EWAY_BILL_THRESHOLD)
      expect(rule.source.length).toBeGreaterThan(5)
      expect(rule.state.length).toBeGreaterThan(2)
    }
  })
})

describe('services are unaffected', () => {
  test('a service invoice never needs one, whatever the value or state', () => {
    expect(ewayBillNeed({ movesGoods: false, consignmentValue: 500_000, isInterState: false, stateCode: '27' }).status)
      .toBe('not-required')
  })
})
