/**
 * How the GST answer says whether the return will survive.
 *
 * ── WHY THIS IS A FUNCTION AND NOT THREE BRANCHES IN THE ROUTE ────────
 *
 * It began inline in `api/ask`, and was therefore untestable: producing a real
 * `notice` needs GSTR-1 tax exceeding GSTR-3B by more than ₹25 lakh — roughly
 * ₹1.4 crore of sales. Distorting a shop's books that far to check a sentence
 * is the wrong trade, so the sentence went unchecked.
 *
 * That is not acceptable for THIS sentence. Master plan §2: Rule 88C is the
 * moat. The notice wording is the single output that separates us from every
 * competitor, and it had never rendered once.
 *
 * ── IT DECIDES NOTHING ABOUT RISK ─────────────────────────────────────
 *
 * The assessment arrives already made, by `lib/notice-risk` via
 * `/api/notice-risk`. This only chooses words. Re-deriving "is this a notice?"
 * here would be a second thing deciding notice risk, and the answer would
 * drift from the panel on the GSTR-3B screen — rule B6, and the shape of four
 * bugs fixed this week.
 */

import { RESPONSE_DAYS } from '@/lib/notice-risk'

/** The shape we consume — a subset of RuleAssessment, so tests need no fixture. */
export interface NoticeInput {
  overall: 'clear' | 'difference' | 'notice' | string
  /** The 88C assessment, which is the one a GST answer is about. */
  rule?: { headline?: string; consequence?: string | null } | null
}

export interface NoticeLine {
  /** The sentence, or null when we could not assess — never a guess. */
  line: string | null
  /** Button to the screen that can fix it. Absent when there is nothing to fix. */
  action: { kind: 'open-screen'; label: string; destinationId: string } | null
}

export function buildNoticeLine(input: NoticeInput | null | undefined): NoticeLine {
  /*
   * No assessment — say nothing. A tax figure without a risk note is honest;
   * inventing reassurance we did not compute is not. This is also what a failed
   * fetch produces, and a broken lookup must never become "you are fine".
   */
  if (!input) return { line: null, action: null }

  const headline = input.rule?.headline
  const consequence = input.rule?.consequence

  if (input.overall === 'notice') {
    /*
     * Say what happens, in the order it happens: the notice, the deadline,
     * then the consequence that actually costs them money — a blocked GSTR-1
     * stops their B2B customers claiming input credit, so those customers stop
     * buying. That last part is why this matters and it is the part nobody
     * tells them.
     */
    return {
      line: `⚠️ ${headline || 'Filing this would trigger a DRC-01B notice.'} ${
        consequence ||
        `You would have ${RESPONSE_DAYS} days to respond, and your next GSTR-1 would be blocked — which stops your B2B customers claiming input credit from you.`
      }`,
      action: { kind: 'open-screen', label: 'Fix before filing', destinationId: 'gstr-3b' },
    }
  }

  if (input.overall === 'difference') {
    /*
     * UNDER THE THRESHOLD IS NOT "SAFE", and saying so would be the one lie
     * this feature cannot afford. The panel follows the same rule: a shortfall
     * below the limit is still a shortfall, shown, and told apart from a
     * notice.
     */
    return {
      line: `${headline || 'Your GSTR-1 and GSTR-3B do not match.'} It is below the level that triggers a notice, but a difference is the commonest reason a shop gets one.`,
      action: { kind: 'open-screen', label: 'See the difference', destinationId: 'gstr-3b' },
    }
  }

  /*
   * §4.2 "calm when fine": a clean month gets ONE line and no button. An app
   * that celebrates every month teaches people to stop reading it.
   */
  return {
    line: headline
      ? `${headline} Nothing here that triggers a notice.`
      : 'GSTR-1 and GSTR-3B agree — nothing here that triggers a notice.',
    action: null,
  }
}
