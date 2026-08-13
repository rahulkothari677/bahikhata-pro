/**
 * MAY WE LEARN THIS NAME? — C2c.
 *
 * ── THE TRAP THIS EXISTS TO AVOID ─────────────────────────────────────
 *
 * Learning from a confirmation sounds unambiguously good, and it is not.
 *
 * A shop has Anil Kumar and Anil Sharma. They type "anil", the app offers
 * both — correctly, because "anil" genuinely means either — and they pick
 * Anil Kumar. If we learn "anil" → Anil Kumar, then from that moment on:
 *
 *   • "anil" silently resolves to Anil Kumar, forever
 *   • Anil Sharma becomes unreachable by the name his shopkeeper calls him
 *   • and NOTHING on screen ever says why
 *
 * We would have destroyed the disambiguation in the act of "improving" it.
 * The lesson taught was "this time I meant Kumar", not "anil always means
 * Kumar", and those are different sentences.
 *
 * ── SO: ONLY LEARN WHAT THE NAMES THEMSELVES CANNOT EXPLAIN ───────────
 *
 * "chhota Ramesh" resembles no party's spelling — it is a nickname, and
 * nothing but the shop could ever tell us. Learn it.
 *
 * "anil" is a plain prefix of two real names. The list already handles it,
 * and handling it is CORRECT. Do not learn it.
 */

import { normalise } from '@/lib/resolve-name'

export interface LearnCheck {
  /** What they typed or said, before normalising. */
  said: string
  /** Every party name in this shop — the thing that decides. */
  allPartyNames: readonly string[]
}

export type LearnVerdict =
  | { learn: true; alias: string }
  | { learn: false; reason: 'too-short' | 'explained-by-names' | 'empty' }

/**
 * A name is learnable when the shop's own party names do not already explain
 * it. Returns the NORMALISED alias to store, so the lookup can never drift
 * from the comparison rules.
 */
export function canLearnAlias(input: LearnCheck): LearnVerdict {
  const alias = normalise(input.said)
  if (!alias) return { learn: false, reason: 'empty' }

  /*
   * Two characters is not a nickname, it is a typo waiting to capture half
   * the ledger. "ra" would swallow Ramesh, Rakesh and Rajesh the moment it
   * was learned.
   */
  if (alias.length < 3) return { learn: false, reason: 'too-short' }

  /*
   * THE RULE. If more than one existing party STARTS with what they said,
   * the ambiguity is real and the choice list is the right answer to it —
   * permanently. Learning here would remove a correct question.
   */
  const prefixMatches = input.allPartyNames.filter(n => {
    const name = normalise(n)
    return name === alias || name.startsWith(`${alias} `)
  })
  if (prefixMatches.length > 1) return { learn: false, reason: 'explained-by-names' }

  /*
   * ...and if exactly one party's name already begins with it, the ordinary
   * matching finds them without our help. Storing it would be a second
   * vocabulary saying what the first already says — and one more row to be
   * wrong later, when they rename the customer.
   */
  if (prefixMatches.length === 1) return { learn: false, reason: 'explained-by-names' }

  return { learn: true, alias }
}
