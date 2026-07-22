/**
 * Turn a zod validation string into something a shopkeeper can act on.
 *
 * WHY (2026-07-22): the transaction routes returned
 *   { error: 'Validation failed', detail: 'items.0.unitPrice: Invalid input: expected number, received NaN' }
 * and readError() shows `message` or `error` — so the toast read "Validation
 * failed" with the useful half discarded. The user is told a save failed but
 * not which field to fix. `detail` is kept for support; `message` is what the
 * user reads.
 *
 * 🔒 REVISED same day, after a live test caught this helper making things
 * WORSE. Entering 2.5 packets of milk returns
 *   "items.0.quantity: Quantity must be a whole number for count units
 *    (pcs, dozen, box). Use kg/gm/ltr/ml for fractional quantities."
 * — a message already written for shopkeepers, naming both the rule and the
 * fix. The first version replaced it with "Item 1 has an invalid quantity.
 * Enter a number and save again", telling someone who had entered a perfectly
 * good number to enter a number. Now the schema's own wording wins whenever it
 * reads like a sentence; only zod's machine phrasing is rewritten.
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

/**
 * Phrasings zod generates itself. These name a TYPE problem, not a business
 * rule, and mean nothing to a shopkeeper — they get rewritten.
 */
const MACHINE_PHRASING = /^(invalid input|invalid|expected|required|must be a? ?(number|string|boolean))\b/i

export function friendlyValidationMessage(detail: unknown): string {
  const text = typeof detail === 'string' ? detail : JSON.stringify(detail ?? '')
  // "items.0.unitPrice: Invalid input: expected number, received NaN"
  const match = text.match(/(?:^|[\s,])(?:items\.(\d+)\.)?([A-Za-z]+)\s*:/)
  if (!match) return 'Some values could not be saved. Please check the amounts and try again.'

  const [, itemIndex, rawField] = match
  const label = FIELD_LABELS[rawField] ?? rawField
  const isItem = itemIndex !== undefined

  // Everything after "field:" is the reason. Stop at the next "field:" so a
  // multi-issue detail does not run several messages together.
  const rest = text.slice((match.index ?? 0) + match[0].length).trim()
  const reason = rest.split(/[,;]\s+(?=(?:items\.\d+\.)?[A-Za-z]+\s*:)/)[0].trim()

  if (reason && !MACHINE_PHRASING.test(reason)) {
    // The schema explained itself. Keep its wording and add only WHERE the
    // problem is — a bare "Too long" does not tell anyone which box to fix.
    const where = isItem
      ? `Item ${Number(itemIndex) + 1}`
      : label.charAt(0).toUpperCase() + label.slice(1)
    return `${where}: ${reason}`
  }

  if (isItem) {
    return `Item ${Number(itemIndex) + 1} has an invalid ${label}. Enter a number and save again.`
  }
  return `The ${label} is not valid. Please correct it and save again.`
}
