/**
 * Where an estimate stands (#185, 25 Oct 2026): open until it is converted to
 * a sale. Converting stores the sale's id on the estimate (convertedToTransactionId,
 * written in one database transaction by /api/transactions/[id]/convert), so the
 * status is read from that stored fact — never guessed from dates or amounts.
 *
 * "Sent" is not tracked: nothing records a share yet (it would need a column).
 */
export type EstimateStatus = 'open' | 'converted'

export function estimateStatus(t: { type?: string | null; convertedToTransactionId?: string | null }): EstimateStatus | null {
  if (t.type !== 'estimate') return null
  return t.convertedToTransactionId ? 'converted' : 'open'
}
