/**
 * STYLE — how the bill is dressed. The clothes.
 *
 * 📄 Phase 7c of docs/INVOICE-ENGINE-PLAN.md.
 *
 * Separate from LAYOUT (where blocks sit) and PALETTE (what colour they are).
 * The same skeleton in two styles is two different-looking bills; the same
 * style over two skeletons is a recognisable house.
 *
 * ── WHAT BELONGS HERE, AND WHAT DOES NOT ──────────────────────────────
 *
 * Belongs: line weights, whether cells are boxed or ruled, row height, the
 * face of the shop name, corner ornaments.
 *
 * Does NOT belong: which blocks exist (layout), what colour they are
 * (palette), or whether a FIELD prints (neither — a design may never remove a
 * field the shopkeeper asked for; that rule already cost me a template).
 *
 * ── THE RESEARCH THIS FOLLOWS ─────────────────────────────────────────
 *
 * Premium document design is consistent on three points: two or three colours
 * at most, one or two type faces, and decoration removed rather than added.
 * So there is no "fancy" style here that piles on effects. The expensive-
 * looking references win with a frame, generous margins and restraint — which
 * is what `ornate` and `boutique` do, and why `plain` exists for the shop
 * printing four hundred bills a day on a cheap laser.
 */

/** How table cells and blocks are separated. */
export type RuleStyle =
  /** Thin lines under rows only. Quietest. */
  | 'hairline'
  /** Every cell boxed. What a CA reading a stack actually wants. */
  | 'boxed'
  /** No lines at all — separation by space alone. */
  | 'none'

/** Row height and the type scale that moves with it. */
export type Density = 'compact' | 'regular' | 'airy'

export interface InvoiceStyle {
  /** Stable id, stored in Setting.invoiceStyle. Never change or reuse. */
  id: string
  name: string
  description: string

  rules: RuleStyle
  /** Alternate row tint. Independent of `rules` — a boxed table may stripe. */
  zebra: boolean
  density: Density
  /**
   * Line weight in mm, for frames and rules.
   *
   * A number rather than light/heavy words because the renderer needs mm and
   * a second lookup table translating one into the other is exactly the
   * "two things describing one thing" mistake this codebase keeps making.
   */
  lineWidth: number
  /**
   * A display face for the shop NAME only.
   *
   * Body text stays in the Unicode sans the PDF registers, because it has to
   * draw Devanagari, Gujarati and Tamil. A serif that cannot render the shop's
   * own language is not a choice we can offer.
   */
  titleFace: 'sans' | 'serif'
  /**
   * Corner brackets on the frame.
   *
   * Ignored when the layout has no frame — an ornament with nothing to sit on
   * is drawn nowhere rather than floating. See styleFitsLayout below.
   */
  ornament: boolean
}

export const INVOICE_STYLES: readonly InvoiceStyle[] = [
  {
    id: 'ruled',
    name: 'Ruled',
    description: 'Thin lines under each row. The default, and the quietest.',
    rules: 'hairline', zebra: false, density: 'regular',
    lineWidth: 0.2, titleFace: 'sans', ornament: false,
  },
  {
    id: 'striped',
    name: 'Striped',
    description: 'Alternate rows tinted. Easiest to read down a long bill.',
    rules: 'hairline', zebra: true, density: 'regular',
    lineWidth: 0.2, titleFace: 'sans', ornament: false,
  },
  {
    id: 'boxed',
    name: 'Boxed',
    description: 'Every cell ruled. The bill-book and accounting look.',
    rules: 'boxed', zebra: false, density: 'compact',
    lineWidth: 0.25, titleFace: 'sans', ornament: false,
  },
  {
    id: 'ornate',
    name: 'Ornate',
    description: 'Heavier rules, corner ornaments, a serif name.',
    rules: 'boxed', zebra: false, density: 'compact',
    lineWidth: 0.4, titleFace: 'serif', ornament: true,
  },
  {
    id: 'airy',
    name: 'Airy',
    description: 'No lines, wide spacing. Reads as letterhead.',
    rules: 'none', zebra: false, density: 'airy',
    lineWidth: 0.15, titleFace: 'sans', ornament: false,
  },
  {
    id: 'plain',
    name: 'Plain',
    description: 'Least ink on the page. For printing all day on a cheap printer.',
    rules: 'hairline', zebra: false, density: 'compact',
    lineWidth: 0.15, titleFace: 'sans', ornament: false,
  },
] as const

export const DEFAULT_STYLE_ID = 'striped'

export function getInvoiceStyle(id: string | null | undefined): InvoiceStyle {
  return INVOICE_STYLES.find(s => s.id === id)
    ?? INVOICE_STYLES.find(s => s.id === DEFAULT_STYLE_ID)!
}

/**
 * The numbers each density resolves to, in mm and pt.
 *
 * Kept beside the styles rather than inside the renderer so a style's claim
 * ("compact") and its effect (5.4mm rows) are readable in one place, and so a
 * test can assert the relationship without rendering anything.
 *
 * `baseline` is carried explicitly rather than derived: at compact's 5.4mm row
 * a fixed 5mm drop would put the text on the row's bottom edge.
 */
export const DENSITY_METRICS: Record<Density, {
  rowHeight: number
  headerHeight: number
  bandHeight: number
  bodyPt: number
  smallPt: number
  baseline: number
}> = {
  compact: { rowHeight: 5.4, headerHeight: 7, bandHeight: 26, bodyPt: 8, smallPt: 6.5, baseline: 3.8 },
  regular: { rowHeight: 7, headerHeight: 8, bandHeight: 32, bodyPt: 9, smallPt: 7.5, baseline: 5 },
  airy: { rowHeight: 9, headerHeight: 10, bandHeight: 38, bodyPt: 10, smallPt: 8, baseline: 6 },
}

/**
 * Is this combination legal?
 *
 * Not every style suits every skeleton, and the honest answer is to refuse
 * rather than print something broken. Two rules, both learned from the
 * references:
 *
 *  · An ornament needs a frame to sit on.
 *  · Eleven GST columns do not fit an airy style at any readable size — the
 *    same arithmetic that already stops them fitting A5.
 *
 * Exported as a plain function over two plain arguments so a test can run it
 * against a legal and an illegal pair (CLAUDE.md, Cause 7).
 */
export function styleFitsLayout(
  style: Pick<InvoiceStyle, 'ornament' | 'density'>,
  layout: { frame: string; columns: string },
): boolean {
  if (style.ornament && layout.frame === 'none') return false
  if (layout.columns === 'gst-full' && style.density === 'airy') return false
  return true
}
