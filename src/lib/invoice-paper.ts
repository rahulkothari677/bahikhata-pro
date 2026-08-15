/**
 * Paper sizes — what the bill is actually printed on.
 *
 * 📄 2026-08-15. Rahul: "i also want you to add the size option in setting too
 * so the user can select the size they want and that type of size should be
 * … when user download or send on whatsapp."
 *
 * ── A THIRD AXIS, NOT A TEMPLATE FIELD ────────────────────────────────
 *
 * `invoice-templates.ts` carried a `paper: 'a4'` field, which was wrong the
 * moment a shopkeeper wanted the same layout on a smaller sheet. Paper is
 * chosen for a reason that has nothing to do with looks — what the printer
 * takes, what the counter has a pad of — so it sits beside layout and colour as
 * its own choice rather than inside one of them.
 *
 * Three settings, each answering one question:
 *   invoiceTemplate → the bones      (invoice-templates.ts)
 *   invoiceTheme    → the colour     (invoice-themes.ts)
 *   invoicePaperSize→ the sheet      (here)
 *
 * ── WHY A5 MATTERS HERE ───────────────────────────────────────────────
 *
 * A5 is half of A4 and is what most Indian bill books and small counter-top
 * printers actually use. A shop printing a five-line kirana bill on a full A4
 * sheet is wasting most of the page, every sale, forever.
 *
 * ── THE NUMBERS ARE MILLIMETRES ───────────────────────────────────────
 *
 * jsPDF is created with `unit: 'mm'`, so these ARE the values it wants and no
 * conversion happens anywhere. The preview converts to pixels at 96dpi, which
 * is the one place a ratio is applied.
 */

export type PaperSizeId = 'a4' | 'a5'

export interface PaperSize {
  /** Stable id, stored in Setting.invoicePaperSize. Never change or reuse. */
  id: PaperSizeId
  name: string
  /** One line for the picker. Says who it suits, not what it measures. */
  description: string
  /** Millimetres — the unit jsPDF is configured in. */
  widthMm: number
  heightMm: number
  /**
   * Page margin in mm.
   *
   * A5 gets a smaller one: the same 15mm on a half-width sheet eats a
   * noticeably larger share of the line, and the item table is what suffers.
   */
  marginMm: number
}

export const PAPER_SIZES: PaperSize[] = [
  {
    id: 'a4',
    name: 'A4',
    description: 'The standard sheet. Fits long bills and every office printer.',
    widthMm: 210,
    heightMm: 297,
    marginMm: 15,
  },
  {
    id: 'a5',
    name: 'A5',
    description: 'Half of A4 — what most bill books and counter printers use.',
    widthMm: 148,
    heightMm: 210,
    marginMm: 10,
  },
]

export const DEFAULT_PAPER_ID: PaperSizeId = 'a4'

/**
 * Resolve a stored id to a paper size.
 *
 * Falls back to A4 for null, undefined or an id we no longer ship — a removed
 * size must never stop a shop printing a bill.
 */
export function getPaperSize(id: string | null | undefined): PaperSize {
  return (
    PAPER_SIZES.find(p => p.id === id) ??
    PAPER_SIZES.find(p => p.id === DEFAULT_PAPER_ID)!
  )
}

/** 1mm at 96dpi. The single place millimetres become screen pixels. */
export const MM_TO_PX = 96 / 25.4

/** The page in CSS pixels, for the on-screen preview. */
export function paperPx(paper: PaperSize) {
  return {
    width: Math.round(paper.widthMm * MM_TO_PX),
    height: Math.round(paper.heightMm * MM_TO_PX),
  }
}
