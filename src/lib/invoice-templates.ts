/**
 * Invoice templates — the STRUCTURE of a bill, as data.
 *
 * 📄 2026-08-15, Phase 2 of docs/INVOICE-ENGINE-PLAN.md.
 *
 * ── STRUCTURE AND COLOUR ARE TWO AXES, NOT ONE ────────────────────────
 *
 * myBillBook mixes them: "Theme Styling" offers named looks (Uttarakhand,
 * Uttarakhand 2) and, separately, seven colour dots, and the shopkeeper cannot
 * tell which decides what. Rahul's twenty reference invoices show why the two
 * really are independent — `billbook_modern_gold` and `tally_classic_grid` are
 * the same gold palette with completely different bones, while
 * `minimalist_slate_corporate` and `pharma_fssai_clean` share a structure and
 * look nothing alike.
 *
 * So: a TEMPLATE decides the bones — paper, header treatment, how item rows are
 * separated, how tight the rows are. A THEME (invoice-themes.ts) decides the
 * colour. Eight themes and six templates is forty-eight looks from fourteen
 * entries, and every one of them is legally correct because none of them
 * touches which FIELDS appear.
 *
 * ── WHY THIS IS NOT ARTWORK, UNLIKE THE BUSINESS CARD ─────────────────
 *
 * `card-templates.ts` is a background image with text zones painted on top,
 * because a card is a fixed 3.5×2 inches and its content never reflows. An
 * invoice does the opposite: two items or forty, page breaks, a tax block that
 * appears only for a registered buyer. A picture cannot stretch to that, and
 * text baked into one would not be selectable or searchable in the PDF a CA
 * receives. So a template here is a spec the renderer INTERPRETS.
 *
 * ── WHAT A TEMPLATE MAY NOT DO ────────────────────────────────────────
 *
 * It may not add, remove or rename a field. Rule 46 fixes the sixteen an Indian
 * tax invoice must carry, and a "design" that could drop the place of supply
 * would be a design that produces an invalid invoice. Templates change how the
 * page is drawn, never what is on it. Field-level control is a separate,
 * deliberate feature (Phase 4 of the plan) with its own rules.
 *
 * Adding a template is adding one entry here. No renderer changes.
 */

export type InvoiceTemplateId =
  | 'standard'
  | 'compact'
  | 'ruled'
  | 'letterhead'
  | 'statement'
  | 'minimal'
  | 'dispensary'

/** How the shop's identity is presented at the top of the page. */
export type HeaderStyle =
  /** A filled band across the full width. The current look. */
  | 'band'
  /** No fill: large shop name on white over a thick rule. Corporate, airy. */
  | 'rule'
  /** A thin ruled box around the whole page, name inside. Traditional Indian. */
  | 'frame'

/** How item rows are separated from each other. */
export type TableStyle =
  /** Alternating tinted rows, no vertical lines. Current. */
  | 'zebra'
  /** Full grid — every cell ruled. What accountants and Tally users expect. */
  | 'grid'
  /** Horizontal hairlines only. Quietest; suits services and few items. */
  | 'rows'

/** How the totals block is presented. */
export type TotalsStyle =
  /** Right-aligned lines, grand total in a filled bar. Current. */
  | 'bar'
  /** The whole block inside a bordered panel. */
  | 'panel'
  /**
   * No fill and no box: the grand total simply set large and bold.
   *
   * Taken from `minimalist_slate_corporate` in Rahul's references, where the
   * total is the biggest thing on the page and carries no decoration at all.
   * That also happens to be what §4 asks for — money is the largest thing on
   * screen — so it is the honest option, not just a quiet one.
   */
  | 'plain'

/**
 * Vertical rhythm. Drives row height and the type scale together, because
 * changing one without the other is how a table stops lining up.
 *
 * `compact` exists for a real reason, not variety: a kirana bill often runs to
 * thirty lines, and at the current 7mm row that is two pages. Two pages of
 * paper per sale is a cost a shopkeeper actually feels.
 */
export type Density = 'compact' | 'regular' | 'airy'

export interface InvoiceTemplate {
  /** Stable id, stored in Setting.invoiceTemplate. Never change or reuse. */
  id: InvoiceTemplateId
  name: string
  /** One line, shown under the name in the picker. Says who it suits. */
  description: string

  paper: 'a4'
  header: HeaderStyle
  table: TableStyle
  totals: TotalsStyle
  density: Density

  /**
   * A display face for the shop name only.
   *
   * Body text stays in the Unicode sans the PDF registers, because it has to
   * render Devanagari, Gujarati and Tamil — a serif that cannot draw the
   * shop's own language is not a choice we can offer.
   */
  titleFace: 'sans' | 'serif'

  /**
   * 📄 Phase 7 — how the shop's OWN item columns are laid out.
   *
   * `subline`  — under the item name: "Batch No.: A-118 · Expiry: 12 Mar 2027".
   *              Survives any number of extra fields and any paper width,
   *              because it never competes for horizontal space.
   * `columns`  — real table columns, as every pharmacy bill in the reference
   *              set does it. What a Drug Inspector expects to see, and much
   *              easier to read down a page. Costs width, so the renderer
   *              falls back to `subline` when the columns will not fit.
   *
   * THE FALLBACK IS THE POINT. Rahul: "every image should work properly with
   * all the field which user will add." A template that looks right with two
   * extra columns and collides with five is not a design, it is a trap — so
   * the choice below is a PREFERENCE, and the renderer decides from the real
   * measured width.
   */
  extraColumns: 'subline' | 'columns'
  /*
   * 🗑️ `metaStrip` lived here for about an hour and is gone.
   *
   * It would have let a template decide whether the BILL'S OWN FIELDS —
   * vehicle number, PO number — appear at all. Two guards caught it: one
   * because nothing read it, the other because this contract forbids exactly
   * that. A template composes the page; it may not remove a field the
   * shopkeeper asked for.
   *
   * A second template, `consignment`, went with it. Its only distinguishing
   * feature WAS the strip; without that it was byte-identical to `ruled`, and
   * an existing guard said so. Shipping a duplicate to claim one more design
   * is padding, and padding is what the reference set is meant to replace.
   *
   * `extraColumns` above survives that rule because it changes WHERE a field
   * is drawn, never WHETHER. Both settings print every custom column; one
   * puts them in the table, the other under the item name.
   */

}

/**
 * The numbers each density resolves to, in mm and pt.
 *
 * Kept beside the templates rather than inside the renderer so a template's
 * claim ("compact") and its effect (5.4mm rows) are readable in one place — and
 * so a test can assert the relationship without rendering anything.
 */
export const DENSITY_METRICS: Record<Density, {
  rowHeight: number
  headerHeight: number
  bodyPt: number
  smallPt: number
  bandHeight: number
  /**
   * Where the text sits inside a row, measured from its top edge.
   *
   * Carried explicitly rather than derived as a fraction of rowHeight so
   * `regular` keeps the exact 5mm the renderer used before templates existed.
   * A computed 0.72 × 7 would be 5.04 — invisible on screen, and precisely
   * the kind of drift that makes 'nothing changed' untrue.
   */
  baseline: number
}> = {
  // Roughly 30% more rows per page. Nothing drops below 7.5pt, which is the
  // floor for a bill someone reads under a shop tubelight.
  compact:  { rowHeight: 5.4, headerHeight: 6.5, bodyPt: 8,   smallPt: 6.5, bandHeight: 26, baseline: 3.9 },
  // The current output, unchanged — `standard` must look exactly as it does
  // today so this phase changes no shop's invoice until they ask for it.
  regular:  { rowHeight: 7,   headerHeight: 8,   bodyPt: 9,   smallPt: 7,   bandHeight: 32, baseline: 5 },
  airy:     { rowHeight: 8.5, headerHeight: 9,   bodyPt: 9.5, smallPt: 7.5, bandHeight: 36, baseline: 6.1 },
}

export const INVOICE_TEMPLATES: InvoiceTemplate[] = [
  {
    id: 'standard',
    name: 'Standard',
    description: 'The default. A colour band, striped rows — clear for any trade.',
    paper: 'a4',
    header: 'band',
    table: 'zebra',
    totals: 'bar',
    density: 'regular',
    titleFace: 'sans',
    extraColumns: 'subline',
  },
  {
    id: 'compact',
    name: 'Compact',
    description: 'Tighter rows, so a long kirana bill still fits one page.',
    paper: 'a4',
    header: 'band',
    table: 'zebra',
    totals: 'bar',
    density: 'compact',
    titleFace: 'sans',
    extraColumns: 'subline',
  },
  {
    id: 'ruled',
    name: 'Ruled',
    description: 'Every column boxed, the way a CA or Tally user expects to read it.',
    paper: 'a4',
    header: 'band',
    table: 'grid',
    totals: 'panel',
    density: 'regular',
    titleFace: 'sans',
    extraColumns: 'subline',
  },
  {
    id: 'letterhead',
    name: 'Letterhead',
    description: 'No colour band — a large shop name over a rule. Suits printed paper.',
    paper: 'a4',
    header: 'rule',
    table: 'rows',
    totals: 'panel',
    density: 'airy',
    titleFace: 'serif',
    extraColumns: 'subline',
  },
  {
    id: 'statement',
    name: 'Bordered',
    description: 'A ruled border around the page. The traditional Indian bill book.',
    paper: 'a4',
    header: 'frame',
    table: 'grid',
    totals: 'panel',
    density: 'regular',
    titleFace: 'serif',
    extraColumns: 'subline',
  },
  {
    id: 'minimal',
    name: 'Minimal',
    description: 'Quiet hairlines and space. Consultants, agencies, few line items.',
    paper: 'a4',
    header: 'rule',
    table: 'rows',
    totals: 'plain',
    density: 'airy',
    titleFace: 'sans',
    extraColumns: 'subline',
  },
  /*
   * 📄 Phase 7 — two designs taken from the reference set Rahul supplied.
   *
   * Both are compositions of the SAME grammar the other six use — band,
   * table, totals, density. Nothing here is a new drawing routine, which is
   * the whole point of the template contract: a design is data.
   *
   * They are also our own arrangement rather than a copy of anyone's layout.
   * The reference bills share a grammar that every Indian invoice shares;
   * what we take is the grammar, not the drawing.
   */
  {
    id: 'dispensary',
    name: 'Dispensary',
    description: 'Batch and expiry as real columns. For a chemist or medical store.',
    paper: 'a4',
    header: 'band',
    table: 'rows',
    totals: 'panel',
    density: 'compact',
    titleFace: 'sans',
    // The reason this template exists: a pharmacy bill reads DOWN a batch
    // column. A sub-line works, but it is not the format an inspector expects.
    extraColumns: 'columns',
  },
]

export const DEFAULT_TEMPLATE_ID: InvoiceTemplateId = 'standard'

/**
 * Resolve a stored id to a template.
 *
 * Falls back to the default for null, undefined, or an id that no longer
 * exists — a template removed from this list must never stop a shop printing
 * a bill.
 */
export function getInvoiceTemplate(id: string | null | undefined): InvoiceTemplate {
  return (
    INVOICE_TEMPLATES.find(t => t.id === id) ??
    INVOICE_TEMPLATES.find(t => t.id === DEFAULT_TEMPLATE_ID)!
  )
}

/** The metrics for a template, resolved through its density. */
export function metricsFor(template: InvoiceTemplate) {
  return DENSITY_METRICS[template.density]
}
