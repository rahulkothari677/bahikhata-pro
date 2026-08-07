/**
 * Suggest a GST treatment from a product's HSN code.
 *
 * WHY (2026-08-08). GSTR-1 Table 8 and GSTR-3B 3.1(c)/(e) report three
 * different things in three different boxes:
 *
 *   nil-rated  taxable supply carrying a 0% tariff rate
 *   exempt     exempted by Notification 2/2017-Central Tax (Rate)
 *   non-GST    outside GST altogether (petroleum, alcohol for human consumption)
 *
 * Product.gstTreatment can express all three, but it defaults to 'taxable' and
 * nothing ever sets it, so every zero-tax product a shopkeeper creates sits in
 * the wrong category until they think to change it — and a kirana owner has no
 * reason to know that milk is "exempt" while a 0% cereal is "nil-rated". The
 * distinction is real in law and invisible in a shop.
 *
 * So the app suggests, from the one piece of information it already has.
 *
 * DELIBERATELY CONSERVATIVE. This returns null wherever it is not confident,
 * and null means "leave whatever is there". A wrong classification is a wrong
 * return, so a missing suggestion is always preferable to a guessed one. The
 * codes below are the ones that are unambiguous for Indian retail; everything
 * else is left to the shopkeeper.
 *
 * ALSO: this only ever suggests. It is a default at creation time and a
 * proposal for existing rows — never a silent rewrite of a product a shopkeeper
 * has already classified themselves. They know their goods; this knows a table.
 */

/**
 * Exempt under Notification 2/2017 — the bulk of a kirana's zero-tax stock.
 *
 * Keyed by HSN prefix, longest match first. Note these are the UNBRANDED,
 * unpackaged forms: branded and pre-packaged versions of several of these
 * (flour, rice, pulses, honey) attract 5%, which is why the rate is checked
 * before any of this is applied.
 */
const EXEMPT_PREFIXES = [
  '0401', // fresh milk and cream, not concentrated or sweetened
  '0403', // curd, lassi, buttermilk
  '0406', // chena, paneer (unbranded)
  '0407', // eggs in shell
  '0409', // natural honey (unbranded)
  '0701', // potatoes, fresh
  '0702', // tomatoes, fresh
  '0703', // onions, garlic, fresh
  '0706', // carrots, fresh
  '0713', // dried leguminous vegetables — dal, pulses (unbranded)
  '0801', // coconuts, nuts, fresh
  '0803', // bananas, fresh
  '0804', // mangoes, guavas, fresh
  '0805', // citrus fruit, fresh
  '0806', // grapes, fresh
  '1001', // wheat (unbranded)
  '1006', // rice (unbranded)
  '1101', // wheat or meslin flour — atta (unbranded)
  '1102', // other cereal flours (unbranded)
  '1701', // NOTE: most sugar is 5%. Only specific unrefined forms are exempt —
          // see the rate check in suggestGstTreatment, which stops this from
          // being applied to a 5% product.
  '2501', // salt
]

/**
 * Outside GST entirely — Article 366(12A) excludes these until the GST Council
 * brings them in. A shop selling them reports them in ngsup_amt, not as exempt.
 */
const NON_GST_PREFIXES = [
  '2203', // beer
  '2204', // wine
  '2205', // vermouth
  '2206', // other fermented beverages
  '2207', // undenatured ethyl alcohol
  '2208', // spirits, liqueurs
  '2709', // petroleum oils, crude
  '2710', // petrol, diesel, ATF
  '2711', // petroleum gases (natural gas)
]

function matches(hsn: string, prefixes: string[]): boolean {
  const code = hsn.replace(/\D/g, '')
  if (!code) return false
  return prefixes.some((p) => code.startsWith(p))
}

/**
 * What treatment does this product most likely have?
 *
 * @returns 'exempt' | 'nonGst' | 'nil' | 'taxable', or NULL when not confident.
 *          Null means leave the existing value alone.
 */
export function suggestGstTreatment(
  hsn: string | null | undefined,
  gstRate: number,
): 'taxable' | 'nil' | 'exempt' | 'nonGst' | null {
  /*
   * Rate decides first, and overrules the code.
   *
   * A product carrying tax IS taxable, whatever its HSN says — packaged atta is
   * 1101 and 5%, and calling it exempt because of the chapter would put taxed
   * sales into the exempt box. The HSN list above describes unbranded forms;
   * the rate is how the shopkeeper has told us which form they actually sell.
   */
  if (gstRate > 0) return 'taxable'

  if (!hsn || !String(hsn).trim()) {
    /*
     * Zero-rated with no HSN. This is genuinely ambiguous — it could be exempt
     * produce or a nil-rated good — so say nothing rather than guess. The HSN
     * report already nags about the missing code, and once it is filled this
     * can answer properly.
     */
    return null
  }

  const code = String(hsn).trim()
  if (matches(code, NON_GST_PREFIXES)) return 'nonGst'
  if (matches(code, EXEMPT_PREFIXES)) return 'exempt'

  /*
   * A 0% product with a known HSN that is not on either list. Nil-rated is the
   * correct residual: it means "taxable supply, tariff rate 0", which is what a
   * zero-rated good that is not notified-exempt is.
   */
  return 'nil'
}

/**
 * Would this suggestion change anything, and is it safe to apply?
 *
 * Only fills a blank or corrects the untouched default. A product a shopkeeper
 * has already classified is never overwritten — they know their goods, this
 * knows a lookup table, and between the two the shopkeeper wins.
 */
export function shouldApplySuggestion(
  current: string | null | undefined,
  suggested: string | null,
): boolean {
  if (!suggested) return false
  if (!current) return true
  // 'taxable' on a 0% product is the untouched default, not a decision.
  if (current === 'taxable' && suggested !== 'taxable') return true
  return false
}
