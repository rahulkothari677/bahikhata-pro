/**
 * Custom fields and columns — the shop's own data, typed.
 *
 * 📄 Phase 5 of docs/INVOICE-ENGINE-PLAN.md.
 *
 * ── WHY THIS IS §0 WORK AND NOT DECORATION ────────────────────────────
 *
 * A pharmacy must record the BATCH NUMBER and EXPIRY DATE of every medicine
 * it sells. That is the Drugs and Cosmetics Act, not GST, and Drug Inspectors
 * cross-reference billing records against it. EkBook cannot store either, so
 * today a chemist simply cannot use this app for their actual job.
 *
 * A transporter needs a vehicle number on the bill. A jeweller wants the HUID
 * — worth stating precisely, because I assumed otherwise and checked: putting
 * HUID on the invoice is VOLUNTARY at present, hallmarking itself is what is
 * mandatory. So it is a useful field, not a legal one, and this file does not
 * pretend otherwise.
 *
 * ── HOW THE VALUES ARE STORED, AND WHY ────────────────────────────────
 *
 * Definitions live in a table. VALUES live in a JSONB column on the record
 * itself, not in a values table.
 *
 * The BUILD FOR MILLIONS question decides it. The dominant access pattern here
 * is "load one bill, draw it" — every renderer, the preview, every share. With
 * an EAV values table that is an extra join on every single invoice render,
 * and at 10 million bills × 3 fields it is a 30-million-row table joined on
 * the hot path to print a grocery bill. With JSONB the row already carries its
 * own fields: zero joins, and Postgres can still index into it with GIN when
 * someone searches by PO number, which is the rare case.
 *
 * ── VALUES ARE SNAPSHOTS, INCLUDING THEIR LABELS ──────────────────────
 *
 * Each stored value carries its key, its LABEL and its TYPE, not just the
 * value. That looks like duplication and is not: it is the same rule
 * `TransactionItem.hsn` and `gstTreatment` already follow in line-items.ts —
 * "editing a product's HSN next year cannot rewrite a filed return".
 *
 * If a shopkeeper renames "Batch" to "Lot No." in March, every invoice issued
 * before March must still print "Batch", because that is what the document
 * said when it was issued and a customer may be holding the paper. Storing
 * only `{key: value}` and looking the label up at render time would silently
 * rewrite history on every old bill.
 */

/**
 * What a field holds.
 *
 * Typed rather than all-strings so a date sorts and formats as a date and a
 * money column can join the totals — the plan's Layer 3 point. A string that
 * happens to look like a date is the thing that makes exports unusable.
 */
export type CustomFieldType = 'text' | 'number' | 'date' | 'money'

/** What the field hangs off. */
export type CustomFieldEntity = 'party' | 'invoice' | 'item'

export interface CustomFieldDef {
  id: string
  entity: CustomFieldEntity
  /**
   * The stable identifier. Generated once from the label and NEVER changed —
   * it is what already-issued bills are keyed on.
   */
  key: string
  /** What the shopkeeper reads. May be renamed; old bills keep the old one. */
  label: string
  type: CustomFieldType
  /** Print it on the bill, or keep it for the shop's own records only. */
  showOnInvoice: boolean
  required: boolean
  order: number
}

/** A value as STORED on a record. Self-describing, so it needs no lookup. */
export interface CustomFieldValue {
  key: string
  label: string
  type: CustomFieldType
  /** null when the shopkeeper left it blank on a non-required field. */
  value: string | number | null
  /**
   * Whether it printed on the bill.
   *
   * Snapshotted for the same reason as the label: if a shopkeeper later
   * stops printing a field, a bill issued while it DID print must still
   * show it — the customer is holding that paper. Reading the definition
   * at render time would quietly rewrite what old invoices say.
   */
  show: boolean
}

/**
 * How many fields one shop may define, per entity.
 *
 * A cap, because there must be one. Without it a bill can grow two hundred
 * columns, the JSON on every row grows without bound, and the person who
 * discovers the limit is a shopkeeper whose invoice no longer fits the page.
 * Ten is more than any trade in the reference material uses — pharma, the
 * heaviest, needs batch, expiry, pack, MRP and free quantity.
 */
export const MAX_FIELDS_PER_ENTITY = 10

/**
 * Names a custom field may not take.
 *
 * ── THE §0 REFUSAL, again ─────────────────────────────────────────────
 *
 * Rule 46 lists what a tax invoice must carry, and this app already prints
 * every one of them. A shopkeeper who adds a custom field called "GSTIN" now
 * has a bill with TWO GSTINs on it, which may disagree — and a document
 * carrying two different tax numbers is worse than one carrying none, because
 * it looks authoritative while being wrong.
 *
 * So these labels are refused. Not hidden, not silently renamed: refused with
 * a reason, which is the only honest thing to do when a shopkeeper is about
 * to make their own invoice invalid.
 *
 * Compared case-and-space-insensitively, because "gst in" and "GSTIN" are the
 * same mistake.
 */
export const RESERVED_FIELD_LABELS = [
  'gstin', 'gst no', 'gst number', 'gst',
  'invoice no', 'invoice number', 'bill no', 'bill number',
  'invoice date', 'bill date', 'date',
  'hsn', 'hsn code', 'sac', 'hsn/sac',
  'taxable value', 'taxable amount',
  'cgst', 'sgst', 'igst', 'cess', 'tax', 'gst rate', 'tax rate',
  'total', 'grand total', 'amount', 'net amount',
  'place of supply', 'state code',
  'irn', 'signed qr', 'ack no',
] as const

/** Normalised for comparison: lowercase, punctuation and spacing collapsed. */
function normaliseLabel(label: string): string {
  return label.trim().toLowerCase().replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim()
}

/**
 * Is this label safe to use?
 *
 * A plain function over two plain inputs SPECIFICALLY so a test can run it
 * against a good name and a reserved one without building an invoice — the
 * rule CLAUDE.md's Cause 7 earned after five guards that could not fail.
 */
export function reservedLabelError(label: string): string | null {
  const n = normaliseLabel(label)
  if (!n) return 'Give the field a name.'
  if ((RESERVED_FIELD_LABELS as readonly string[]).includes(n)) {
    return `"${label.trim()}" is already printed on every bill by law. `
      + 'Two of them on one invoice can disagree, so please pick another name.'
  }
  return null
}

/**
 * A stable key from a label.
 *
 * Generated ONCE, when the field is created, and stored. It never changes
 * afterwards even if the label does, because issued bills are keyed on it.
 */
export function keyFromLabel(label: string): string {
  const base = normaliseLabel(label).replace(/ /g, '_').slice(0, 40)
  return base || 'field'
}

/**
 * Coerce and validate one value against its definition.
 *
 * Returns the value to STORE, or a message for the shopkeeper. Never throws
 * and never guesses: a date it cannot parse is an error, not today's date.
 */
export function parseCustomValue(
  def: Pick<CustomFieldDef, 'label' | 'type' | 'required'>,
  raw: unknown,
): { ok: true; value: string | number | null } | { ok: false; error: string } {
  const empty = raw === null || raw === undefined || (typeof raw === 'string' && !raw.trim())
  if (empty) {
    if (def.required) return { ok: false, error: `${def.label} is needed.` }
    return { ok: true, value: null }
  }

  const s = String(raw).trim()

  if (def.type === 'text') {
    // Capped so one pasted paragraph cannot bloat every row that follows it.
    if (s.length > 200) return { ok: false, error: `${def.label} is too long (200 characters max).` }
    return { ok: true, value: s }
  }

  if (def.type === 'number' || def.type === 'money') {
    const n = Number(s.replace(/,/g, ''))
    if (!Number.isFinite(n)) return { ok: false, error: `${def.label} must be a number.` }
    /*
     * Money is NOT converted to paise here.
     *
     * The paise extension intercepts named columns on known models; a value
     * inside a JSON blob is invisible to it. Storing a rupee figure that looks
     * like the integer columns beside it is exactly how the 100x bug happened.
     * So a custom money field stays a plain decimal, and the renderers format
     * it — it never joins the invoice arithmetic.
     */
    return { ok: true, value: n }
  }

  // date — stored as YYYY-MM-DD, never a locale string.
  const d = new Date(s)
  if (isNaN(d.getTime())) return { ok: false, error: `${def.label} must be a date.` }
  return { ok: true, value: d.toISOString().slice(0, 10) }
}

/**
 * Build the snapshot to store on a record.
 *
 * Skips fields the shopkeeper left blank, so an invoice does not carry empty
 * keys forever. Returns the first error rather than a list: a form that
 * reports one problem at a time is easier to fix than one that reports six.
 */
export function snapshotCustomValues(
  defs: CustomFieldDef[],
  raw: Record<string, unknown>,
): { ok: true; values: CustomFieldValue[] } | { ok: false; error: string } {
  const values: CustomFieldValue[] = []
  for (const def of [...defs].sort((a, b) => a.order - b.order)) {
    const parsed = parseCustomValue(def, raw[def.key])
    if (!parsed.ok) return { ok: false, error: parsed.error }
    if (parsed.value === null) continue
    values.push({
      key: def.key, label: def.label, type: def.type,
      value: parsed.value, show: def.showOnInvoice,
    })
  }
  return { ok: true, values }
}

/** How a stored value is written on a bill. */
export function formatCustomValue(v: CustomFieldValue): string {
  if (v.value === null) return ''
  if (v.type === 'money') {
    return `₹${Number(v.value).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
  }
  if (v.type === 'date') {
    const d = new Date(String(v.value))
    if (isNaN(d.getTime())) return String(v.value)
    return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })
  }
  return String(v.value)
}

/**
 * Read a record's stored values back, defensively.
 *
 * The column is JSON, so anything could be in there — an older shape, a
 * hand-edited row, a half-written migration. A bill that throws while
 * rendering because one custom field is malformed is a worse outcome than a
 * bill missing that field, so unrecognised entries are dropped rather than
 * fatal.
 */
export function readCustomValues(stored: unknown): CustomFieldValue[] {
  if (!Array.isArray(stored)) return []
  const types: CustomFieldType[] = ['text', 'number', 'date', 'money']
  return stored.filter((v): v is CustomFieldValue => {
    if (!v || typeof v !== 'object') return false
    const c = v as Partial<CustomFieldValue>
    return typeof c.key === 'string'
      && typeof c.label === 'string'
      && typeof c.type === 'string'
      && types.includes(c.type as CustomFieldType)
      && (typeof c.value === 'string' || typeof c.value === 'number' || c.value === null)
      && typeof c.show === 'boolean'
  })
}
