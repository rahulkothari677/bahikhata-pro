/**
 * Does this sale need an e-way bill before the goods move?
 *
 * WHY (2026-08-09). The app can store an e-way bill number but has never told a
 * shopkeeper when one is REQUIRED. Moving goods without one is a penalty of
 * ₹10,000 or the tax sought to be evaded, whichever is higher, and the vehicle
 * can be detained — so silence here is the expensive kind.
 *
 * THE RULE (Rule 138, CGST Rules):
 *
 *   - Required when the CONSIGNMENT VALUE exceeds the threshold.
 *   - INTER-STATE: ₹50,000, everywhere, no exceptions.
 *   - INTRA-STATE: set by each state. Several — Maharashtra, Delhi, Bihar,
 *     Punjab, Tamil Nadu, Jharkhand, Madhya Pradesh, West Bengal among them —
 *     notified HIGHER limits than ₹50,000 for movement within the state.
 *   - Only goods. A service has nothing to transport, so no e-way bill.
 *
 * THE CONSERVATISM, AND WHERE IT NOW YIELDS TO A CONFIRMED FIGURE:
 *
 * This used ₹50,000 for intra-state too, rather than each state's higher
 * figure. The reasoning was sound and is kept: warning when none was needed
 * costs two minutes on the portal, while NOT warning when one was needed costs
 * ₹10,000 and a detained vehicle. A stale HIGHER threshold silently stops
 * warning, which is the failure that hurts, so the default stays ₹50,000.
 *
 * But the CA review (26 Aug 2026) called the blanket version a live factual
 * error for the one state we could name: Maharashtra's intra-state threshold
 * is ₹1,00,000, so every consignment between ₹50k and ₹1L was warned about
 * needlessly — and a warning that is usually wrong trains a shopkeeper to
 * dismiss the one that matters.
 *
 * The resolution is INTRA_STATE_THRESHOLDS below: a state's figure is used
 * only where a practitioner has confirmed it and the notification is cited.
 * Everything else still falls back to ₹50,000. That keeps the safe direction
 * for the thirty states nobody has checked, while telling the truth about the
 * one that has been.
 *
 * So the wording must never assert the obligation, only raise it: "check
 * whether you need an e-way bill", not "you need one". Claiming certainty the
 * app does not have is how a warning becomes a lie.
 */

/** Rule 138 inter-state threshold, in rupees. Consignment value ABOVE this. */
export const EWAY_BILL_THRESHOLD = 50_000

/**
 * Intra-state thresholds, where a state has notified a higher one.
 *
 * WHY THIS EXISTS. The CA review found a live factual error: we warned at
 * ₹50,000 for movement INSIDE Maharashtra, where the notified threshold is
 * ₹1,00,000. Every consignment between those two figures got a warning it did
 * not need — and a warning that is usually wrong is worse than none, because
 * it teaches the shopkeeper to dismiss the one that matters.
 *
 * WHY THE TABLE IS ALMOST EMPTY, ON PURPOSE. The note at the top of this file
 * is right about the risk direction: *"a stale HIGHER threshold would silently
 * stop warning, which is the failure that hurts."* A wrong LOW value nags; a
 * wrong HIGH value lets goods move without a bill and turns into a seizure.
 * Those are not symmetric, so this table carries only what has been confirmed
 * by a practitioner, with its notification cited — not thirty states recalled
 * from memory. Everything absent falls back to ₹50,000, which is safe in the
 * direction that matters.
 *
 * Keyed by GST state code, because a state's NAME is typed by shopkeepers and
 * spelled a dozen ways; the code comes from the GSTIN and cannot drift.
 */
export interface IntraStateThreshold {
  amount: number
  state: string
  /** The notification, so a CA can check it rather than trust us. */
  source: string
}

export const INTRA_STATE_THRESHOLDS: Record<string, IntraStateThreshold> = {
  // Confirmed by the CA review, 26 Aug 2026.
  '27': { amount: 100_000, state: 'Maharashtra', source: 'Notification 15E, 29 Jun 2018' },
}

/**
 * The threshold that applies to this consignment.
 *
 * Inter-state is always ₹50,000 — Rule 138 sets it centrally and no state can
 * raise it. Only movement WITHIN a state can carry a higher notified figure.
 */
export function thresholdFor(isInterState: boolean, stateCode?: string | null): {
  amount: number
  intraStateRule?: IntraStateThreshold
} {
  if (isInterState || !stateCode) return { amount: EWAY_BILL_THRESHOLD }
  const rule = INTRA_STATE_THRESHOLDS[stateCode]
  return rule ? { amount: rule.amount, intraStateRule: rule } : { amount: EWAY_BILL_THRESHOLD }
}

export type EwayBillNeed =
  /** Above the threshold and goods are moving — tell them to check. */
  | { status: 'likely-required'; reason: string; threshold: number }
  /** Below the threshold, or nothing physically moves. */
  | { status: 'not-required'; reason: string }

export interface EwayBillCheck {
  /** Consignment value — the invoice value, in rupees. */
  consignmentValue: number
  /** True when supplier and buyer are in different states. */
  isInterState: boolean
  /**
   * Does this sale move physical goods?
   *
   * A pure service invoice — a salon appointment, tuition, consulting — has no
   * consignment, so no e-way bill regardless of value. Passed in rather than
   * guessed at from the HSN, because the caller knows the line items and this
   * function should not start parsing codes.
   */
  movesGoods: boolean
  /**
   * GST state code of the PLACE OF SUPPLY (2 digits, e.g. "27" Maharashtra).
   *
   * Optional: absent means "we don't know", which falls back to the safe
   * central ₹50,000 rather than assuming a higher state limit applies.
   */
  stateCode?: string | null
}

export function ewayBillNeed(c: EwayBillCheck): EwayBillNeed {
  if (!c.movesGoods) {
    return {
      status: 'not-required',
      reason: 'Nothing is being transported, so no e-way bill is needed.',
    }
  }

  const value = Number(c.consignmentValue) || 0
  const { amount: threshold, intraStateRule } = thresholdFor(c.isInterState, c.stateCode)

  /*
   * "Exceeds" — a consignment of exactly the threshold does not need one.
   * Using >= would warn on the boundary case, and the rule says above.
   */
  if (value <= threshold) {
    return {
      status: 'not-required',
      reason: intraStateRule
        ? `Below the ₹${threshold.toLocaleString('en-IN')} limit for movement inside ${intraStateRule.state}.`
        : `Below the ₹${threshold.toLocaleString('en-IN')} limit.`,
    }
  }

  return {
    status: 'likely-required',
    threshold,
    reason: c.isInterState
      ? 'Goods worth over ₹50,000 going to another state need an e-way bill before they move.'
      : intraStateRule
        // The state's own figure is known, so say it plainly rather than
        // telling the shopkeeper to go and look it up.
        ? `Goods worth over ₹${threshold.toLocaleString('en-IN')} moving inside ${intraStateRule.state} need an e-way bill (${intraStateRule.source}).`
        : 'Goods worth over ₹50,000 usually need an e-way bill. Some states allow a higher limit within the state — check yours.',
  }
}

/**
 * Does this invoice move physical goods?
 *
 * SAC codes — services — all begin with 99; goods sit in chapters 01–98. That
 * is the only reliable signal the app has, and it is the same rule the
 * e-invoice builder already uses for its IsServc flag.
 *
 * A LINE WITH NO CODE COUNTS AS GOODS. That is the safe direction: most sales
 * in this app are goods, most missing codes are on goods, and treating an
 * uncoded line as a service would silently switch the warning off for the
 * shops most likely to need it — the ones who have not filled in their HSN
 * codes yet. An invoice only escapes the check when EVERY line is explicitly
 * a service.
 */
export function invoiceMovesGoods(items: Array<{ hsn?: string | null }>): boolean {
  if (!items || items.length === 0) return false
  return items.some((i) => {
    const hsn = (i.hsn || '').trim()
    if (!hsn) return true          // uncoded — assume goods
    return !hsn.startsWith('99')   // 99xx is a service
  })
}
