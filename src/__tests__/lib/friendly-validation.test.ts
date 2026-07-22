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
    expect(friendlyValidationMessage('invoiceNo: Too long')).toMatch(/invoice number/)
  })

  test('falls back to a safe sentence for unparseable input', () => {
    const msg = friendlyValidationMessage(undefined)
    expect(msg).toMatch(/check the amounts/i)
    expect(friendlyValidationMessage({ weird: true })).toBeTruthy()
  })

  test('an unmapped field name is echoed rather than dropped', () => {
    expect(friendlyValidationMessage('noteReason: Required')).toMatch(/noteReason/)
  })
})
