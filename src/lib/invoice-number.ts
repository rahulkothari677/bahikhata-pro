/**
 * What a bill is called.
 *
 * 🐛 2026-08-16. `Setting.invoicePrefix` and `Setting.invoiceNextNumber` were
 * saved by the settings screen, validated by the API, and read by NOTHING. A
 * shopkeeper typed "RG/26-27/", watched the screen promise "your next bill
 * will be RG/26-27/47", and every bill still came out INV-0001.
 *
 * That is the invoiceTheme bug again — a setting that saves and does nothing —
 * and it was my own Phase 3 work. The test I wrote checked that the API
 * VALIDATED the field. It never checked that anything USED it, which is the
 * difference between a guard and a comment.
 *
 * ── WHY IT IS NOT COSMETIC ────────────────────────────────────────────
 *
 * Rule 46(b) requires a consecutive serial number, unique within a financial
 * year. A shopkeeper moving off a paper book has a series already running and
 * must continue it — restarting at 1 creates a duplicate series for the year.
 * Carrying it forward is the entire reason the setting exists.
 *
 * ── THE NUMBER STILL COMES FROM THE ATOMIC COUNTER ────────────────────
 *
 * Only the FORMATTING lives here. The sequence is allocated by an atomic
 * increment inside the write transaction, which is what stops two tills
 * issuing one invoice number — a duplicate would be a Rule 46(b) breach, not
 * an inconvenience. This file never invents a number.
 */

/** The zero-padded default, unchanged since before prefixes existed. */
const DEFAULT_PAD = 4

/**
 * Format one invoice number.
 *
 * A plain function over two plain arguments SPECIFICALLY so it can be run
 * against a shop with a prefix and one without, rather than only by creating
 * a sale — CLAUDE.md, Cause 7.
 *
 * WITH NO PREFIX the output is byte-identical to what this app produced
 * before: `INV-0001`. A shop that never opens the setting sees no change to
 * its numbering, which matters because an invoice series that changes shape
 * mid-year is exactly what Rule 46(b) is about.
 *
 * WITH A PREFIX the number is NOT padded: a shopkeeper who types "RG/26-27/"
 * and starts at 47 means 47, not 0047. Padding is a default this app chose,
 * not something to impose on a series they already run.
 */
export function formatInvoiceNo(
  prefix: string | null | undefined,
  sequence: number,
  fallbackPrefix = 'INV-',
): string {
  const p = (prefix ?? '').trim()
  if (!p) return `${fallbackPrefix}${String(sequence).padStart(DEFAULT_PAD, '0')}`
  return `${p}${sequence}`
}
