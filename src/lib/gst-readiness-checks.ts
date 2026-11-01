/**
 * The pure parts of "Am I ready to file?" (/api/gst-readiness), so each rule is
 * tested on good and bad input without a database.
 */

export interface ReadinessCheck {
  id: string
  severity: 'blocker' | 'warn' | 'info' | 'ok'
  title: string
  detail: string
  /** Rupees, when the check is about an amount. */
  amount?: number
  /** Where the shopkeeper goes to deal with it. */
  action?: { label: string; view: string }
}

/**
 * Has input credit been checked against GSTR-2B?
 *
 * #115 (1 Nov 2026): a BLOCKER, no longer a warning. Without a 2B the claim is
 * the books' figure, and Rule 36(4) allows credit only on bills the suppliers
 * filed, so the tax shown as payable can be too LOW. Paying short costs
 * section 50 interest and is exactly what Rule 88D (DRC-01C) notices are raised
 * on. The portal would accept the return; this screen must not say "You can
 * file" on a figure nobody checked.
 *
 * @param twoB          this month's imported 2B, or null
 * @param purchaseCount purchases this month — with none there is no credit to check
 */
export function itcVerificationCheck(
  twoB: { invoiceCount: number } | null,
  purchaseCount: number,
): ReadinessCheck | null {
  if (twoB) {
    return {
      id: 'itc-unverified',
      severity: 'ok',
      title: 'Input credit checked against GSTR-2B',
      detail: `Matched against ${twoB.invoiceCount} ${twoB.invoiceCount === 1 ? 'bill' : 'bills'} from the portal.`,
    }
  }
  if (purchaseCount === 0) return null
  return {
    id: 'itc-unverified',
    severity: 'blocker',
    title: 'Import GSTR-2B before filing',
    detail: 'The credit here is from your own purchase bills. You can only claim what your suppliers have filed, so the tax to pay may be higher. Import this month’s GSTR-2B and the claim is worked out for you.',
    action: { label: 'Import GSTR-2B', view: 'reports' },
  }
}
