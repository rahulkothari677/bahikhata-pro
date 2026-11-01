/**
 * #115: with no GSTR-2B imported, the readiness card must not say "You can
 * file". The credit is the books' figure, so the tax to pay may be too low.
 */
import { describe, test, expect } from '@jest/globals'
import { itcVerificationCheck } from '@/lib/gst-readiness-checks'

describe('#115 — no 2B is a blocker, not a warning', () => {
  test('purchases this month and no 2B → blocker with the import door', () => {
    const c = itcVerificationCheck(null, 3)!
    expect(c.severity).toBe('blocker')
    expect(c.title).toBe('Import GSTR-2B before filing')
    expect(c.action?.label).toBe('Import GSTR-2B')
  })
  test('a 2B imported → ok, with the count', () => {
    const c = itcVerificationCheck({ invoiceCount: 1 }, 3)!
    expect(c.severity).toBe('ok')
    expect(c.detail).toMatch(/1 bill from/)
  })
  test('no purchases → nothing to check, no card line', () => {
    expect(itcVerificationCheck(null, 0)).toBeNull()
  })
})
