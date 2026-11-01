/**
 * A credit/debit note's reason, in shop words — ONE list for the entry form's
 * choices and every place a saved note shows its reason (8f). The codes are
 * the ones validation.ts accepts.
 */
export const NOTE_REASONS = [
  { code: 'post-sale-discount', label: 'Discount after sale' },
  { code: 'deficiency', label: 'Deficiency in goods' },
  { code: 'return', label: 'Goods returned' },
  { code: 'price-revision', label: 'Price revision' },
  { code: 'other', label: 'Other' },
] as const

/** The label for a saved reason; an unknown code shows as itself, never a guess. */
export function noteReasonLabel(code: string | null | undefined): string {
  if (!code) return ''
  return NOTE_REASONS.find((r) => r.code === code)?.label ?? code
}
