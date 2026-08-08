/**
 * e-invoicing applicability.
 *
 * The rule (Notification 10/2023-Central Tax): mandatory where aggregate
 * turnover exceeded ₹5 crore in ANY financial year from 2017-18 onwards,
 * PAN-wise, and it does not lapse if turnover later falls.
 *
 * The property these tests defend hardest: the app must never tell a liable
 * shop that it is exempt. Its own data can prove YES and can never prove NO.
 */
import { eInvoiceApplicability, EINVOICE_TURNOVER_THRESHOLD } from '@/lib/einvoice-applicability'

const CRORE = 1_00_00_000

describe('the app’s own data can prove liability', () => {
  it('is required when recorded turnover exceeds ₹5 crore, without asking', () => {
    // That money demonstrably passed through this app. No declaration needed.
    const r = eInvoiceApplicability(null, 6 * CRORE)
    expect(r.status).toBe('required')
  })

  it('overrides a "no" that the recorded figures contradict', () => {
    /*
     * A shopkeeper who ticked "never crossed ₹5 crore" and has since billed
     * ₹6 crore through this app is liable regardless of what they ticked. The
     * app should not help someone be wrong about their own obligation.
     */
    const r = eInvoiceApplicability(false, 6 * CRORE)
    expect(r.status).toBe('required')
  })
})

describe('the app’s own data can never prove exemption', () => {
  it('says "unknown", not "not required", when it has seen little turnover', () => {
    /*
     * The critical asymmetry. A qualifying year may predate the app, sit under
     * another GSTIN of the same PAN, or simply not be recorded. Reading low
     * recorded turnover as exemption would tell a liable shop it is exempt —
     * the one answer this must never get wrong.
     */
    const r = eInvoiceApplicability(null, 2 * CRORE)
    expect(r.status).toBe('unknown')
  })

  it('says "unknown" for a brand-new shop with no history at all', () => {
    expect(eInvoiceApplicability(null, 0).status).toBe('unknown')
    expect(eInvoiceApplicability(null, null).status).toBe('unknown')
  })
})

describe('the shopkeeper’s declaration', () => {
  it('is honoured when they say yes', () => {
    // They know about years before the app, and about their other GSTINs.
    const r = eInvoiceApplicability(true, 0)
    expect(r.status).toBe('required')
    expect(r.declared).toBe(true)
  })

  it('is honoured when they say no and nothing contradicts it', () => {
    const r = eInvoiceApplicability(false, 2 * CRORE)
    expect(r.status).toBe('not-required')
    expect(r.declared).toBe(true)
  })

  it('treats "not answered" as different from "no"', () => {
    /*
     * Collapsing the two would either nag a shop that has already answered, or
     * silently treat an unanswered shop as exempt. Three states, not two.
     */
    expect(eInvoiceApplicability(null, 0).status).toBe('unknown')
    expect(eInvoiceApplicability(false, 0).status).toBe('not-required')
    expect(eInvoiceApplicability(undefined, 0).status).toBe('unknown')
  })
})

describe('the threshold itself', () => {
  it('is ₹5 crore', () => {
    expect(EINVOICE_TURNOVER_THRESHOLD).toBe(5_00_00_000)
  })

  it('is exceeded, not merely met — the rule says "exceeds"', () => {
    expect(eInvoiceApplicability(null, EINVOICE_TURNOVER_THRESHOLD).status).toBe('unknown')
    expect(eInvoiceApplicability(null, EINVOICE_TURNOVER_THRESHOLD + 1).status).toBe('required')
  })
})
