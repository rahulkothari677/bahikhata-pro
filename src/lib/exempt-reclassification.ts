/**
 * Which products were sorted by the CANCELLED notification, and what now?
 *
 * #94. Every product entered before 29 Aug 2026 had its GST treatment decided
 * against Notification 2/2017 — superseded by 10/2025 on 17 Sep 2025. Fixing
 * the rule going forward does not fix what is already in a shopkeeper's books,
 * and GSTR-1 reads those stored treatments every month. A shop with 300 items
 * is carrying 300 decisions made under a law that no longer exists.
 *
 * ── WHY THIS COMPARES RATHER THAN TRACKS ────────────────────────────────
 *
 * Product has no column recording what set gstTreatment or when, so there is
 * no way to ask "which of these did WE decide?". Rather than add one and know
 * only about products created after today, this compares each stored treatment
 * against what the live notification says now.
 *
 * That is the better question anyway. It catches a shopkeeper's own mistake,
 * an import, and a treatment set by an older version of this app equally —
 * none of which a provenance flag would have covered.
 *
 * ── WHAT IT WILL NOT DO ─────────────────────────────────────────────────
 *
 * Change anything. Eleven of the twenty-one prefixes on the old list are
 * CONDITIONAL under 10/2025 — potatoes, onions, rice, atta, dal, honey — and
 * the condition is something only the shopkeeper can see: whether it is sold
 * loose, whether it is fresh. "Exempt" may well be the right answer for their
 * shop. Auto-correcting would replace one silent decision with another, which
 * is the mistake this whole task exists to undo.
 *
 * So this produces a QUESTION per product, never a correction.
 */
import { lookupExemption, CONDITION_QUESTION } from '@/lib/exempt-goods-lookup'

export type ReclassifyVerdict =
  /** Stored treatment matches what the live notification says. Nothing to do. */
  | 'ok'
  /** The notification exempts this outright, but the product says otherwise. */
  | 'should-be-exempt'
  /** Stored 'exempt', but the live notification does not list this code. */
  | 'no-longer-listed'
  /** The notification's answer depends on something only the shop knows. */
  | 'needs-answer'

export interface ProductForReview {
  hsn: string | null | undefined
  gstRate: number
  gstTreatment: string | null | undefined
}

export interface ReclassifyResult {
  verdict: ReclassifyVerdict
  /** Plain sentence: what changed and why this product is on the list. */
  reason: string
  /** The notification's own words for the matched entry, verbatim. */
  description: string | null
  /** Condition codes still to be answered — empty unless 'needs-answer'. */
  conditions: string[]
  /** What it would become if every condition is answered the exempt way. */
  suggested: 'exempt' | 'taxable' | null
  source: string | null
  serial: number | null
}

const OK: ReclassifyResult = {
  verdict: 'ok', reason: '', description: null, conditions: [],
  suggested: null, source: null, serial: null,
}

/**
 * Judge one product.
 *
 * A pure function taking three values, so it can be run against a known-good
 * and a known-bad input without a database — the rule CLAUDE.md earned the
 * hard way after five guards that could not fail.
 */
export function reviewProduct(p: ProductForReview): ReclassifyResult {
  const treatment = p.gstTreatment || 'taxable'

  /*
   * A RATE ABOVE ZERO SETTLES IT, and this is checked first for the same
   * reason it is checked first in suggestGstTreatment and on the item screen.
   * The shopkeeper has said they charge tax on this item; the exemption
   * question is about which zero applies, not about overriding a rate they
   * typed.
   *
   * The one thing worth flagging here is the contradiction — 'exempt' with a
   * rate on it — which the product form already blocks but older rows may
   * still carry.
   */
  if (p.gstRate > 0) {
    if (treatment === 'exempt' || treatment === 'nonGst') {
      return {
        ...OK,
        verdict: 'should-be-exempt',
        reason: `This is marked ${treatment === 'exempt' ? 'Exempt' : 'Non-GST'} but carries a ${p.gstRate}% rate. Those cannot both be true — either the rate or the treatment is wrong.`,
        suggested: 'taxable',
      }
    }
    return OK
  }

  const hsn = String(p.hsn ?? '').replace(/\D/g, '')

  /*
   * No HSN, so the notification cannot be consulted at all. Not a finding:
   * saying "this might be wrong" about every code-less product would bury the
   * real rows under noise, and the HSN report already asks for the code.
   */
  if (!hsn) return OK

  /* Services (Chapter 99) are exempted by a different notification (12/2017)
     which this table does not carry. Silence, not a guess. */
  if (hsn.startsWith('99')) return OK

  const ex = lookupExemption(hsn)

  if (ex.outcome === 'exempt') {
    if (treatment === 'exempt') return OK
    return {
      verdict: 'should-be-exempt',
      reason: `The current notification exempts this outright, but the item is marked ${treatment === 'nil' ? 'Nil-rated' : treatment === 'nonGst' ? 'Non-GST' : 'Taxable'}. Exempt and nil-rated go in different boxes of GSTR-1.`,
      description: ex.rules[0].description,
      conditions: [],
      suggested: 'exempt',
      source: ex.source,
      serial: ex.rules[0].serial,
    }
  }

  if (ex.outcome === 'needs-confirmation') {
    /*
     * THE BIG GROUP, and the reason this task exists. The old list marked
     * eleven of these prefixes exempt with no condition at all — rice, atta,
     * dal, honey, potatoes, onions. Under 10/2025 each turns on something the
     * app cannot see.
     *
     * Flagged whatever the stored value is, including when it already says
     * 'exempt': that value was decided by the cancelled rule, so it is
     * unverified rather than wrong. The shopkeeper confirms it and it becomes
     * a decision instead of an inheritance.
     */
    const conditions = ex.rules[0].conditions.filter(c => CONDITION_QUESTION[c])
    if (!conditions.length) return OK      // no question we can ask; say nothing
    return {
      verdict: 'needs-answer',
      reason: treatment === 'exempt'
        ? 'This was marked Exempt under the old notification, which had no condition on it. The current one does — please confirm it still applies to how you sell this.'
        : `This can be exempt, but only under a condition. It is currently marked ${treatment === 'nil' ? 'Nil-rated' : 'Taxable'}.`,
      description: ex.rules[0].description,
      conditions,
      suggested: 'exempt',
      source: ex.source,
      serial: ex.rules[0].serial,
    }
  }

  /*
   * Not in the exemption table at all. Only a finding if the product claims to
   * BE exempt — otherwise "not listed" is the ordinary state of most goods and
   * says nothing about them.
   */
  if (treatment === 'exempt') {
    return {
      verdict: 'no-longer-listed',
      reason: 'This is marked Exempt, but the current notification does not list this HSN. It may have been exempt under the old one. Check the code, or change the treatment.',
      description: null,
      conditions: [],
      suggested: null,          // deliberately no suggestion — see below
      source: ex.source,
      serial: null,
    }
  }

  return OK
}

/**
 * No suggestion on 'no-longer-listed', on purpose.
 *
 * The honest reading of "your HSN is not in the exemption list" is that either
 * the code is wrong or the treatment is — and this cannot tell which. Offering
 * "make it taxable" would push a shopkeeper into changing the half that is
 * probably right, on a screen designed to be clicked through quickly.
 *
 * Refusing beats guessing, and a row with no button still tells them where to
 * look.
 */
export const NO_SUGGESTION_REASON =
  'Either the HSN or the treatment is wrong here, and we cannot tell which — so no change is offered.'
