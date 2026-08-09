/**
 * Do GSTR-1 and GSTR-3B tell the same story?
 *
 * WHY THIS EXISTS. A mismatch between the two returns is the single most common
 * trigger for a departmental notice, and it is the thing a CA checks first when
 * they open a client's books. This app can now answer it honestly, which most
 * billing apps cannot — so the answer should be on screen rather than left for
 * someone to work out with a calculator.
 *
 * THE HARD PART IS THAT "EQUAL" IS THE WRONG TEST. The two returns are not
 * supposed to be identical, and a check that demanded equality would raise a
 * red flag on perfectly correct books — which is worse than no check, because
 * it teaches a shopkeeper to ignore it. Three differences are legitimate:
 *
 *   1. ADVANCES. GSTR-1 reports them in their own tables (11A/11B). GSTR-3B has
 *      no advance line and folds them into 3.1(a). So 3B's tax legitimately
 *      exceeds the invoice total by the tax on advances received, less the tax
 *      on advances released.
 *   2. NIL / EXEMPT / NON-GST. GSTR-1 splits these out of the taxable tables
 *      into Table 8; 3B keeps them in 3.1(c), separate from 3.1(a).
 *   3. ROUNDING. Both are rupee-rounded from paise, so a few paise of drift
 *      across hundreds of invoices is arithmetic, not error.
 *
 * So this reconciles rather than compares: it starts from GSTR-1, applies each
 * known and explainable difference, and reports whatever is left. Anything
 * still unexplained is a real problem and is named as one.
 */
import { roundMoney } from '@/lib/money'

/** A difference between the returns that is expected and has a reason. */
export interface ReconcilingItem {
  label: string
  amount: number
  /** Plain-language reason this difference is correct. */
  why: string
}

export interface ReconciliationResult {
  /** True when nothing is left unexplained. */
  matched: boolean
  gstr1Tax: number
  gstr3bTax: number
  /** Items that legitimately explain the gap. */
  reconcilingItems: ReconcilingItem[]
  /** What remains after every known difference is applied. Should be ~0. */
  unexplained: number
  gstr1Taxable: number
  gstr3bTaxable: number
  unexplainedTaxable: number
}

/**
 * A few paise across a month of invoices is rounding, not a mistake.
 *
 * One rupee is the right threshold: both returns are filed in whole rupees, so
 * a sub-rupee difference cannot even be expressed on the portal, and calling it
 * a mismatch would flag every shop every month.
 */
export const ROUNDING_TOLERANCE = 1

export interface ReconciliationInput {
  /** GSTR-1 tax from the invoice tables (B2B + B2CL + B2CS + notes). */
  gstr1InvoiceTax: number
  /** GSTR-1 taxable value from the invoice tables. */
  gstr1InvoiceTaxable: number
  /** GSTR-3B 3.1(a) tax. */
  gstr3bOutputTax: number
  /** GSTR-3B 3.1(a) taxable value. */
  gstr3bTaxable: number
  /** Tax on advances declared in Table 11A this period. */
  advanceTaxReceived: number
  advanceTaxableReceived: number
  /** Tax on advances released in Table 11B this period. */
  advanceTaxReleased: number
  advanceTaxableReleased: number
  /** Nil + exempt + non-GST, which 3B keeps in 3.1(c) and GSTR-1 in Table 8. */
  nilExemptNonGst: number
}

export function reconcileReturns(input: ReconciliationInput): ReconciliationResult {
  const items: ReconcilingItem[] = []

  /*
   * Start from the invoices and walk toward 3B, naming each step. Working in
   * this direction — rather than diffing two totals and guessing afterwards —
   * means every rupee of difference is attributed to something a CA can check.
   */
  let expectedTax = input.gstr1InvoiceTax
  let expectedTaxable = input.gstr1InvoiceTaxable

  if (input.advanceTaxReceived > 0) {
    items.push({
      label: 'Tax on advances received',
      amount: roundMoney(input.advanceTaxReceived),
      why: 'GSTR-1 reports advances in Table 11A. GSTR-3B has no advance line, so they sit inside 3.1(a).',
    })
    expectedTax = roundMoney(expectedTax + input.advanceTaxReceived)
    expectedTaxable = roundMoney(expectedTaxable + input.advanceTaxableReceived)
  }

  if (input.advanceTaxReleased > 0) {
    items.push({
      label: 'Tax on advances adjusted against bills',
      amount: roundMoney(-input.advanceTaxReleased),
      why: 'Declared in an earlier month and released this month in Table 11B, so it is deducted here to avoid taxing it twice.',
    })
    expectedTax = roundMoney(expectedTax - input.advanceTaxReleased)
    expectedTaxable = roundMoney(expectedTaxable - input.advanceTaxableReleased)
  }

  if (input.nilExemptNonGst > 0) {
    items.push({
      label: 'Nil-rated, exempt and non-GST sales',
      amount: 0,
      why: `${roundMoney(input.nilExemptNonGst)} of supplies carry no tax. GSTR-1 reports them in Table 8 and GSTR-3B in 3.1(c) — neither counts them as taxable supplies.`,
    })
  }

  const unexplained = roundMoney(input.gstr3bOutputTax - expectedTax)
  const unexplainedTaxable = roundMoney(input.gstr3bTaxable - expectedTaxable)

  return {
    matched: Math.abs(unexplained) < ROUNDING_TOLERANCE && Math.abs(unexplainedTaxable) < ROUNDING_TOLERANCE,
    gstr1Tax: roundMoney(input.gstr1InvoiceTax),
    gstr3bTax: roundMoney(input.gstr3bOutputTax),
    gstr1Taxable: roundMoney(input.gstr1InvoiceTaxable),
    gstr3bTaxable: roundMoney(input.gstr3bTaxable),
    reconcilingItems: items,
    unexplained,
    unexplainedTaxable,
  }
}
