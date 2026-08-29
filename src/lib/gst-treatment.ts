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
import { lookupExemption } from '@/lib/exempt-goods-lookup'

/**
 * Exempt under Notification 2/2017 — the bulk of a kirana's zero-tax stock.
 *
 * Keyed by HSN prefix, longest match first. Note these are the UNBRANDED,
 * unpackaged forms: branded and pre-packaged versions of several of these
 * (flour, rice, pulses, honey) attract 5%, which is why the rate is checked
 * before any of this is applied.
 */
/*
 * ── THE HAND-WRITTEN EXEMPT LIST IS GONE (29 Aug 2026) ──────────────────
 *
 * It was 21 HSN prefixes, and the comment above them cited **Notification
 * 2/2017**. That notification was SUPERSEDED by 10/2025-CT(R) on 17 Sep 2025 —
 * the supersession is stated in 10/2025's own opening paragraph. So this file
 * was classifying a shopkeeper's stock against a dead statute, carefully.
 *
 * Exemption now comes from `lib/exempt-goods-lookup.ts`, parsed from the live
 * notification: 172 entries and 182 codes, against the 21 guessed here.
 *
 * WHAT THE OLD LIST GOT STRUCTURALLY WRONG, beyond being out of date. It wrote
 * the condition into a CODE COMMENT — "0713 // dried leguminous vegetables —
 * dal, pulses (unbranded)". A comment cannot be read at runtime. So the code
 * behaved as though 0713 were exempt unconditionally, and leaned on the rate
 * check to catch packaged dal.
 *
 * The note kept below is what proves that lean does not hold, and it is the
 * reason the new lookup asks instead of assuming.
 *
 * ── KEPT, because it is the lesson and not just history ─────────────────
 *
 * REMOVED 1701 (sugar) on first live run.
 *
 * Sugar is 5% GST. I had listed it with a comment reasoning that the rate check
 * would stop it being misapplied — and the rate check DOES work. But the shop's
 * dummy record had sugar at 0%, so the rate check passed it through and the
 * suggester confidently classified a 5% commodity as exempt.
 *
 * The lesson: the rate guard protects against a correctly-priced product with a
 * misleading HSN. It cannot protect against a MIS-priced product, and a
 * shopkeeper who has typed the wrong rate is exactly who most needs the
 * suggestion to be conservative.
 *
 * That is now enforced by the data rather than by my judgement about which
 * codes were safe to list: 99 of 210 rules carry a condition, and every one of
 * them produces a QUESTION instead of a classification.
 */

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

  /*
   * A SERVICE (SAC, Chapter 99) gets no suggestion at all.
   *
   * ADDED 2026-08-08, when it became clear this app serves every kind of shop
   * and not only a kirana. The lists below are goods, exempted by Notification
   * 2/2017. Services are exempted by a DIFFERENT notification (12/2017) with a
   * different list, which this does not carry — so for a zero-rated service the
   * honest answer is "I do not know", not the residual "nil-rated" below.
   *
   * Consistent with the rule this whole file is built on: silence where it is
   * not confident. A salon's exempt service filed as nil-rated is the same
   * class of wrong return as milk filed as nil-rated was.
   */
  if (code.replace(/\D/g, '').startsWith('99')) return null

  if (matches(code, NON_GST_PREFIXES)) return 'nonGst'

  /*
   * Exemption, from the live notification rather than a list I typed.
   *
   * A CONDITIONAL match returns null — "I do not know" — and null means leave
   * the existing value alone. That is a deliberate loss of coverage: loose rice
   * and loose dal are common, and they now get no automatic answer where the
   * old list confidently said "exempt".
   *
   * It is the right trade. The condition is packaging, the app cannot see the
   * packet, and being wrong here puts taxed sales in the exempt box of GSTR-1.
   * The suggestion is silent and #93 asks the question on the item screen,
   * where the shopkeeper is looking at the thing.
   */
  const exemption = lookupExemption(code)
  if (exemption.outcome === 'exempt') return 'exempt'
  if (exemption.outcome === 'needs-confirmation') return null

  /*
   * A 0% product with a known HSN that the notification does not exempt.
   * Nil-rated is the correct residual: it means "taxable supply, tariff rate
   * 0", which is what a zero-rated good that is not notified-exempt is.
   *
   * KNOWN GAP, stated rather than hidden: six exemptions in 10/2025 are keyed
   * to "Any Chapter" and no HSN at all — rakhi and puja samagri among them.
   * They cannot be matched here, so a rakhi at 0% falls through to nil-rated,
   * which is the wrong box. They are exported as UNKEYED_EXEMPTIONS for the
   * item screen to offer as a checklist; this function cannot ask.
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
