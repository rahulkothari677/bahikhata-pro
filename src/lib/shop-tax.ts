/**
 * The shop's GST status, and what follows from it. ONE place. (#165, Phase 1c)
 *
 * WHY. EkBook had no "is this shop GST-registered?" at all. Every bill took
 * its tax from the product rates, so a shop with no GSTIN charged its
 * customers GST — the local sample shop collected ₹7,295.87 across 148 sales.
 * Section 32(1) of the CGST Act: "A person who is not a registered person
 * shall not collect in respect of any supply of goods or services or both
 * any amount by way of tax". About 90% of the shops EkBook serves are not
 * registered (Rahul, 1 Oct 2026).
 *
 * THE THREE STATUSES
 *   unregistered — no GST on its bills; the GST it pays suppliers is cost.
 *   regular      — charges GST on sales; claims input credit on purchases.
 *   composition  — registered, but may not collect tax (Section 10(4) CGST
 *                  Act; it issues a Bill of Supply) and may not claim input
 *                  credit; pays a small % of turnover instead.
 *
 * OUTWARD ONLY. "No GST on its bills" is about the documents the SHOP issues:
 * sales, returns it accepts (credit notes) and estimates. A purchase is the
 * SUPPLIER's bill — a registered supplier charges GST to an unregistered or
 * composition buyer like anyone else, and that GST is money the shop paid.
 * Stripping it from purchases (as the old composition switch did) understated
 * every supplier balance.
 */

export type GstStatus = 'unregistered' | 'regular' | 'composition'

export interface ShopTaxSetting {
  gstRegistered?: boolean | null
  compositionCategory?: string | null
}

/** A composition category means registered, whatever the flag says. */
export function gstStatus(s: ShopTaxSetting | null | undefined): GstStatus {
  if (s?.compositionCategory) return 'composition'
  return s?.gstRegistered ? 'regular' : 'unregistered'
}

/** May this shop put GST on the bills it issues? Only a regular registration. */
export function chargesGstOnSales(status: GstStatus): boolean {
  return status === 'regular'
}

/**
 * Can this shop claim back the GST it pays on purchases? Only a regular
 * registration (Section 16; composition: Section 10(4)). When it cannot, that
 * GST is part of what the goods cost (#175).
 */
export function claimsInputCredit(status: GstStatus): boolean {
  return status === 'regular'
}

/** The documents the shop issues — the ones its GST status governs. */
const OUTWARD_TYPES = new Set(['sale', 'credit-note', 'estimate'])
export function isOutwardDocument(type: string): boolean {
  return OUTWARD_TYPES.has(type)
}

/**
 * Does GST go on a line of this kind of bill, for this shop? The rule every
 * calculation path asks (computeLineItems via its `chargesGst` option).
 */
export function lineCarriesGst(status: GstStatus, type: string): boolean {
  return isOutwardDocument(type) ? chargesGstOnSales(status) : true
}

/**
 * Keeps a settings save consistent (used by PUT /api/settings).
 *
 * `requested` is the body's `gstRegistered` (undefined when not sent);
 * `category` is the composition category the same save will store
 * (undefined = not touched, null = cleared, string = set).
 *
 *  - not registered + a category → refused (a composition shop IS registered)
 *  - not registered              → registration off AND the scheme cleared
 *  - a category                  → registration on
 */
export function resolveGstRegistration(
  requested: unknown,
  category: string | null | undefined,
): { error: string } | { gstRegistered?: boolean; clearComposition: boolean } {
  if (requested !== undefined && typeof requested !== 'boolean') {
    return { error: 'gstRegistered must be true or false' }
  }
  if (requested === false && typeof category === 'string') {
    return { error: 'A composition shop is GST-registered — choose "Not registered" or a composition category, not both.' }
  }
  if (requested === false) return { gstRegistered: false, clearComposition: true }
  if (typeof category === 'string') return { gstRegistered: true, clearComposition: false }
  return { gstRegistered: requested as boolean | undefined, clearComposition: false }
}
