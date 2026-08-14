/**
 * Warnings a restore must give about the FILE it was handed.
 *
 * Kept out of the route so it can be tested by being called, rather than by
 * reading the route's source and hoping the code is reachable. A regex over a
 * route file passes just as happily when the branch above it is `if (false)`.
 */

/**
 * Backup files written before version 2 have no `payments` key at all — the
 * export never wrote one. Restoring such a file brings back every invoice with
 * none of the money paid against it, so a customer who settled in full appears
 * to owe the whole amount.
 *
 * Without this warning the restore reports "payments: 0" and reads like a
 * success, because the file genuinely did contain none, and the shopkeeper goes
 * looking for the mistake in their own bookkeeping.
 *
 * Returns the sentence to append, or null when the file is fine.
 *
 * Judged on the ABSENCE of the key rather than on the version number, so a
 * hand-edited or third-party file is measured by what it actually holds. A file
 * stamped "version 2" with no payments in it still warns; a file with payments
 * and no version stamp does not.
 */
export function missingPaymentsWarning(
  data: { payments?: unknown },
  fileVersion: unknown,
): string | null {
  if (Array.isArray(data?.payments)) return null

  return (
    ` IMPORTANT: this backup file contains no payment records — it was made by an older version of the app` +
    ` (file version ${fileVersion ?? 'unknown'}). Every invoice has been restored, but the money received against` +
    ` those invoices has NOT, so customer balances will show more owing than is really the case.` +
    ` Re-enter the payments, or restore from a backup taken with the current version.`
  )
}
