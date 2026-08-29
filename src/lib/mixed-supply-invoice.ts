/**
 * One bill cannot carry both taxable and exempt goods — for a REGISTERED buyer.
 *
 * ── THE RULE, AND THE EXCEPTION THAT MAKES IT EASY TO GET WRONG ─────────
 *
 * A taxable supply needs a TAX INVOICE (Section 31(1)). An exempt, nil-rated or
 * non-GST supply needs a BILL OF SUPPLY (Section 31(3)(c)). Two different
 * documents, because one carries tax and the other must not.
 *
 * Rule 46A then carves out the common case: where a registered person supplies
 * taxable AND exempt goods **to an unregistered person**, a single
 * "invoice-cum-bill-of-supply" may be issued for all of it.
 *
 * Read the words. The carve-out is for an UNREGISTERED buyer — a walk-in
 * customer buying rice and soap together, which is most of what a kirana does
 * all day. It does not extend to a registered buyer.
 *
 * ── WHY THIS MATTERS TO THE BUYER, NOT THE SELLER ───────────────────────
 *
 * A registered buyer claims input credit from the tax invoice. If the exempt
 * lines sit on that same document, their credit and their books disagree with
 * what the invoice shows, and the mismatch surfaces in THEIR reconciliation —
 * the 2B comparison that this app now runs for its own users. So the shop that
 * issued the bill has handed a problem to a customer who cannot fix it from
 * their side, exactly like an unfiled amendment.
 *
 * ── WHAT THIS DOES AND DOES NOT DO ──────────────────────────────────────
 *
 * It WARNS. It does not block, and that is deliberate.
 *
 * A shopkeeper standing at the counter with a customer waiting is the worst
 * possible moment to refuse a sale over a documentation rule they have never
 * heard of. Blocking would teach them that the app gets in the way, and the
 * next thing they learn is how to work around it. Telling them plainly what the
 * law needs, while still letting them serve the customer, is the version they
 * will actually read.
 *
 * The split itself is not automated here. Deciding which lines belong on which
 * document, numbering two files, and keeping them linked is real work with its
 * own failure modes, and inventing it silently under a shopkeeper mid-sale
 * would be worse than the problem. This names it; splitting comes next.
 */

export interface SupplyLine {
  /** Full GST rate on the line — 0 for exempt, nil-rated and non-GST alike. */
  gstRate: number
  /**
   * The line's own treatment where known: taxable | nil | exempt | nonGst.
   * Absent is treated as "decided by the rate", which is what the older rows
   * in a shop's books look like.
   */
  gstTreatment?: string | null
}

export interface MixedSupplyCheck {
  /** True only when this bill needs to be TWO documents. */
  needsSplit: boolean
  taxableCount: number
  exemptCount: number
  /** Plain sentence for the entry screen. Empty when nothing is wrong. */
  message: string
  /** What the two documents would be called. */
  documents: string[]
}

const CLEAN: MixedSupplyCheck = {
  needsSplit: false, taxableCount: 0, exemptCount: 0, message: '', documents: [],
}

/**
 * Does this bill need splitting?
 *
 * @param lines        the invoice lines
 * @param buyerGstin   the CUSTOMER's GSTIN. Absent/empty = unregistered, and
 *                     Rule 46A allows one combined document.
 */
export function checkMixedSupply(
  lines: SupplyLine[],
  buyerGstin: string | null | undefined,
): MixedSupplyCheck {
  /*
   * UNREGISTERED BUYER — checked first, and it is the common path.
   *
   * Rule 46A exists precisely for this: a walk-in buying rice and soap
   * together. Running the line analysis before this test would waste work on
   * most bills a kirana writes, and — worse — any later mistake in the
   * ordering would start warning about the transactions that are most
   * certainly fine.
   */
  const registered = String(buyerGstin ?? '').trim().length > 0
  if (!registered) return CLEAN

  let taxableCount = 0
  let exemptCount = 0

  for (const l of lines) {
    const rate = Number(l.gstRate) || 0
    if (rate > 0) {
      taxableCount++
      continue
    }
    /*
     * A zero-rate line is only NON-taxable if its treatment says so. A line
     * marked 'taxable' at 0% is a taxable supply at a nil tariff — it belongs
     * on the tax invoice, and counting it as exempt would split bills that
     * need no splitting.
     *
     * Absent treatment falls back to the rate, which is how older rows in a
     * shop's books look and is the honest reading of a 0% line with nothing
     * else said about it.
     */
    const t = l.gstTreatment
    if (t === 'taxable') taxableCount++
    else exemptCount++
  }

  if (taxableCount === 0 || exemptCount === 0) return CLEAN

  return {
    needsSplit: true,
    taxableCount,
    exemptCount,
    message: `This bill has ${taxableCount} item${taxableCount === 1 ? '' : 's'} with GST and ${exemptCount} without. For a customer with a GSTIN, those need two separate documents — a tax invoice for the taxable items and a bill of supply for the rest. One combined bill is only allowed for a customer without a GSTIN.`,
    documents: [
      `Tax invoice — the ${taxableCount} item${taxableCount === 1 ? '' : 's'} carrying GST`,
      `Bill of supply — the ${exemptCount} item${exemptCount === 1 ? '' : 's'} without`,
    ],
  }
}
