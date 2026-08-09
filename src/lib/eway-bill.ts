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
 * THE DELIBERATE CONSERVATISM, and why it is the right way round:
 *
 * This uses ₹50,000 for intra-state too, rather than each state's higher
 * figure. That means it may say "you probably need one" to a Maharashtra shop
 * moving ₹60,000 of goods within Maharashtra, where the state limit is higher
 * and one may not be needed.
 *
 * That asymmetry is chosen. Warning when none was needed costs a shopkeeper two
 * minutes on the portal. NOT warning when one was needed costs ₹10,000 and a
 * detained vehicle. State limits also change by notification, and this app
 * cannot track fifteen state gazettes reliably — a stale HIGHER threshold would
 * silently stop warning, which is the failure that hurts.
 *
 * So the wording must never assert the obligation, only raise it: "check
 * whether you need an e-way bill", not "you need one". Claiming certainty the
 * app does not have is how a warning becomes a lie.
 */

/** Rule 138 inter-state threshold, in rupees. Consignment value ABOVE this. */
export const EWAY_BILL_THRESHOLD = 50_000

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
}

export function ewayBillNeed(c: EwayBillCheck): EwayBillNeed {
  if (!c.movesGoods) {
    return {
      status: 'not-required',
      reason: 'Nothing is being transported, so no e-way bill is needed.',
    }
  }

  const value = Number(c.consignmentValue) || 0
  /*
   * "Exceeds" — a consignment of exactly ₹50,000 does not need one. Using >=
   * would warn on the boundary case, and the rule says above.
   */
  if (value <= EWAY_BILL_THRESHOLD) {
    return {
      status: 'not-required',
      reason: `Below the ₹${EWAY_BILL_THRESHOLD.toLocaleString('en-IN')} limit.`,
    }
  }

  return {
    status: 'likely-required',
    threshold: EWAY_BILL_THRESHOLD,
    reason: c.isInterState
      ? 'Goods worth over ₹50,000 going to another state need an e-way bill before they move.'
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
