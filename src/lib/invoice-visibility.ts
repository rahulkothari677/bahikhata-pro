/**
 * What the shop chooses to show on its bill — one list, one vocabulary.
 *
 * 📄 Phase 4 of docs/INVOICE-ENGINE-PLAN.md.
 *
 * WHY A REGISTRY AND NOT SIX BOOLEANS SCATTERED AROUND. Phase 3 already added
 * two visibility switches (the signature line, the receiver line) as loose
 * fields. Adding four more the same way would leave six places that all mean
 * "is this on the bill", and the settings screen would hand-write six blocks
 * that drift from the schema the first time one is renamed. That is GATE 2's
 * one-vocabulary rule, and Cause 2 is the longest list in CLAUDE.md.
 *
 * So: this file is the list. The schema column, the label the shopkeeper reads,
 * the default, and how the toggle is applied all live on one row. The settings
 * UI renders the registry; a guard proves every key is a real Setting column.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * WHAT IS DELIBERATELY NOT HERE — and this is the §0 part.
 *
 * Rule 46 of the CGST Rules lists sixteen particulars a tax invoice must
 * carry. A shopkeeper who switches off their GSTIN, the invoice number, the
 * date, the taxable value or the tax breakup has not customised their bill —
 * they have issued a document that is not an invoice, and they will find out
 * from a notice rather than from us.
 *
 * Every competitor treats "customise your invoice" as a free-for-all. We
 * refuse: MANDATORY below can never appear in the registry, and a guard
 * enforces it. That is the difference between a register and a compliance
 * engine, applied to a settings screen.
 *
 * The same reasoning, from the other direction, is where Zoho and QuickBooks
 * both landed: never let the user hide what the customer needs in order to
 * pay. Amount due, due date and the tax breakup stay put.
 */

/**
 * Rule 46 particulars, by the name this codebase gives them.
 *
 * Not exhaustive prose — the fields a settings screen could plausibly offer to
 * hide. Kept as data so the guard can be RUN against the registry rather than
 * being a comment nobody executes (the 15 Aug rule).
 */
export const MANDATORY_INVOICE_FIELDS = [
  'invoiceNo',
  'date',
  'shopName',
  'shopGstin',
  'shopAddress',
  'partyName',
  'partyGstin',
  'placeOfSupply',
  'hsn',
  'taxableValue',
  'gstRate',
  'cgst',
  'sgst',
  'igst',
  'total',
  'signedQR',
  'irn',
] as const

/**
 * How a toggle takes effect.
 *
 * `data`  — the document simply omits the value when the toggle is off, so no
 *           renderer ever branches on it. This is the safe kind: a renderer
 *           CANNOT forget to honour it, because there is nothing to honour.
 * `line`  — there is no data, only a blank line to draw (a signature rule).
 *           The document carries the boolean because absence cannot express it.
 */
export type VisibilityKind = 'data' | 'line'

export interface VisibilityToggle {
  /** Matches the Setting column EXACTLY. A guard proves it. */
  key: VisibilityKey
  label: string
  /**
   * Shown under the label. Only where the label is genuinely not enough —
   * Rahul, 15 Aug: descriptions on self-evident rows waste space.
   */
  help?: string
  kind: VisibilityKind
  default: boolean
}

export type VisibilityKey =
  | 'showPartyBalance'
  | 'showItemDescription'
  | 'showAlternateUnit'
  | 'showInvoiceTime'
  | 'showSignatureBox'
  | 'showReceiverSignature'

export const VISIBILITY_TOGGLES: readonly VisibilityToggle[] = [
  {
    key: 'showPartyBalance',
    label: "Customer's total outstanding",
    /*
     * Worth explaining: it is NOT this bill's due, which is already printed.
     * Without that sentence a shopkeeper reasonably reads it as a duplicate.
     */
    help: 'Prints what this customer owes you in total, across all their bills — not just this one.',
    kind: 'data',
    default: false,
  },
  {
    key: 'showItemDescription',
    label: 'Item description',
    help: 'The notes you saved on each item in Inventory.',
    kind: 'data',
    default: false,
  },
  {
    key: 'showAlternateUnit',
    label: 'Unit as you typed it',
    help: 'You typed 500 ml, the bill stores 0.5 ltr. This prints 500 ml as well.',
    kind: 'data',
    default: false,
  },
  {
    // Self-evident. No help text.
    key: 'showInvoiceTime',
    label: 'Time on the bill',
    kind: 'data',
    default: false,
  },
  {
    key: 'showSignatureBox',
    label: 'Signature line',
    kind: 'line',
    // 📄 Phase 3 shipped this ON. Changing the default would silently alter
    // every existing shop's bill, so it stays true.
    default: true,
  },
  {
    key: 'showReceiverSignature',
    label: "Customer's signature line",
    help: 'A second line for your customer to sign when they receive the goods. Useful if you deliver.',
    kind: 'line',
    default: false,
  },
] as const

/** The shop's answers. Every key optional; absent means the default. */
export type InvoiceVisibility = Partial<Record<VisibilityKey, boolean>>

/**
 * Resolve one toggle, defaults included.
 *
 * A plain function taking two arguments SPECIFICALLY so it can be exercised
 * against known-good and known-bad input without rendering an invoice — the
 * rule Cause 7 earned on 15 Aug.
 */
export function isVisible(key: VisibilityKey, visibility: InvoiceVisibility | null | undefined): boolean {
  const explicit = visibility?.[key]
  if (typeof explicit === 'boolean') return explicit
  return VISIBILITY_TOGGLES.find(t => t.key === key)?.default ?? false
}
