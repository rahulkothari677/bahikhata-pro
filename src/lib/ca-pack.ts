/**
 * The month, in the form a CA actually asks for.
 *
 * #33. CA ACCESS ALREADY EXISTS — a read-only login, built and mounted. This is
 * not that, and the difference is the point: most CAs will not create an
 * account in their client's app. They ask for the figures over WhatsApp or
 * email, once a month, and reconcile them against their own working.
 *
 * ── WHAT MAKES THIS MORE THAN A CSV DUMP ────────────────────────────────
 *
 * The figures are the easy half and every competitor exports them. What a CA
 * cannot get anywhere else is the list of things this app has already noticed
 * and the shopkeeper has not acted on: a Rule 88C gap, input credit about to
 * lapse at 180 days, items still classified under a cancelled notification, an
 * IMS deadline running.
 *
 * Those are exactly the questions a CA would otherwise have to find by hand,
 * and finding them is most of what the monthly call is spent on. Putting them
 * at the TOP, before the numbers, is the whole design: a pack that opens with
 * tables gets skimmed, one that opens with "three things need your attention"
 * gets read.
 *
 * ── WHY PLAIN TEXT AND NOT A ZIP ────────────────────────────────────────
 *
 * A CA reads this on a phone, in WhatsApp, between clients. A zip is a file
 * they must save, move to a computer and unpack before they can see whether it
 * was worth opening. Text pastes into a chat and is readable where it lands.
 * The portal JSON is already downloadable separately for anyone who needs it.
 *
 * ── IT REPORTS, IT DOES NOT DECIDE ──────────────────────────────────────
 *
 * Every figure here is one the app already computes and shows on screen. This
 * assembles; it never recalculates. A second arithmetic path for the same
 * month is the drift class that has caused four bugs in this codebase, and it
 * would be worst here — a pack that disagrees with the screen it came from
 * destroys the trust the whole feature is for.
 */

export interface CaPackWarning {
  /** Short, in the CA's vocabulary. */
  title: string
  /** The figure at stake, already formatted. Empty when there is none. */
  amount: string
  /** One sentence of what it is and what it needs. */
  detail: string
}

export interface CaPackInput {
  shopName: string
  gstin: string | null
  monthLabel: string
  gstr1: {
    filingStatus: string
    taxableValue: number
    outputTax: number
    invoiceCount: number
  } | null
  gstr3b: {
    filingStatus: string
    outputTax: number
    itcClaimed: number
    netPayable: number
  } | null
  /** Do the two returns agree, and by how much if not. */
  returnsAgree: { agree: boolean; difference: number } | null
  warnings: CaPackWarning[]
}

const inr = (n: number) =>
  '₹' + Math.abs(n).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

const statusWord = (s: string | undefined | null) =>
  s === 'filed' ? 'FILED' : s ? 'DRAFT — not filed' : 'not started'

/**
 * Build the pack.
 *
 * Pure: takes values the caller has already computed and returns text. That is
 * what makes it testable against a known-good and known-bad input without a
 * database, and what stops it becoming a second source of arithmetic.
 */
export function buildCaPack(input: CaPackInput): string {
  const L: string[] = []

  L.push(`GST PACK — ${input.monthLabel}`)
  L.push(`${input.shopName}${input.gstin ? ` · GSTIN ${input.gstin}` : ' · no GSTIN recorded'}`)
  L.push('')

  /*
   * WARNINGS FIRST, always — before a single figure.
   *
   * A pack that opens with tables gets skimmed. One that opens with "3 things
   * need your attention" gets read, and these are the items a CA would
   * otherwise spend the monthly call hunting for.
   */
  if (input.warnings.length > 0) {
    L.push(`${input.warnings.length} THING${input.warnings.length === 1 ? '' : 'S'} NEEDING ATTENTION`)
    L.push('')
    input.warnings.forEach((w, i) => {
      L.push(`${i + 1}. ${w.title}${w.amount ? `  —  ${w.amount}` : ''}`)
      L.push(`   ${w.detail}`)
    })
  } else {
    /*
     * Said explicitly rather than by omission. "Nothing here" and "we did not
     * check" look identical on a page that simply has no section, and a CA
     * cannot tell which they are reading.
     */
    L.push('NOTHING NEEDS ATTENTION')
    L.push('No filing risks, credit reversals or unclassified items were found for this month.')
  }
  L.push('')
  L.push('─────────────────────────────────────────')
  L.push('')

  L.push('GSTR-1')
  if (input.gstr1) {
    L.push(`  Status          ${statusWord(input.gstr1.filingStatus)}`)
    L.push(`  Taxable value   ${inr(input.gstr1.taxableValue)}`)
    L.push(`  Output tax      ${inr(input.gstr1.outputTax)}`)
    L.push(`  Invoices        ${input.gstr1.invoiceCount}`)
  } else {
    L.push('  Not available for this month.')
  }
  L.push('')

  L.push('GSTR-3B')
  if (input.gstr3b) {
    L.push(`  Status          ${statusWord(input.gstr3b.filingStatus)}`)
    L.push(`  Output tax      ${inr(input.gstr3b.outputTax)}`)
    L.push(`  Input credit    ${inr(input.gstr3b.itcClaimed)}`)
    L.push(`  Net payable     ${inr(input.gstr3b.netPayable)}`)
  } else {
    L.push('  Not available for this month.')
  }
  L.push('')

  /*
   * The reconciliation a CA does by hand, done for them — and the difference
   * stated as a NUMBER when there is one. "They do not agree" is an alarm;
   * "they differ by ₹1,620" is something to look up.
   */
  L.push('DO THE TWO RETURNS AGREE?')
  if (input.returnsAgree) {
    L.push(input.returnsAgree.agree
      ? '  Yes. Both declare the same tax for this month.'
      : `  No — they differ by ${inr(input.returnsAgree.difference)}. This is the Rule 88C condition; the portal issues an intimation on its own and blocks the next GSTR-1 until it is answered.`)
  } else {
    L.push('  Could not be checked — one of the two returns is not available.')
  }
  L.push('')
  L.push('─────────────────────────────────────────')
  L.push('Prepared by EkBook from the shop’s own books. Every figure here is the')
  L.push('one shown on screen in the app — nothing is recalculated for this pack.')

  return L.join('\n')
}
