/**
 * Inputs / Capital Goods / Input Services — the three-way split GSTR-9 wants.
 *
 * GSTR-9 Table 6 splits rows B, C and D three ways. We have never recorded it,
 * so `gstr9-builder` reports the total with `splitUnavailable: true` rather
 * than guessing — the honest answer, and the reason #36 has sat open.
 *
 * ── WHY THIS WAS LOGGED AS "BLOCKED ON A CA", AND WHY IT IS NOT ─────────
 *
 * The definitions are not ambiguous:
 *
 *   input           goods other than capital goods, used in business  s.2(59)
 *   capital goods   goods CAPITALISED IN THE BOOKS OF ACCOUNT         s.2(19)
 *   input service   any service used in business                      s.2(60)
 *
 * Read s.2(19) again: the test for capital goods is whether the buyer has
 * capitalised it. That is the shopkeeper's own accounting decision, not a
 * property of the thing bought — the same fridge is stock to an appliance
 * dealer and a capital asset to a chemist. No CA can tell us which; only the
 * shopkeeper can.
 *
 * So the honest design is the same one the exemption work arrived at: derive
 * what is derivable, ASK what only they know, and never guess the rest.
 *
 * ── WHY THIS DOES NOT ASK ON EVERY PURCHASE ─────────────────────────────
 *
 * A kirana books stock daily. A question on every purchase would be answered
 * by reflex within a week, and a reflex answer is worse than a default because
 * it looks deliberate.
 *
 * Two of the three need no question at all:
 *
 *   services      a SAC (Chapter 99) says so, with the same confidence the
 *                 app already uses to pre-tick "this is a service"
 *   inputs        the overwhelming default for goods — stock for resale
 *
 * Capital goods are rare and memorable: a fridge, a counter, a delivery
 * scooter. That is the one worth a deliberate tap, and it stays off unless
 * the shopkeeper turns it on.
 */

export type ItcCategory = 'inputs' | 'capitalGoods' | 'services'

export const ITC_CATEGORY_LABEL: Record<ItcCategory, string> = {
  inputs: 'Inputs (stock and materials)',
  capitalGoods: 'Capital goods (equipment you will capitalise)',
  services: 'Input services',
}

/**
 * What this purchase most likely is, before the shopkeeper says otherwise.
 *
 * NEVER returns 'capitalGoods'. That is the one answer this cannot derive —
 * see s.2(19) above — so it is reachable only by an explicit choice. A
 * suggester that guessed it would put equipment credit in the wrong GSTR-9 row
 * on a shop that never looked.
 *
 * @param hsn the purchase's HSN or SAC
 */
export function deriveItcCategory(hsn: string | null | undefined): ItcCategory {
  const code = String(hsn ?? '').replace(/\D/g, '')
  /*
   * Chapter 99 is services. The same test the product screen already uses to
   * pre-tick "this is a service" — one rule, so a purchase cannot be a service
   * on one screen and goods on another.
   */
  if (code.startsWith('99')) return 'services'
  return 'inputs'
}

/** Is this a value the column may hold? Anything else is a bug, not a choice. */
export function isItcCategory(v: unknown): v is ItcCategory {
  return v === 'inputs' || v === 'capitalGoods' || v === 'services'
}

export interface ItcSplitInput {
  itcCategory?: string | null
  cgst: number
  sgst: number
  igst: number
}

export interface ItcSplit {
  inputs: { cgst: number; sgst: number; igst: number }
  capitalGoods: { cgst: number; sgst: number; igst: number }
  services: { cgst: number; sgst: number; igst: number }
  /**
   * Tax on purchases recorded BEFORE this column existed.
   *
   * Reported separately and never folded into 'inputs'. Every purchase made
   * before 29 Aug 2026 has no category, and quietly counting it as inputs
   * would produce a Table 6 that looks complete and is not — the exact failure
   * `splitUnavailable` was protecting against. A CA reading this needs to know
   * which part is recorded and which part is merely old.
   */
  unclassified: { cgst: number; sgst: number; igst: number }
  /** True while any unclassified tax remains. */
  partial: boolean
}

const ZERO = () => ({ cgst: 0, sgst: 0, igst: 0 })

/**
 * Split claimed ITC three ways, keeping the unrecorded part visible.
 *
 * Pure, so it runs against known-good and known-bad input without a database.
 */
export function splitItc(rows: ItcSplitInput[]): ItcSplit {
  const out: ItcSplit = {
    inputs: ZERO(), capitalGoods: ZERO(), services: ZERO(),
    unclassified: ZERO(), partial: false,
  }
  for (const r of rows) {
    const bucket = isItcCategory(r.itcCategory) ? out[r.itcCategory] : out.unclassified
    bucket.cgst += r.cgst || 0
    bucket.sgst += r.sgst || 0
    bucket.igst += r.igst || 0
  }
  out.partial = (out.unclassified.cgst + out.unclassified.sgst + out.unclassified.igst) > 0
  return out
}
