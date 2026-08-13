/**
 * "Showing 50 of 128" — how a list says how much of itself you are seeing.
 *
 * ── WHY THIS EXISTS ───────────────────────────────────────────────────
 *
 * Rahul searched the sales ledger, saw "5 entries", and concluded the app had
 * only searched the fifty rows loaded on screen. It had not — the search runs
 * in the database over every record — but the only number any list could show
 * was the size of the page it had been given.
 *
 * A count that makes someone doubt their own books is its own kind of wrong
 * answer, and it cost him more confidence than a slow screen ever would.
 *
 * ── WHY A CEILING ON THE COUNT IS HONEST ──────────────────────────────
 *
 * Counting every matching row in a shop with millions of them is itself slow,
 * so the server counts up to a cap and says whether it hit it. "500+" is true,
 * cheap and useful. Pretending to know the exact number would trade a
 * misleading label for a slow screen, which is not a fix.
 */

export interface CountLabelInput {
  /** Rows actually on screen right now. */
  shown: number
  /** How many matched in the database — capped. Null when we do not know. */
  matched?: number | null
  /** False when `matched` hit the ceiling, so the real number is higher. */
  matchedIsExact?: boolean
}

/**
 * The line under a list. Null when there is nothing worth saying.
 *
 * Deliberately says nothing extra when the page IS everything — a shop with
 * five bills should read "5 entries", not "Showing 5 of 5", which invites a
 * question where none exists.
 */
export function listCountLabel(input: CountLabelInput): string | null {
  const { shown, matched, matchedIsExact = true } = input

  if (shown <= 0) return null

  const entries = (n: number) => `${n} ${n === 1 ? 'entry' : 'entries'}`

  // We never learned the true total — an old cached response, or offline.
  // Fall back to what we can honestly say rather than inventing a total.
  if (matched == null || !Number.isFinite(matched)) return entries(shown)

  /*
   * More exist than we are showing. This is the whole point of the function:
   * the reader must never be able to mistake the page for the whole result.
   */
  if (!matchedIsExact) return `Showing ${shown} of ${matched}+`
  if (matched > shown) return `Showing ${shown} of ${matched}`

  /*
   * `matched < shown` should not happen, but it can for a moment: the list
   * filters locally on every keystroke while the server query is still
   * debounced, so the counts belong to two different questions. Showing the
   * plain count is the honest thing while they disagree — "Showing 8 of 3"
   * would be nonsense on screen.
   */
  return entries(shown)
}
