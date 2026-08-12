/**
 * Two questions in one line — Ask your books, B2.
 *
 * ── WHAT IT ACTUALLY DID, MEASURED ────────────────────────────────────
 *
 * The logged issue (#51) said Ask "answers half a compound question without
 * saying so". Running real compounds through the parser showed worse:
 *
 *   "is mahine ki sale aur kitna kharcha hua"   → answered EXPENSES (the 2nd)
 *   "Anil ka balance aur is mahine ki sale"     → answered the BALANCE (1st)
 *   "aaj ki sale and kitna GST bharna hai"      → "GST payable · TODAY"
 *
 * Which half you get depends on which pattern happens to match last, so it is
 * not predictable. And the third one is not half an answer at all: "today"
 * came from the SALES half and was applied to the GST half. That is a figure
 * assembled from two different questions, labelled confidently, with nothing
 * on screen to suggest anything was dropped.
 *
 * ── THE TEST IS "DO BOTH HALVES STAND ALONE?" ─────────────────────────
 *
 * Splitting on "aur" alone would break "Ramesh aur Suresh ka balance", which
 * is ONE question about two people. So a join only counts when BOTH sides
 * parse into a question on their own. If only one side does, the "aur" is part
 * of a single question and we must not touch it.
 *
 * This deliberately says nothing about what the halves MEAN — it never
 * answers either, and it never picks one. It reports that there are two, and
 * the route offers them. "Refusing beats guessing", and offering beats both.
 */

import { parseAsk } from '@/lib/ask-patterns'

/** How people join two questions. Comma included: "sale, aur kharcha". */
const JOINS = /\s+(?:aur|and|plus)\s+|\s*,\s*/gi

export interface Compound {
  /** The two questions, each already known to parse on its own. */
  halves: [string, string]
}

/**
 * Two questions, or null for the ordinary single-question case.
 *
 * Every join position is tried, not just the first, because the first "aur"
 * may be inside one half — "Ramesh aur Suresh ka balance aur is mahine ki
 * sale" splits correctly only at the second one.
 */
export function splitCompound(question: string): Compound | null {
  const q = (question || '').trim()
  if (!q) return null

  const joins: { start: number; end: number }[] = []
  JOINS.lastIndex = 0
  for (let m = JOINS.exec(q); m; m = JOINS.exec(q)) {
    joins.push({ start: m.index, end: m.index + m[0].length })
  }
  if (joins.length === 0) return null

  for (const j of joins) {
    const left = q.slice(0, j.start).trim()
    const right = q.slice(j.end).trim()
    if (!left || !right) continue

    /*
     * BOTH, or it is not a compound. This is the whole safety property: a
     * half that does not parse is not a question, so the join was part of one
     * question and splitting it would invent a second one.
     */
    if (parseAsk(left) && parseAsk(right)) {
      return { halves: [left, right] }
    }
  }

  return null
}
