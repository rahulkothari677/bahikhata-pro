/**
 * Turn a zod validation string into something a shopkeeper can act on.
 *
 * WHY (2026-07-22): the transaction routes returned
 *   { error: 'Validation failed', detail: 'items.0.unitPrice: Invalid input: expected number, received NaN' }
 * and readError() shows `message` or `error` — so the toast read "Validation
 * failed" with the useful half discarded. The user is told a save failed but
 * not which field to fix. `detail` is kept for support; `message` is what the
 * user reads.
 */
const FIELD_LABELS: Record<string, string> = {
  unitPrice: 'rate',
  quantity: 'quantity',
  gstRate: 'GST rate',
  paidAmount: 'paid amount',
  discountAmount: 'discount',
  totalAmount: 'amount',
  invoiceNo: 'invoice number',
  partyId: 'customer',
  date: 'date',
}

export function friendlyValidationMessage(detail: unknown): string {
  const text = typeof detail === 'string' ? detail : JSON.stringify(detail ?? '')
  // "items.0.unitPrice: Invalid input: expected number, received NaN"
  const match = text.match(/(?:^|[\s,])(?:items\.(\d+)\.)?([A-Za-z]+)\s*:/)
  if (!match) return 'Some values could not be saved. Please check the amounts and try again.'
  const [, itemIndex, rawField] = match
  const label = FIELD_LABELS[rawField] ?? rawField
  if (itemIndex !== undefined) {
    return `Item ${Number(itemIndex) + 1} has an invalid ${label}. Enter a number and save again.`
  }
  return `The ${label} is not valid. Please correct it and save again.`
}
