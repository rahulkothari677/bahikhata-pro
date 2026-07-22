/**
 * The transaction routes used to return { error: 'Validation failed', detail }
 * and readError() surfaces `message` ?? `error` — so the user's toast said
 * "Validation failed" and the half that named the field was thrown away.
 */
import { friendlyValidationMessage } from '@/lib/friendly-validation'

describe('friendlyValidationMessage', () => {
  test('names the offending line item and field in 1-based terms', () => {
    const msg = friendlyValidationMessage(
      'items.0.unitPrice: Invalid input: expected number, received NaN',
    )
    expect(msg).toMatch(/Item 1/)
    expect(msg).toMatch(/rate/)
    // Never leak zod's wording at the user.
    expect(msg).not.toMatch(/expected number|received NaN|Invalid input/)
  })

  test('counts items from 1, not 0', () => {
    expect(friendlyValidationMessage('items.2.quantity: Required')).toMatch(/Item 3/)
  })

  test('handles top-level fields', () => {
    expect(friendlyValidationMessage('paidAmount: Expected number')).toMatch(/paid amount/)
    expect(friendlyValidationMessage('invoiceNo: Too long')).toMatch(/invoice number/i)
    // The schema's own reason survives alongside the field name.
    expect(friendlyValidationMessage('invoiceNo: Too long')).toMatch(/Too long/)
  })

  test('falls back to a safe sentence for unparseable input', () => {
    const msg = friendlyValidationMessage(undefined)
    expect(msg).toMatch(/check the amounts/i)
    expect(friendlyValidationMessage({ weird: true })).toBeTruthy()
  })


  test('a schema message that already explains the rule is kept verbatim', () => {
    // Found live: entering 2.5 packets of milk. The schema says exactly what
    // is wrong and how to fix it; the old template replaced that with
    // "Enter a number and save again" — advice the user had already followed.
    const msg = friendlyValidationMessage(
      'items.0.quantity: Quantity must be a whole number for count units (pcs, dozen, box). Use kg/gm/ltr/ml for fractional quantities.',
    )
    expect(msg).toMatch(/whole number for count units/)
    expect(msg).toMatch(/kg\/gm\/ltr\/ml/)
    expect(msg).toMatch(/^Item 1: /)
    expect(msg).not.toMatch(/Enter a number and save again/)
  })

  test('zod machine phrasing is still replaced with plain English', () => {
    const msg = friendlyValidationMessage('items.0.unitPrice: Invalid input: expected number, received NaN')
    expect(msg).toMatch(/Item 1 has an invalid rate/)
    expect(msg).not.toMatch(/expected number|received NaN/)
  })

  test('an unmapped field name is echoed rather than dropped', () => {
    expect(friendlyValidationMessage('noteReason: Required')).toMatch(/noteReason/i)
  })
})
