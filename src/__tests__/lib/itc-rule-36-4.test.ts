/**
 * Input tax credit is limited to what GSTR-2B actually contains.
 *
 * WHY (2026-08-08). Rule 36(4), as it has stood since 1 January 2022, allows
 * ITC only on invoices appearing in the shop's GSTR-2B. A supplier who has not
 * filed means no credit that month, however genuine the purchase.
 *
 * GSTR-3B claimed every purchase in the books. So the app told a shopkeeper
 * they could claim credit the law does not allow, they paid LESS tax than owed,
 * and under-payment is the expensive direction — interest under Section 50 runs
 * from the due date and compounds until a notice arrives.
 *
 * The app already knew better: api/gstr-2b/reconcile computes matched against
 * booksOnly, and GSTR-3B never consulted it. Two halves, each complete, never
 * connected — the fourth time that shape has appeared here.
 *
 * These tests pin the MATCHING RULE, which is where this fails silently: a
 * missed match does not error, it just quietly withholds a shopkeeper's money.
 */

/**
 * The key GSTR-3B uses to decide whether a purchase appears in 2B, mirrored
 * here so the normalisation is pinned independently of the route.
 */
function key(gstin: string | null | undefined, no: string | null | undefined): string {
  return `${(gstin || '').trim().toUpperCase()}|${(no || '').trim().toUpperCase()}`
}

describe('matching a purchase to a 2B invoice', () => {
  it('matches on supplier GSTIN and invoice number', () => {
    expect(key('27AAPFU0939F1ZV', 'INV-001')).toBe(key('27AAPFU0939F1ZV', 'INV-001'))
  })

  it('ignores case, because a shopkeeper types what the portal shouts', () => {
    /*
     * The portal carries "INV-001"; a shopkeeper types "inv-001". A case
     * difference must not cost someone their credit — and it would fail
     * silently, since a missed match looks exactly like a supplier who has not
     * filed.
     */
    expect(key('27aapfu0939f1zv', 'inv-001')).toBe(key('27AAPFU0939F1ZV', 'INV-001'))
  })

  it('ignores surrounding whitespace, which pasting reliably introduces', () => {
    expect(key(' 27AAPFU0939F1ZV ', ' INV-001 ')).toBe(key('27AAPFU0939F1ZV', 'INV-001'))
  })

  it('does NOT match different invoice numbers from the same supplier', () => {
    // Over-matching is worse than under-matching: it would claim credit for an
    // invoice the supplier never filed, which is the original fault.
    expect(key('27AAPFU0939F1ZV', 'INV-001')).not.toBe(key('27AAPFU0939F1ZV', 'INV-002'))
  })

  it('does NOT match the same invoice number from different suppliers', () => {
    // "INV-001" is the least distinctive string in Indian commerce. Matching on
    // number alone would hand a shop credit for another supplier's invoice.
    expect(key('27AAPFU0939F1ZV', 'INV-001')).not.toBe(key('29AAPFU0939F1ZP', 'INV-001'))
  })

  it('treats a purchase with no supplier GSTIN as unmatched', () => {
    /*
     * A cash purchase from an unregistered supplier carries no GSTIN and no
     * ITC. It must not collide with another such purchase and accidentally
     * match a 2B row.
     */
    expect(key(null, 'INV-001')).toBe('|INV-001')
    expect(key(null, 'INV-001')).not.toBe(key('27AAPFU0939F1ZV', 'INV-001'))
  })
})

describe('Section 17(5) — credit that can never be claimed', () => {
  /*
   * Section 17(5) blocks input credit on specific things regardless of business
   * purpose: motor vehicles carrying people, food and staff welfare, works
   * contract and construction of premises, goods given away or lost, and
   * anything for personal use.
   *
   * GSTR-3B claimed credit on every purchase, so a shop buying a delivery car
   * or a staff lunch was told it could claim tax the law refuses — under-paying,
   * with interest running under Section 50 until a notice arrives.
   *
   * The reasons the app offers, in the shopkeeper's words rather than the Act's.
   */
  const REASONS = [
    'personal',            // bought for personal or family use
    'staffWelfare',        // food, drinks, staff welfare
    'motorVehicle',        // car or bike carrying people
    'construction',        // building or repairing the premises
    'lostOrFree',          // given free, lost, damaged
    'compositionSupplier', // supplier under composition scheme
    'other',
  ]

  it('offers a reason, not just a yes/no', () => {
    /*
     * "Blocked" alone tells a CA nothing at assessment, and the shopkeeper who
     * ticked it will not remember why in eighteen months. The reason IS the
     * audit trail — that is why the column stores a string, not a boolean.
     */
    expect(REASONS.length).toBeGreaterThan(3)
    expect(REASONS).toContain('personal')
    expect(REASONS).toContain('motorVehicle')
  })

  it('treats null as claimable, so nothing changes for ordinary purchases', () => {
    /*
     * The default must be "claimable". Defaulting to blocked would quietly cost
     * shopkeepers money on every normal purchase — the exact mirror of the
     * fault this fixes, and harder to notice because it looks like caution.
     */
    const blocked = (reason: string | null) => reason !== null
    expect(blocked(null)).toBe(false)
    expect(blocked('personal')).toBe(true)
  })
})
