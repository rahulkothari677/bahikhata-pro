/**
 * Will this filing trigger an automatic notice?
 *
 * WHY THIS EXISTS. Since 2023 the GST system does not wait for an officer to
 * spot a mismatch. Two rules fire on their own, compare your own returns
 * against each other, and issue an intimation:
 *
 *   RULE 88C (DRC-01B) — the tax you declared in GSTR-1 exceeds what you paid
 *     in GSTR-3B for the same period.
 *   RULE 88D (DRC-01C) — the input credit you claimed in GSTR-3B exceeds what
 *     GSTR-2B actually contains.
 *
 * Neither is a penalty by itself. What makes them serious is the consequence:
 * you get **seven days** to pay the difference or explain it in Part B, and
 * until you do, **the portal will not let you file your next GSTR-1**. One
 * unanswered intimation therefore stops the shop billing compliantly, and the
 * first many shopkeepers hear of it is when the next month's return is blocked.
 *
 * WHAT THIS FILE IS FOR. The numbers behind both rules are ones the app already
 * computes. Nobody tells the shopkeeper *before* they file, which is the only
 * moment the information is worth anything — afterwards it is just bad news.
 * This turns the reconciliation we already do into a forward-looking answer:
 * "file this and you will/will not get a notice, and here is by how much."
 *
 * WHAT IT DELIBERATELY DOES NOT DO — and this got stronger on 29 Aug 2026.
 *
 * It never tells anyone their filing is safe because it sits under a
 * threshold. A shortfall below the limit is still a shortfall.
 *
 * The CA review then went further: the 20% / ₹25 lakh figures were the
 * Council's OPENING recommendation, and GSTN applies a CONFIGURABLE threshold
 * that is not published. So the app cannot honestly say "this will trigger a
 * notice" OR "you are clear". It reports the gap — a fact — and calls it
 * exposure. The 7-day window and the block on the next GSTR-1 are confirmed,
 * and those are the parts that actually change what a shopkeeper does.
 *
 * @see lib/gst-reconciliation.ts — explains WHY the two returns differ
 */
import { roundMoney } from '@/lib/money'

/*
 * ⚠️ THESE ARE A GUIDE, NOT THE NOTIFIED RULE. Corrected 29 Aug 2026.
 *
 * We asserted on screen that DRC-01B fires above 20% AND ₹25 lakh. The CA
 * review says that figure was the GST Council's OPENING recommendation —
 * described as a threshold that "may be taken" to begin with — and that GSTN
 * runs a **configurable** threshold rather than a published formula.
 *
 * That reframes the whole card. The dangerous sentence was never the number;
 * it was the reassurance built on it: *"you are below ₹25 lakh, so you are
 * safe."* If GSTN's live setting is lower, that told a shopkeeper they were
 * clear on the exact filing that generated their notice.
 *
 * So the figures stay — they are the best public guide and they band the risk
 * usefully — but nothing built on them may state a legal trigger. The card
 * now shows the ACTUAL gap in rupees and percent and calls it exposure.
 *
 * The 7-day response window and the blocking of the next GSTR-1 are both
 * confirmed correct, and those are the parts that change behaviour.
 */
export const RULE_88C = {
  /** The excess must be more than this share of the tax paid in 3B. */
  PERCENT: 20,
  /** AND more than this many rupees in absolute terms. ₹25 lakh. */
  ABSOLUTE: 2_500_000,
} as const

/**
 * Rule 88D, the input-credit twin. Same shape, same seven days, same block on
 * the next GSTR-1 — but measured against GSTR-2B rather than GSTR-3B.
 */
export const RULE_88D = {
  PERCENT: 20,
  ABSOLUTE: 2_500_000,
} as const

/** Days to respond to DRC-01B / DRC-01C before the next GSTR-1 is blocked. */
export const RESPONSE_DAYS = 7

export type RiskLevel =
  /** Both thresholds crossed — an intimation is automatic. */
  | 'notice'
  /** A real difference, but under at least one threshold. Not escalated. */
  | 'difference'
  /** Nothing to answer for. */
  | 'clear'

export interface RuleAssessment {
  rule: '88C' | '88D'
  level: RiskLevel
  /** The rupee excess. Positive means declared/claimed more than paid/available. */
  excess: number
  /** The excess as a percentage of the comparison base. 0 when the base is 0. */
  excessPercent: number
  /** What the excess is measured against (3B tax paid, or 2B credit available). */
  base: number
  /** Did the excess clear the percentage limit? */
  crossedPercent: boolean
  /** Did the excess clear the rupee limit? */
  crossedAbsolute: boolean
  /** Plain-language statement of the position. */
  headline: string
  /** What happens next, in the shopkeeper's terms. */
  consequence: string | null
  /** The single most useful next action, or null when there is nothing to do. */
  action: string | null
}

export interface NoticeRiskResult {
  rules: RuleAssessment[]
  /** The worst level across all rules — what the summary card should show. */
  overall: RiskLevel
  /** True when any rule would actually trigger an intimation. */
  anyNotice: boolean
}

/** Percentage of `base`, guarding the divide-by-zero that a first-month or
 *  nil-filing shop hits — where any excess at all is infinite in percentage
 *  terms and the rupee limit is the only meaningful test. */
function percentOf(excess: number, base: number): number {
  if (base <= 0) return excess > 0 ? Infinity : 0
  return (excess / base) * 100
}

function classify(excess: number, base: number, limits: { PERCENT: number; ABSOLUTE: number }) {
  const pct = percentOf(excess, base)
  const crossedPercent = pct > limits.PERCENT
  const crossedAbsolute = excess > limits.ABSOLUTE
  // BOTH, never either. See the note on RULE_88C.
  const level: RiskLevel =
    excess <= 0 ? 'clear'
      : (crossedPercent && crossedAbsolute) ? 'notice'
        : 'difference'
  return { pct, crossedPercent, crossedAbsolute, level }
}

/**
 * Rule 88C — GSTR-1 declared more tax than GSTR-3B paid.
 *
 * @param gstr1Tax  total output tax declared across GSTR-1
 * @param gstr3bTax total output tax discharged in GSTR-3B
 */
export function assessRule88C(gstr1Tax: number, gstr3bTax: number): RuleAssessment {
  const excess = roundMoney(gstr1Tax - gstr3bTax)
  const { pct, crossedPercent, crossedAbsolute, level } = classify(excess, gstr3bTax, RULE_88C)

  if (level === 'clear') {
    return {
      rule: '88C', level, excess, excessPercent: 0, base: gstr3bTax,
      crossedPercent: false, crossedAbsolute: false,
      headline: excess === 0
        ? 'Your GSTR-1 and GSTR-3B declare the same tax.'
        : 'You have paid at least as much tax as your GSTR-1 declares.',
      consequence: null,
      action: null,
    }
  }

  /*
   * Worded as EXPOSURE, never as a trigger. See the note on RULE_88C: the
   * threshold GSTN actually applies is configurable and not published, so
   * "this will trigger a notice" and "this is below the limit, you are safe"
   * are both claims we cannot stand behind. The gap itself is a fact, and
   * that is what the shopkeeper is shown.
   */
  const bothOrOne = level === 'notice'
    ? `That is over 20% and over ₹25 lakh — well past the range where GSTN has generated DRC-01B.`
    : `That is under the range where DRC-01B is usually generated — but the exact threshold is set by GSTN and is not published, so treat this as a gap to close rather than a clearance.`

  return {
    rule: '88C', level, excess,
    excessPercent: Number.isFinite(pct) ? roundMoney(pct) : Infinity,
    base: gstr3bTax, crossedPercent, crossedAbsolute,
    headline: `Your GSTR-1 declares ₹${excess.toLocaleString('en-IN')} more tax than your GSTR-3B pays. ${bothOrOne}`,
    consequence: level === 'notice'
      ? `If GSTN issues DRC-01B, you get ${RESPONSE_DAYS} days to pay the difference or explain it in Part B — and until you answer, the portal will NOT let you file your next GSTR-1.`
      : 'Below the usual range for an intimation — but you are short-paid on this period either way, and interest runs on the difference.',
    action: 'Either pay the difference in this GSTR-3B before filing, or check whether an invoice in GSTR-1 is wrong.',
  }
}

/**
 * Rule 88D — GSTR-3B claimed more input credit than GSTR-2B contains.
 *
 * @param gstr3bItc claimed in GSTR-3B Table 4(A)
 * @param gstr2bItc available per the GSTR-2B import
 */
export function assessRule88D(gstr3bItc: number, gstr2bItc: number): RuleAssessment {
  const excess = roundMoney(gstr3bItc - gstr2bItc)
  const { pct, crossedPercent, crossedAbsolute, level } = classify(excess, gstr2bItc, RULE_88D)

  if (level === 'clear') {
    return {
      rule: '88D', level, excess, excessPercent: 0, base: gstr2bItc,
      crossedPercent: false, crossedAbsolute: false,
      headline: 'Your input credit claim is within what GSTR-2B allows.',
      consequence: null,
      action: null,
    }
  }

  return {
    rule: '88D', level, excess,
    excessPercent: Number.isFinite(pct) ? roundMoney(pct) : Infinity,
    base: gstr2bItc, crossedPercent, crossedAbsolute,
    headline: `You are claiming ₹${excess.toLocaleString('en-IN')} more input credit than your GSTR-2B contains.`,
    consequence: level === 'notice'
      ? `You would receive a DRC-01C intimation, with ${RESPONSE_DAYS} days to reverse the excess or explain it — and your next GSTR-1 stays blocked until you do.`
      : 'No notice, but credit not in your 2B cannot be claimed under Rule 36(4). Claiming it invites interest and reversal.',
    action: 'Chase the supplier who has not filed, or reduce the claim to what GSTR-2B actually shows.',
  }
}

/** Both rules, and the worst of them. */
export function assessNoticeRisk(input: {
  gstr1Tax: number
  gstr3bTax: number
  gstr3bItc: number
  gstr2bItc: number
  /** Skip 88D when no 2B has been imported — see below. */
  hasGstr2b: boolean
}): NoticeRiskResult {
  const rules: RuleAssessment[] = [assessRule88C(input.gstr1Tax, input.gstr3bTax)]

  /*
   * Without an imported GSTR-2B there is no comparison to make, and a missing
   * 2B would read as "zero credit available" — which would accuse a shop with
   * a perfectly ordinary claim of a ₹X lakh excess purely because they have
   * not uploaded a file yet. Silence is correct here; the UI prompts for the
   * import separately.
   */
  if (input.hasGstr2b) {
    rules.push(assessRule88D(input.gstr3bItc, input.gstr2bItc))
  }

  const anyNotice = rules.some(r => r.level === 'notice')
  const overall: RiskLevel = anyNotice
    ? 'notice'
    : rules.some(r => r.level === 'difference') ? 'difference' : 'clear'

  return { rules, overall, anyNotice }
}
