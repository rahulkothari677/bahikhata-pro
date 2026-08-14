/**
 * What the shopkeeper is TOLD after a restore.
 *
 * WHY THIS FILE EXISTS (audit 2026-08-14). The restore screen composed its own
 * toast from a handful of counters and never rendered the server's `message` at
 * all. So a warning added on the server — "this backup file contains no payment
 * records", "3 payment-to-bill links could not be restored" — was written,
 * returned, and silently dropped on the floor.
 *
 * That is the exact failure silent-failure-reporting.test.ts was written about:
 * a problem counted server-side and a success shown to the user. Fixing only my
 * two new warnings would leave the next one to be lost the same way, so the
 * server now returns `warnings` as a LIST and this function always renders all
 * of them, whatever they turn out to be.
 *
 * Lives here, not inline in Settings.tsx, so it can be tested by being CALLED.
 */

export interface RestoreResponse {
  message?: string
  /**
   * Self-contained sentences about anything that did not fully survive. Always
   * shown. New warnings must be pushed here rather than only into `message`.
   */
  warnings?: string[]
  results?: {
    products?: { imported?: number; skipped?: number }
    parties?: { imported?: number; skipped?: number }
    transactions?: { imported?: number; skipped?: number; quarantined?: number; quarantineReasons?: string[] }
    payments?: {
      imported?: number
      skipped?: number
      allocationsRestored?: number
      allocationsSkipped?: number
    }
    relinked?: number
    unmatched?: number
    stockRebuilt?: number
  }
}

export interface RestoreOutcome {
  kind: 'success' | 'warning'
  title: string
  description: string
  durationMs: number
}

const n = (v: number | undefined) => v || 0

/**
 * Ordered by how badly each case misleads about MONEY, because only the first
 * matching branch becomes the headline.
 *
 *   1. the file carried no payments at all — every balance reads too high
 *   2. payments dropped — those parties read too high
 *   3. payment-to-bill links dropped — balances fine, invoices read as unpaid
 *   4. transactions quarantined — rows missing
 *   5. items unlinked — reports incomplete
 *
 * Stock and catalog problems come last on purpose: they are recoverable by
 * re-running a rebuild, and a wrong balance is not.
 */
export function describeRestoreOutcome(result: RestoreResponse): RestoreOutcome {
  const r = result?.results || {}
  const products = n(r.products?.imported)
  const transactions = n(r.transactions?.imported)
  const paymentsImported = n(r.payments?.imported)
  const skippedPayments = n(r.payments?.skipped)
  const skippedParties = n(r.parties?.skipped)
  const skippedProducts = n(r.products?.skipped)
  const skippedTotal = skippedPayments + skippedParties + skippedProducts
  const allocationsSkipped = n(r.payments?.allocationsSkipped)
  const quarantined = n(r.transactions?.quarantined)
  const unmatched = n(r.unmatched)
  const relinked = n(r.relinked)
  const stockRebuilt = n(r.stockRebuilt)

  /*
   * Every server warning, always, regardless of which branch won. This is the
   * part that stops the next warning being lost the way these two were.
   */
  const serverWarnings = (result?.warnings || []).filter(Boolean).join(' ')
  const withWarnings = (text: string) => (serverWarnings ? `${text} ${serverWarnings}` : text)

  const imported = `Imported — products: ${products}, transactions: ${transactions}, payments: ${paymentsImported}.`

  if (skippedPayments > 0) {
    return {
      kind: 'warning',
      title: `Restore finished — ${skippedPayments} payment(s) NOT imported`,
      description: withWarnings(
        `Those payments are missing, so the affected parties will show a HIGHER balance than they really owe. ` +
        `Check those parties before chasing anyone for money. ${imported}`,
      ),
      durationMs: 20000,
    }
  }

  if (allocationsSkipped > 0) {
    /*
     * A subtler failure than a missing payment, and easier to act on wrongly.
     * The money IS in the party's balance, so the headline figure is right —
     * but the individual invoice still reads as owing, and that is the number
     * someone looks at before sending a reminder.
     */
    return {
      kind: 'warning',
      title: `Restore finished — ${allocationsSkipped} payment(s) not linked to a bill`,
      description: withWarnings(
        `The money is counted in each customer's balance, so their total is right, but those particular ` +
        `invoices will still show as unpaid. Check them before sending any reminder. ${imported}`,
      ),
      durationMs: 20000,
    }
  }

  if (quarantined > 0) {
    const first = (r.transactions?.quarantineReasons || []).slice(0, 3).join('; ')
    return {
      kind: 'warning',
      title: `Restore finished — ${quarantined} transaction(s) NOT imported`,
      description: withWarnings(
        `They failed integrity checks (invoice totals don't match their items — possibly an edited or ` +
        `corrupted backup). Imported: ${transactions}.${first ? ` First issues: ${first}` : ''}`,
      ),
      durationMs: 20000,
    }
  }

  if (unmatched > 0) {
    return {
      kind: 'warning',
      title: `Restore complete — ${unmatched} item(s) not linked to catalog`,
      description: withWarnings(
        `Products: ${products}. Transactions: ${transactions}. Stock rebuilt for ${stockRebuilt} products. ` +
        `${relinked} items re-linked; ${unmatched} could not be matched by name (won't appear in ` +
        `product-linked reports).`,
      ),
      durationMs: 15000,
    }
  }

  /*
   * Nothing dropped by count — but a server warning still downgrades this to a
   * warning. The "file has no payments at all" case arrives exactly here: zero
   * payments were skipped, because the file never held any.
   */
  if (serverWarnings) {
    return {
      kind: 'warning',
      title: 'Restore finished — please read this',
      description: withWarnings(
        `Products: ${products}. Transactions: ${transactions}. Payments: ${paymentsImported}. ` +
        `Stock rebuilt for ${stockRebuilt} products.`,
      ),
      durationMs: 20000,
    }
  }

  return {
    kind: 'success',
    title: skippedTotal > 0 ? `Restore complete — ${skippedTotal} row(s) skipped` : 'Restore complete!',
    description:
      `Products: ${products}. Transactions: ${transactions}. ` +
      `Stock rebuilt for ${stockRebuilt} products. ${relinked} items re-linked to catalog.` +
      (skippedTotal > 0 ? ` Skipped — parties: ${skippedParties}, products: ${skippedProducts}.` : ''),
    durationMs: skippedTotal > 0 ? 15000 : 10000,
  }
}
