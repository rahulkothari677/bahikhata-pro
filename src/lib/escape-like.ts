/**
 * escapeLikeWildcards — make a user's search term match LITERALLY.
 *
 * 🔒 Found by probing the live API, 2026-08-03. Prisma's `contains` compiles to
 * `LIKE '%' || $1 || '%'` and does NOT escape the term, so Postgres' LIKE
 * metacharacters stayed live:
 *
 *   search=%   → returned the entire ledger (50 rows, more pages behind it)
 *   search=_   → returned the entire ledger
 *
 * Not a security hole — the clause is ANDed inside the `userId` scope, so no
 * other shop's rows are reachable — but plainly wrong results. `_` matches any
 * single character, so a shopkeeper searching `INV_001` would also be shown
 * `INV-001` and `INV0001`, and a stray `%` looks like search is broken.
 *
 * Postgres' LIKE uses backslash as its default escape character, so escaping
 * the backslash FIRST and then the two metacharacters is sufficient. Order
 * matters: escaping `%` before `\` would double-escape the backslashes we just
 * introduced.
 *
 * A term with no metacharacters is returned unchanged, so ordinary searches are
 * unaffected.
 */
export function escapeLikeWildcards(term: string): string {
  return term
    .replace(/\\/g, '\\\\')
    .replace(/%/g, '\\%')
    .replace(/_/g, '\\_')
}
