/**
 * "aur pichhle mahine?" — Ask your books, B1.
 *
 * ── THE PROBLEM ───────────────────────────────────────────────────────
 *
 * Every question was answered as though the previous one never happened. Ask
 * "is mahine ki sale kitni hui", then ask the natural next thing — "aur
 * pichhle mahine?" — and no pattern matches, so the question went to a MODEL,
 * which had to guess what it was a follow-up to from the three words in front
 * of it. The rest of this feature exists specifically so a model never has to
 * guess; this was the hole in that.
 *
 * ── IT REWRITES THE QUESTION, IT DOES NOT ANSWER IT ───────────────────
 *
 * The whole of B1 is: turn "aur pichhle mahine?" back into the full question
 * the shopkeeper means, and hand THAT to the pipeline that already exists.
 * Nothing here knows what a sale is, and no new intent, period vocabulary or
 * answer path is introduced. If the rewrite is wrong the shopkeeper sees the
 * wrong SCREEN and a wrong "understood as" line — never a wrong number
 * attributed to a question they did not ask.
 *
 * ── WHY ONLY PERIODS ──────────────────────────────────────────────────
 *
 * "aur Ramesh ka?" is deliberately NOT handled. A bare name could be a party,
 * a product or a category — the collision Phase C's resolver exists for — and
 * "never invent a name" is a hard rule. A period word cannot be mistaken for
 * anything else, which is exactly why it is safe to resolve and a name is not.
 */

import { removePeriodWords } from '@/lib/ask-patterns'

/**
 * Openers people put in front of a follow-up. Stripped before the test,
 * because "aur pichhle mahine" must read as a bare period and "aur" is not
 * part of any period.
 */
const LEAD_INS = /^(aur|or|and|ab|to|toh|what about|how about|and what about|aur iska|iska|uska)\s+/

/**
 * Words that survive stripping but carry no meaning of their own. Without
 * these, "aur pichhle mahine ka kya hua" fails the bare test over "kya hua"
 * and falls through to the model — the exact case B1 exists to fix.
 */
const FILLER = /\b(ka|ki|ke|ko|mein|me|main|kya|kaisa|kaisi|hua|hui|tha|thi|the|hai|h|about|in|the|for|of|and|then|what)\b/g

/** Punctuation and case are not information here. Same shape as ask-patterns' own. */
function normalise(q: string): string {
  return q.toLowerCase().replace(/[?.!,]/g, ' ').replace(/\s+/g, ' ').trim()
}

/**
 * Is this question NOTHING BUT a period?
 *
 * The test is subtractive on purpose: remove the period words (using the same
 * list detectPeriod matches on, never a copy) and the filler, and if nothing
 * of substance is left then the question carried no subject of its own — so it
 * can only have been about the previous one.
 *
 * "pichhle mahine" → bare. "pichhle mahine ki sale" → NOT bare, it names its
 * own subject and must be answered on its own terms.
 */
export function isBarePeriod(question: string): boolean {
  const q = normalise(question).replace(LEAD_INS, '')
  if (!q) return false

  const withoutPeriod = removePeriodWords(q)
  // It has to actually CONTAIN a period, or "kya hua" alone would qualify.
  if (withoutPeriod === q) return false

  return withoutPeriod.replace(FILLER, ' ').replace(/\s+/g, ' ').trim() === ''
}

export interface FollowUp {
  /** The full question to answer, rebuilt from the earlier one. */
  question: string
  /** The earlier question it was resolved against — for the "understood as" line. */
  basedOn: string
}

/**
 * Rebuild a follow-up into a whole question, or return null to leave it alone.
 *
 * `earlier` is most-recent-first. We walk BACK past any question that was
 * itself a bare period, because otherwise the second follow-up in a row
 * resolves against the first and produces nonsense: "aur pichhle mahine?"
 * followed by "aur is hafte?" would rebuild as "is hafte aur pichhle mahine".
 * Walking back means every follow-up in a run resolves against the last
 * question that actually had a subject.
 */
export function resolveFollowUp(
  question: string,
  earlier: readonly string[] | null | undefined,
): FollowUp | null {
  if (!isBarePeriod(question)) return null
  if (!earlier || earlier.length === 0) return null

  const base = earlier.find(q => typeof q === 'string' && q.trim() && !isBarePeriod(q))
  /*
   * Nothing to attach to — the shopkeeper's first ever message was "pichhle
   * mahine?". Returning null sends it down the normal path, which will say it
   * cannot answer and offer examples. That is the honest outcome: inventing a
   * subject here would answer a question nobody asked.
   */
  if (!base) return null

  const period = normalise(question).replace(LEAD_INS, '')

  /*
   * The new period goes AT THE END of the old question, with the old period
   * removed. I wrote this the other way round first, reasoning that some
   * patterns are anchored to the end of the string — an assumption, and the
   * parser disagreed: run against all five intents, prepending broke
   * "Anil ka kitna baaki hai", because the name extractor read the leading
   * "pichhle mahine anil" as the customer's name. The follow-up would then be
   * about a customer who does not exist, which reads as "no such party" and
   * looks like the shopkeeper's mistake rather than ours.
   */
  const subject = removePeriodWords(normalise(base)).replace(/\s+/g, ' ').trim()
  return { question: `${subject} ${period}`.trim(), basedOn: base }
}
