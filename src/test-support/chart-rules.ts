/**
 * Chart rules (Phase 5a-1, #237).
 *
 * A chart that answers "this period" must only read period figures. Balances
 * (what customers owe, what the shop owes suppliers) are a snapshot at today's
 * date; mixing one into a period chart produced Home's "Purchases ₹1.5K" line
 * that was really the payable balance. Balances have their own cards.
 */
export const BALANCE_FIELDS = ['totalPayable', 'totalReceivable'] as const

/** Every place a balance field is read in a period-chart source file. */
export function balanceFieldsInPeriodChart(code: string): string[] {
  const out: string[] = []
  for (const field of BALANCE_FIELDS) {
    const re = new RegExp(`\\b${field}\\b`, 'g')
    for (const m of code.matchAll(re)) {
      const line = code.slice(0, m.index).split(/\r?\n/).length
      out.push(`line ${line}: reads ${field}`)
    }
  }
  return out
}
