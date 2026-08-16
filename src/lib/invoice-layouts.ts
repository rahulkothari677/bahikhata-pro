/**
 * LAYOUT — where things sit on the bill. The bones.
 *
 * 📄 Phase 7c of docs/INVOICE-ENGINE-PLAN.md.
 *
 * ── WHY THIS FILE EXISTS ──────────────────────────────────────────────
 *
 * Rahul: *"the design and layout is different."* He is right, and getting it
 * wrong is why thirteen "designs" looked like one bill thirteen times.
 *
 * What I had called a template was a muddle: it carried STYLE choices (striped
 * rows, spacing), pretended to carry LAYOUT choices, and the layout was in
 * fact hardcoded and identical for every one of them. So the single thing that
 * makes one bill look unlike another — the bones — was the one thing no design
 * could change.
 *
 * Three separate vocabularies now:
 *
 *   LAYOUT  (this file)          where the blocks sit
 *   STYLE   (invoice-styles)     how they are dressed — rules, ornament, type
 *   PALETTE (invoice-themes)     the colours
 *
 * Layout is the bones. Style is the clothes. Colour is the fabric. A change to
 * one must not disturb the other two — which is the property that makes ten
 * layouts × six styles × twelve palettes cheap instead of impossible.
 *
 * ── EVERY OPTION HERE CAME OFF A REAL BILL ────────────────────────────
 *
 * Read from the 18 reference invoices Rahul supplied, not invented. The gold
 * textile bill alone needs five things the old renderer had no concept of:
 * corner ornaments on a double frame, an eleven-column GST breakup, empty
 * ruled rows padding the table to a fixed height, totals as a ruled mini-table
 * rather than plain lines, and a serif shop name beside a logo.
 */

/** A frame drawn around the whole page. */
export type FrameStyle =
  /** Nothing. The page edge is the margin. */
  | 'none'
  /** One hairline rectangle inside the margin. */
  | 'single'
  /**
   * Two rectangles with ornamental brackets at the corners.
   *
   * This is the entire "premium" cue on the gold textile reference, and it is
   * cheap to draw. Needs `style.ornament` to actually place the brackets.
   */
  | 'double'

/** How the shop identifies itself at the top. */
export type HeaderLayout =
  /** Filled band, shop name inside it. What every EkBook bill did before. */
  | 'band-name'
  /**
   * Filled band carrying "TAX INVOICE", with the shop's identity BELOW it in
   * body text — the maroon hardware reference. Puts the document type first,
   * which is what a buyer's accounts department looks for.
   */
  | 'band-title'
  /**
   * No band at all. Shop name large in ink, invoice details in a small boxed
   * card on the right — the corporate consulting reference. Reads as
   * letterhead rather than as software output.
   */
  | 'plain-name'

/** How the customer's details are presented. */
export type PartyLayout =
  /** One card on the left. The current look. */
  | 'one-card'
  /** Two cards side by side — consignor and consignee, on a transport bill. */
  | 'two-cards'
  /**
   * A full-width bordered strip with ruled cells, the way a printed bill book
   * does it — the gold textile reference. Fills the width instead of leaving
   * half the page empty.
   */
  | 'grid-band'

/** Which columns the item table carries. */
export type ColumnSet =
  /** #, item, HSN, qty, rate, GST%, amount. Fits anything. */
  | 'simple'
  /**
   * The full breakup: #, description, HSN, qty, unit, rate, disc%, taxable
   * value, CGST%, SGST%, cess%, total. ELEVEN columns.
   *
   * What a wholesaler's buyer and their CA both expect, and what the gold and
   * Tally references both print. Needs a dense style to fit A4 — the renderer
   * refuses it on A5 rather than printing off the page.
   */
  | 'gst-full'

/** What fills the table below the last item. */
export type TableFill =
  /** Nothing. The table ends where the items end. */
  | 'fit'
  /**
   * Empty ruled rows down to a fixed height, so a five-item bill and a
   * twenty-item bill are the same shape.
   *
   * The classic Indian bill-book look, and the reason a printed pad feels
   * deliberate where software output feels ragged. Also stops a customer
   * adding a line to a bill they were handed.
   */
  | 'pad'

/** How the money is summed up. */
export type TotalsLayout =
  /** Right-aligned lines, no box. */
  | 'lines'
  /** A filled bar for the grand total. */
  | 'bar'
  /** An outlined panel around the whole summary. */
  | 'panel'
  /**
   * A ruled mini-table — every figure in its own cell, the grand total row
   * filled. The gold reference, and the format that reads as "accounts" rather
   * than "receipt".
   */
  | 'ruled'

export interface InvoiceLayout {
  /** Stable id, stored in Setting.invoiceTemplate. Never change or reuse. */
  id: string
  name: string
  /** One line, shown under the name. Says who it suits. */
  description: string

  frame: FrameStyle
  header: HeaderLayout
  /**
   * A full-width strip of the BILL's own custom fields under the header —
   * E-Way Bill No, Vehicle No, LR/GR No, as the transport reference lays them
   * out. The numbers a driver is stopped and asked for.
   *
   * NOTE this does not decide whether those fields EXIST — they always print
   * somewhere. It decides whether they get a strip of their own. A layout may
   * never remove a field the shopkeeper asked for; that rule cost me a
   * template earlier in this phase.
   */
  metaStrip: boolean
  party: PartyLayout
  columns: ColumnSet
  tableFill: TableFill
  totals: TotalsLayout
}

/**
 * The ten skeletons.
 *
 * Each is a real bill from the reference set, described in blocks. Nothing
 * here says what colour anything is or how thick a line is — that is style and
 * palette, in the other two files.
 */
export const INVOICE_LAYOUTS: readonly InvoiceLayout[] = [
  {
    id: 'classic',
    name: 'Classic',
    description: 'A colour band, one customer card, a clear table. Suits any shop.',
    frame: 'none', header: 'band-name', metaStrip: false,
    party: 'one-card', columns: 'simple', tableFill: 'fit', totals: 'bar',
  },
  {
    id: 'royal',
    name: 'Royal',
    description: 'Framed page with corner ornaments and a full tax breakup.',
    // The gold textile reference. Needs every capability at once, which is why
    // it was built first — if the engine can draw this, the rest are cheap.
    frame: 'double', header: 'plain-name', metaStrip: false,
    party: 'grid-band', columns: 'gst-full', tableFill: 'pad', totals: 'ruled',
  },
  {
    id: 'tally',
    name: 'Tally Grid',
    description: 'Every cell ruled, full tax breakup. For wholesale and distribution.',
    frame: 'single', header: 'band-title', metaStrip: false,
    party: 'grid-band', columns: 'gst-full', tableFill: 'pad', totals: 'ruled',
  },
  {
    id: 'dispensary',
    name: 'Dispensary',
    description: 'Batch and expiry as columns. For a chemist or medical store.',
    frame: 'none', header: 'band-name', metaStrip: false,
    party: 'two-cards', columns: 'simple', tableFill: 'fit', totals: 'panel',
  },
  {
    id: 'consignment',
    name: 'Consignment',
    description: 'A strip for vehicle and docket numbers, sender and receiver side by side.',
    frame: 'single', header: 'band-name', metaStrip: true,
    party: 'two-cards', columns: 'simple', tableFill: 'fit', totals: 'panel',
  },
  {
    id: 'corporate',
    name: 'Corporate',
    description: 'No band. Large name, details in a corner card. For services and B2B.',
    frame: 'none', header: 'plain-name', metaStrip: false,
    party: 'one-card', columns: 'simple', tableFill: 'fit', totals: 'panel',
  },
  {
    id: 'titled',
    name: 'Titled',
    description: 'The band says TAX INVOICE, your shop sits below it.',
    frame: 'none', header: 'band-title', metaStrip: false,
    party: 'two-cards', columns: 'simple', tableFill: 'fit', totals: 'bar',
  },
  {
    id: 'memo',
    name: 'Memo',
    description: 'Small and dense. For a quick counter slip.',
    frame: 'none', header: 'plain-name', metaStrip: false,
    party: 'one-card', columns: 'simple', tableFill: 'fit', totals: 'lines',
  },
  {
    id: 'register',
    name: 'Register',
    description: 'Bill-book look — ruled throughout, padded to a full page.',
    frame: 'single', header: 'band-name', metaStrip: false,
    party: 'grid-band', columns: 'simple', tableFill: 'pad', totals: 'ruled',
  },
  {
    id: 'boutique',
    name: 'Boutique',
    description: 'Framed, spacious, restrained. For premium and luxury shops.',
    frame: 'double', header: 'plain-name', metaStrip: false,
    party: 'one-card', columns: 'simple', tableFill: 'fit', totals: 'lines',
  },
] as const

export const DEFAULT_LAYOUT_ID = 'classic'

export function getInvoiceLayout(id: string | null | undefined): InvoiceLayout {
  return INVOICE_LAYOUTS.find(l => l.id === id)
    ?? INVOICE_LAYOUTS.find(l => l.id === DEFAULT_LAYOUT_ID)!
}

/**
 * Can this layout be drawn on this sheet?
 *
 * Eleven columns do not fit A5 at any readable size. Rather than print off the
 * page — which is what the old renderer did for a whole phase before a test
 * caught it — the caller is told, and falls back.
 *
 * A plain function over two plain arguments so a test can run it both ways
 * without rendering anything (CLAUDE.md, Cause 7).
 */
export function layoutFitsPaper(layout: InvoiceLayout, paperId: string): boolean {
  if (layout.columns === 'gst-full' && paperId !== 'a4') return false
  return true
}
