/**
 * How much room the blocks BELOW the item table actually need.
 *
 * 📄 Phase 7d of docs/INVOICE-ENGINE-PLAN.md.
 *
 * ── WHY THIS IS ITS OWN FILE ──────────────────────────────────────────
 *
 * A padded table (`tableFill: 'pad'`) fills the page with empty ruled rows so
 * a five-item bill and a twenty-item bill are the same shape. To do that it
 * has to know where to stop — and it was stopping at `min(90, 30% of the
 * sheet)`, a number I chose while looking at one bill.
 *
 * On Royal that number is wrong by half. Its footer is a ruled totals table,
 * a grand-total box, paid and balance lines, the amount-in-words strip, terms,
 * bank details and a signature block — about 165mm on A4, not 90. So the
 * padding ran the table down to 208mm, the footer did not fit, and a FIVE-ITEM
 * BILL CAME OUT ON TWO PAGES: a page of empty ruled rows, then a nearly blank
 * second page carrying the totals. I saw it in the render before Rahul did,
 * which is the only reason it is fixed here rather than reported by him.
 *
 * ── THE RULE THIS FOLLOWS ─────────────────────────────────────────────
 *
 * CLAUDE.md, Cause 2: two things describing one thing WILL disagree. The
 * padder and the footer are two pieces of code with an opinion about the same
 * distance. Replacing one guessed constant with a better guessed constant
 * leaves them still guessing separately — the next block added to the footer
 * silently breaks the padding again, and nothing fails.
 *
 * So the size of the footer is computed ONCE, here, from the blocks that will
 * actually be drawn. The padder asks this function. Every measurement below is
 * copied from the draw call that consumes it, with the line number named, so
 * the two can be checked against each other by reading.
 *
 * And it is a plain function over a plain object (Cause 7): a test can run it
 * against a bill with everything and a bill with nothing without rendering a
 * PDF, and watch it give different answers.
 */

export interface FooterRoomInput {
  /**
   * Rows in the totals table before the grand total — subtotal, discount,
   * taxable value, CGST, SGST, IGST, round-off. Between 2 and 7 in practice.
   */
  totalsRowCount: number
  /** `layout.totals === 'ruled'` — ruled rows are 6mm, plain lines are 5mm. */
  ruledTotals: boolean
  /** A Balance Due line is drawn only when something is owed. */
  hasDue: boolean
  /** The party's running balance — Phase 4, off unless the shop asked. */
  hasPartyBalance: boolean
  /** Wrapped lines of terms, already capped at the 6 the renderer draws. 0 if none. */
  termsLineCount: number
  /** Bank lines: name, a/c name, a/c no, IFSC. 0 if no bank details. */
  bankLineCount: number
  /** The sheet, in mm. A4 is 297, A5 is 210. */
  pageHeight: number
}

/**
 * The answer, in millimetres, measured from the bottom border of the table.
 *
 * Every constant is the one the renderer uses. If a block moves, this moves
 * with it — that is the whole point of the file.
 */
export function footerRoomMm(input: FooterRoomInput): number {
  let mm = 6 // invoice-pdf: `y += 6` after the table's bottom border

  // Totals rows — `y += ruledTotals ? 6 : 5` per row.
  mm += Math.max(0, input.totalsRowCount) * (input.ruledTotals ? 6 : 5)

  // The grand total: `y += 1`, a box of `gtHeight = 11`, then `y += gtHeight + 2`.
  mm += 1 + 11 + 2

  mm += 5 // the Paid line
  if (input.hasDue) mm += 5
  if (input.hasPartyBalance) mm += 5

  // Amount in words: `y += 4`, a 7mm strip, `y += 8`.
  mm += 4 + 8

  // Terms: a heading (4mm), up to six wrapped lines at 3.6mm, then 2mm.
  if (input.termsLineCount > 0) mm += 4 + Math.min(6, input.termsLineCount) * 3.6 + 2

  // Bank: a heading, its lines, then 2mm.
  if (input.bankLineCount > 0) mm += 4 + input.bankLineCount * 3.6 + 2

  /*
   * The QR and signature block, which the renderer reserves as
   * `Math.min(70, pageHeight * 0.24)` — proportional to the sheet, because 70mm
   * is sane on A4 and a third of an A5.
   */
  mm += Math.min(70, input.pageHeight * 0.24)

  return mm
}

/**
 * Where a padded table must stop.
 *
 * Returns the y at which the last empty row may end. Never above the top of
 * the sheet: on a small page with a heavy footer there is no room to pad at
 * all, and the honest answer is "pad nothing" rather than a negative height
 * that would draw rows upward through the table.
 */
export function padStopY(pageHeight: number, footerMm: number): number {
  return Math.max(0, pageHeight - footerMm)
}


/**
 * How much room the QR-and-signature block actually CONSUMES.
 *
 * 🐛 2026-08-16 — this is the second half of the two-page bug, and the more
 * interesting half. The renderer asked `newPageIfNeeded(y, 70)` before this
 * block, where 70mm is the distance it is ANCHORED above the bottom of the
 * sheet — not the space it needs. Those are different numbers, and using the
 * anchor as the requirement forced a page break whenever the terms and bank
 * details had carried `y` into the last 70mm, even though everything below
 * still fitted with room to spare.
 *
 * The block is two columns. Left: the payment QR, 38mm to the caption under
 * it. Right: the signature, 16mm to "Authorised Signatory". The receiver line
 * sits 42mm lower again when there is a QR beside it. The block is as tall as
 * its tallest column, which is what this returns.
 */
export function bottomBlockNeedMm(input: {
  hasQr: boolean
  wantsSignature: boolean
  wantsReceiverSignature: boolean
}): number {
  const qr = input.hasQr ? 38 : 0
  const sig = input.wantsSignature ? 16 : 0
  // primitives.ts draws the receiver line 42mm below the QR, or level with
  // the signature when there is none.
  const receiver = input.wantsReceiverSignature ? (input.hasQr ? 42 + 16 : 16) : 0
  return Math.max(qr, sig, receiver)
}