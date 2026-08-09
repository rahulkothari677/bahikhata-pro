/**
 * 🔒 V17 Audit Phase 3 — GSTR-1 pure-function builder.
 *
 * Generates the GST portal-ready GSTR-1 JSON structure from transaction data.
 * Pure functions — no DB import, no side effects. Fully testable.
 *
 * The GSTR-1 has 8 sections:
 *   1. B2B   — Business-to-Business (party has GSTIN)
 *   2. B2CL  — B2C Large (inter-state, invoice value > ₹1 lakh)
 *   3. B2CS  — B2C Small (all other B2C)
 *   4. CDNR  — Credit/Debit Notes Registered (party has GSTIN)
 *   5. CDNUR — Credit/Debit Notes Unregistered (party has no GSTIN)
 *   6. HSN   — HSN-wise summary of all outward supplies
 *   7. NIL   — Nil-rated, exempt, non-GST outward supplies
 *   8. DOC   — Document issuance summary (invoice count, cancelled count)
 *
 * Each function takes pre-fetched transaction rows + items and returns the
 * portal-format JSON for that section. The API route assembles them into the
 * final `{ gstr1: { ... } }` structure.
 *
 * SIGN CONVENTIONS:
 *   - Sale totalAmount, subtotal, cgst, sgst, igst: POSITIVE
 *   - Credit-note totalAmount, subtotal, cgst, sgst, igst: POSITIVE (absolute values)
 *   - Credit-note grossProfit: NEGATIVE (reverses sale profit)
 *   - The builder treats credit notes as REDUCTIONS (subtracts their values from output tax)
 *
 * TESTING: Each function is pure → fully testable without mocking the DB.
 * Tests use realistic data with the REAL sign conventions.
 */

import { roundMoney } from '@/lib/money'
import { deriveStateCode } from '@/lib/gst-states'
import { classifySupplyLine, isTaxableSupply } from '@/lib/supply-classification'
import { advanceTax, isTaxableAdvance, type AdvanceReceipt } from '@/lib/advance-tax'

// ─── Input types ──────────────────────────────────────────────────────────

// 🔒 AUDIT V24 follow-up (POS fix): Place of Supply must be the BUYER's state,
// not the shop's. Was: every section used `shop.stateCode` — so an inter-state
// B2B/B2CL invoice carried pos = home state together with IGST amounts, which
// the GST portal cross-validates and rejects (pos == supplier state implies
// CGST/SGST, not IGST). For intra-state and walk-in sales the fallback chain
// (party GSTIN → party state → shop GSTIN → shop state) lands on the shop's
// code, so those are unchanged.
function placeOfSupply(txn: Gstr1Transaction, shop: ShopInfo): string {
  return (
    deriveStateCode(txn.partyGstin, txn.partyState, shop.gstin, shop.state) ||
    shop.stateCode ||
    '00'
  )
}

/** A transaction row with its items, as fetched from the DB. */
export interface Gstr1Transaction {
  id: string
  type: string          // 'sale' | 'credit-note' | 'income' | 'expense'
  invoiceNo: string | null
  date: Date
  totalAmount: number
  subtotal: number
  discountAmount: number
  cgst: number
  sgst: number
  igst: number
  isInterState: boolean
  isReverseCharge: boolean
  partyId: string | null
  partyName: string | null
  partyGstin: string | null
  partyState: string | null
  items: Gstr1Item[]
  // 🔒 V26 BUG-062: originalTransactionId for note-vs-original classification.
  // When a credit/debit note is created against an original sale/purchase,
  // the note's B2CS-vs-CDNUR classification should be based on the ORIGINAL
  // invoice's isInterState + totalAmount, not the note's own values.
  // (The note typically inherits these from the original at creation time,
  // but if the original is later edited, the note's stale values would
  // produce wrong classification. Looking up the original is strictly correct.)
  originalTransactionId?: string | null
}

export interface Gstr1Item {
  productId: string | null
  productName: string
  hsn: string | null
  /** taxable | nil | exempt | nonGst as at sale time. Null on pre-2026-08 rows. */
  gstTreatment?: string | null
  quantity: number
  unit: string
  unitPrice: number
  gstRate: number
  discountAmount: number
  cgst: number
  sgst: number
  igst: number
  csamt: number  // CESS
}

export interface ShopInfo {
  gstin: string | null
  state: string | null
  stateCode: string | null  // 2-digit code derived from gstin or state
}

// ─── Output types (GST portal JSON structure) ─────────────────────────────

export interface Gstr1B2bInvoice {
  inum: string       // invoice number
  idt: string        // invoice date (dd-mm-yyyy)
  val: number        // invoice value (total)
  pos: string        // place of supply (2-digit state code)
  rchrg: 'Y' | 'N'  // reverse charge
  inv_typ: 'R' | 'SEWP' | 'SEWOP' | 'DE'  // R=regular, SEWP=export w/ payment, SEWOP=export w/o payment, DE=deemed
  // 🔒 V26 N1: GSTN offline-tool schema requires each line item wrapped in
  // { num, itm_det: {…} } with a 1-based serial. A flat `itms: [{rt, txval, …}]`
  // array is rejected by the portal on upload.
  itms: Array<{
    num: number      // 1-based line serial
    itm_det: {
      rt: number     // GST rate
      txval: number  // taxable value
      iamt: number   // IGST
      camt: number   // CGST
      samt: number   // SGST
      csamt: number  // CESS
    }
  }>
}

export interface Gstr1B2bEntry {
  ctin: string       // counter-party GSTIN
  inv: Gstr1B2bInvoice[]
}

export interface Gstr1B2clEntry {
  pos: string        // place of supply
  inv: Array<{
    inum: string
    idt: string
    val: number
    // 🔒 V26 N1: B2CL itm_det carries only {txval, rt, iamt, csamt} per GSTN
    // schema — inter-state supplies have IGST only, no CGST/SGST.
    itms: Array<{ num: number; itm_det: { rt: number; txval: number; iamt: number; csamt: number } }>
  }>
}

export interface Gstr1B2csEntry {
  typ: 'OE' | 'IN'  // OE = outward (inter-state), IN = intra-state (unused, always OE for outward)
  pos: string
  txval: number
  iamt: number
  camt: number
  samt: number
  csamt: number
  rt: number
}

export interface Gstr1CdnrEntry {
  ctin: string
  nt: Array<{
    nt_num: string
    nt_dt: string
    val: number
    ntty: 'C' | 'D'  // C=credit note, D=debit note
    pos: string
    rchrg: 'Y' | 'N'
    typ: 'R' | 'SEWP' | 'SEWOP' | 'DE'
    // 🔒 V26 N1: same { num, itm_det } wrapper as B2B.
    itms: Array<{ num: number; itm_det: { rt: number; txval: number; iamt: number; camt: number; samt: number; csamt: number } }>
  }>
}

export interface Gstr1CdnurEntry {
  typ: 'B2CL' | 'EXPWP' | 'EXPWOP'  // type of original invoice
  nt_num: string
  nt_dt: string
  val: number
  ntty: 'C' | 'D'
  pos: string
  rchrg: 'Y' | 'N'
  // 🔒 V26 N1: same { num, itm_det } wrapper as B2B.
  itms: Array<{ num: number; itm_det: { rt: number; txval: number; iamt: number; camt: number; samt: number; csamt: number } }>
}

export interface Gstr1HsnEntry {
  num: number       // serial number
  hsn_sc: string    // HSN/SAC code
  desc: string      // description
  uqc: string       // unit quantity code (PCS, KGS, etc.)
  qty: number
  txval: number
  iamt: number
  camt: number
  samt: number
  csamt: number
  rt: number
}

export interface Gstr1NilEntry {
  // 🔒 V26 BUG-059: sply_ty represents the SUPPLY TYPE (inter/intra-state ×
  // B2B/B2C), NOT the exemption category. The old code used 'NIL'/'EXPT'/'NGST'
  // which the portal rejects — those are amounts WITHIN each supply-type entry,
  // not the supply type itself.
  sply_ty: 'INTRAB2B' | 'INTRB2B' | 'INTRAB2C' | 'INTRB2C'
  nil_amt: number    // nil-rated supplies amount for this supply type
  expt_amt: number   // exempt supplies amount for this supply type
  ngsup_amt: number  // non-GST supplies amount for this supply type
}

export interface Gstr1DocEntry {
  doc_num: number   // 1=sales invoice, 2=credit note, 3=debit note
  doc_typ: string
  docs: Array<{
    num: number
    from: string
    to: string
    totnum: number
    cancel: number
    net_issue: number
  }>
}

export interface Gstr1Result {
  gstin: string
  fp: string         // filing period (MMYYYY)
  gt: number         // 🔒 V26 N9: prior-FY outward turnover (was hardcoded 0)
  cur_gt: number     // 🔒 V26 N9: current-period outward turnover (was hardcoded 0)
  b2b: Gstr1B2bEntry[]
  b2cl: Gstr1B2clEntry[]
  b2cs: Gstr1B2csEntry[]
  cdnr: Gstr1CdnrEntry[]
  cdnur: Gstr1CdnurEntry[]
  hsn: { data: Gstr1HsnEntry[] }
  nil: { inv: Gstr1NilEntry[] }
  doc_issue: { doc_det: Gstr1DocEntry[] }
  /** Table 9A — invoices from earlier FILED returns that have since changed. */
  b2ba: Array<{ ctin: string; inv: unknown[] }>
  b2cla: Array<{ pos: string; inv: unknown[] }>
  /** Table 11A — advances received this period on which tax is due. */
  at: Gstr1AdvanceEntry[]
  /** Table 11B — earlier advances released against invoices raised this period. */
  txpd: Gstr1AdvanceEntry[]
}

/**
 * Tables 11A (`at`) and 11B (`txpd`) share one shape on the portal: grouped by
 * place of supply and inter/intra, then rate-wise inside.
 */
export interface Gstr1AdvanceEntry {
  pos: string
  sply_ty: 'INTER' | 'INTRA'
  itms: Array<{
    rt: number
    /** Taxable value of the advance — the money less the tax inside it. */
    ad_amt: number
    iamt: number
    camt: number
    samt: number
    csamt: number
  }>
}

// ─── Helper ───────────────────────────────────────────────────────────────

/** Format a Date as dd-mm-yyyy (GST portal date format). */
function formatPortalDate(date: Date): string {
  const d = String(date.getDate()).padStart(2, '0')
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const y = date.getFullYear()
  return `${d}-${m}-${y}`
}

/** Compute taxable value for an item: qty × unitPrice − discountAmount. */
function itemTaxable(item: Gstr1Item): number {
  return roundMoney(item.quantity * item.unitPrice - (item.discountAmount || 0))
}

/**
 * The lines that belong in the taxable tables (4 / 5 / 7).
 *
 * WHY (2026-08-08). B2B, B2CL and B2CS were built from `txn.items` wholesale,
 * so a nil-rated or exempt line was emitted here as a 0%-rated row AND counted
 * again by buildNIL in Table 8. For August 2026 that was ₹3,059 reported twice
 * in the same return — ₹120 of it inside B2B, ₹2,939 inside B2CS.
 *
 * A supply belongs in the taxable tables OR in Table 8, never both. Double
 * reporting inflates GSTR-1 turnover against the books and against GSTR-3B,
 * which is exactly the mismatch the department reconciles on.
 *
 * The invoice-level `val` is deliberately NOT reduced: that field is the
 * invoice's total value, which does include the exempt lines. Only the itms —
 * the rate-wise breakdown that the portal totals into outward supplies — are
 * filtered.
 */
function taxableItems(items: Gstr1Item[]): Gstr1Item[] {
  return items.filter(isTaxableSupply)
}

// ─── B2CL threshold ──────────────────────────────────────────────
// 🔒 AUDIT V24 §4: Inter-state B2C invoices ABOVE this value (GST-inclusive
// invoice value) are reported invoice-wise in B2CL; at or below, they are
// rate-aggregated in B2CS. ₹2,50,000 historically; reduced to ₹1,00,000 w.e.f.
// 01-Aug-2024 by CBIC Notification No. 12/2024–Central Tax. If this changes
// again (or period-aware filing of pre-Aug-2024 months is needed), update or
// parameterize HERE — it is deliberately the single source for both sections.
export const B2CL_INVOICE_VALUE_THRESHOLD = 100000

// ─── Section builders ─────────────────────────────────────────────────────

/**
 * Build B2B section: sales to parties WITH a GSTIN.
 * Groups by counter-party GSTIN (ctin), then lists invoices.
 */
export function buildB2B(txns: Gstr1Transaction[], shop: ShopInfo): Gstr1B2bEntry[] {
  const b2bSales = txns.filter(t => t.type === 'sale' && t.partyGstin && t.partyGstin.length >= 15)
  const byGstin = new Map<string, Gstr1B2bInvoice[]>()

  for (const txn of b2bSales) {
    const ctin = txn.partyGstin!
    const pos = placeOfSupply(txn, shop)
    const items = taxableItems(txn.items)
    // An invoice that is entirely exempt/nil belongs in Table 8 alone. Emitting
    // it here with an empty itms array would declare an invoice with no supply.
    if (items.length === 0) continue
    const inv: Gstr1B2bInvoice = {
      inum: txn.invoiceNo || txn.id,
      idt: formatPortalDate(txn.date),
      val: roundMoney(txn.totalAmount),
      pos,
      rchrg: txn.isReverseCharge ? 'Y' : 'N',
      inv_typ: 'R',  // Regular (no export tracking)
      itms: items.map((item, i) => ({
        num: i + 1,
        itm_det: {
          rt: item.gstRate,
          txval: itemTaxable(item),
          iamt: roundMoney(item.igst),
          camt: roundMoney(item.cgst),
          samt: roundMoney(item.sgst),
          csamt: roundMoney(item.csamt || 0),
        },
      })),
    }
    if (!byGstin.has(ctin)) byGstin.set(ctin, [])
    byGstin.get(ctin)!.push(inv)
  }

  return Array.from(byGstin.entries()).map(([ctin, inv]) => ({ ctin, inv }))
}

/**
 * Build B2CL section: inter-state B2C sales with invoice value > ₹1 lakh.
 * Groups by POS (place of supply). IGST only (no CGST/SGST for inter-state).
 */
export function buildB2CL(txns: Gstr1Transaction[], shop: ShopInfo): Gstr1B2clEntry[] {
  const b2clSales = txns.filter(t =>
    t.type === 'sale' &&
    t.isInterState &&
    (!t.partyGstin || t.partyGstin.length < 15) &&
    t.totalAmount > B2CL_INVOICE_VALUE_THRESHOLD
  )
  const byPos = new Map<string, Gstr1B2clEntry['inv']>()

  for (const txn of b2clSales) {
    const pos = placeOfSupply(txn, shop)
    const items = taxableItems(txn.items)
    // Entirely exempt/nil invoices belong in Table 8 alone — see taxableItems.
    if (items.length === 0) continue
    const inv = {
      inum: txn.invoiceNo || txn.id,
      idt: formatPortalDate(txn.date),
      val: roundMoney(txn.totalAmount),
      itms: items.map((item, i) => ({
        num: i + 1,
        itm_det: {
          rt: item.gstRate,
          txval: itemTaxable(item),
          iamt: roundMoney(item.igst),
          csamt: roundMoney(item.csamt || 0),
        },
      })),
    }
    if (!byPos.has(pos)) byPos.set(pos, [])
    byPos.get(pos)!.push(inv)
  }

  return Array.from(byPos.entries()).map(([pos, inv]) => ({ pos, inv }))
}

/**
 * 🔒 V26 BUG-062: Resolve the classification values (isInterState, totalAmount)
 * for a credit/debit note by looking up its original transaction.
 *
 * Per strict GST rules, the B2CS-vs-CDNUR classification of a note should be
 * based on the ORIGINAL supply's characteristics, not the note's own values.
 * The note typically inherits isInterState from the original at creation time,
 * but if the original is later edited (e.g. totalAmount changes), the note's
 * stale values would produce wrong classification.
 *
 * This helper:
 *   1. If the note has an originalTransactionId AND the original is in the
 *      txns array → use the original's isInterState + totalAmount.
 *   2. Otherwise → fall back to the note's own values (the pre-BUG-062 behavior,
 *      which is correct when the note hasn't been edited independently).
 *
 * @param note   the credit/debit note transaction
 * @param txns   all transactions in the filing period (for lookup)
 * @returns      { isInterState, totalAmount } from the original or the note itself
 */
function resolveNoteClassification(
  note: Gstr1Transaction,
  txns: Gstr1Transaction[],
): { isInterState: boolean; totalAmount: number } {
  if (note.originalTransactionId) {
    const original = txns.find(t => t.id === note.originalTransactionId)
    if (original) {
      return {
        isInterState: original.isInterState,
        totalAmount: original.totalAmount,
      }
    }
  }
  // Fallback: use the note's own values (correct when the note hasn't been
  // edited independently of the original).
  return {
    isInterState: note.isInterState,
    totalAmount: note.totalAmount,
  }
}

/**
 * Build B2CS section: small B2C sales (inter-state OR intra-state, ≤ ₹1 lakh).
 * Aggregates by rate + POS — ONE entry per (rate, pos) combination.
 *
 * 🔒 V26 N2: Credit/debit notes for unregistered parties whose original
 * supply is B2CS (unregistered AND (intra-state OR totalAmount ≤ threshold))
 * are NETTED into B2CS as reductions. A (rate, pos) row may legitimately
 * go NEGATIVE — the GST portal accepts negative B2CS adjustments. These
 * notes do NOT go to CDNUR (CDNUR is reserved for inter-state B2CL originals).
 */
export function buildB2CS(txns: Gstr1Transaction[], shop: ShopInfo): Gstr1B2csEntry[] {
  // Sales that are B2CS: unregistered + (intra-state OR ≤ threshold)
  const b2csSales = txns.filter(t =>
    t.type === 'sale' &&
    (!t.partyGstin || t.partyGstin.length < 15) &&
    (!t.isInterState || t.totalAmount <= B2CL_INVOICE_VALUE_THRESHOLD)
  )
  // 🔒 V26 N2 + BUG-062: Notes whose ORIGINAL supply is B2CS.
  // Uses resolveNoteClassification to look up the original invoice's
  // isInterState + totalAmount (falls back to note's own values if the
  // original isn't in the txns array).
  const b2csNotes = txns.filter(t => {
    if (t.type !== 'credit-note' && t.type !== 'debit-note') return false
    if (t.partyGstin && t.partyGstin.length >= 15) return false  // registered → CDNR
    const orig = resolveNoteClassification(t, txns)
    return !orig.isInterState || orig.totalAmount <= B2CL_INVOICE_VALUE_THRESHOLD
  })

  // Aggregate by (rate, pos)
  const agg = new Map<string, { txval: number; iamt: number; camt: number; samt: number; csamt: number; rt: number; pos: string }>()

  const addToAgg = (item: Gstr1Item, pos: string, sign: 1 | -1) => {
    const key = `${item.gstRate}|${pos}`
    const existing = agg.get(key) || { txval: 0, iamt: 0, camt: 0, samt: 0, csamt: 0, rt: item.gstRate, pos }
    existing.txval = roundMoney(existing.txval + sign * itemTaxable(item))
    existing.iamt = roundMoney(existing.iamt + sign * item.igst)
    existing.camt = roundMoney(existing.camt + sign * item.cgst)
    existing.samt = roundMoney(existing.samt + sign * item.sgst)
    existing.csamt = roundMoney(existing.csamt + sign * (item.csamt || 0))
    agg.set(key, existing)
  }

  for (const txn of b2csSales) {
    const pos = placeOfSupply(txn, shop)
    // Nil/exempt lines are Table 8's, not Table 7's — see taxableItems.
    for (const item of taxableItems(txn.items)) addToAgg(item, pos, 1)
  }
  // 🔒 V26 N2: Subtract B2CS notes (credit notes reduce, debit notes increase)
  for (const txn of b2csNotes) {
    const pos = placeOfSupply(txn, shop)
    const sign: 1 | -1 = txn.type === 'credit-note' ? -1 : 1
    // A note against an exempt supply adjusts Table 8, not the rate-wise
    // aggregate — so it is filtered on the same rule as the sale it reverses.
    for (const item of taxableItems(txn.items)) addToAgg(item, pos, sign)
  }

  return Array.from(agg.values()).map(a => ({
    typ: 'OE' as const,
    pos: a.pos,
    txval: a.txval,
    iamt: a.iamt,
    camt: a.camt,
    samt: a.samt,
    csamt: a.csamt,
    rt: a.rt,
  }))
}

/**
 * Build CDNR section: credit/debit notes for parties WITH a GSTIN.
 * Groups by counter-party GSTIN.
 */
export function buildCDNR(txns: Gstr1Transaction[], shop: ShopInfo): Gstr1CdnrEntry[] {
  const notes = txns.filter(t =>
    (t.type === 'credit-note' || t.type === 'debit-note') &&
    t.partyGstin && t.partyGstin.length >= 15
  )
  const byGstin = new Map<string, Gstr1CdnrEntry['nt']>()

  for (const txn of notes) {
    const ctin = txn.partyGstin!
    const pos = placeOfSupply(txn, shop)
    const nt = {
      nt_num: txn.invoiceNo || txn.id,
      nt_dt: formatPortalDate(txn.date),
      val: roundMoney(txn.totalAmount),
      ntty: (txn.type === 'credit-note' ? 'C' : 'D') as 'C' | 'D',
      pos,
      rchrg: 'N' as const,
      typ: 'R' as const,
      itms: txn.items.map((item, i) => ({
        num: i + 1,
        itm_det: {
          rt: item.gstRate,
          txval: itemTaxable(item),
          iamt: roundMoney(item.igst),
          camt: roundMoney(item.cgst),
          samt: roundMoney(item.sgst),
          csamt: roundMoney(item.csamt || 0),
        },
      })),
    }
    if (!byGstin.has(ctin)) byGstin.set(ctin, [])
    byGstin.get(ctin)!.push(nt)
  }

  return Array.from(byGstin.entries()).map(([ctin, nt]) => ({ ctin, nt }))
}

/**
 * Build CDNUR section: credit/debit notes for parties WITHOUT a GSTIN (unregistered)
 * whose original supply was B2CL (inter-state AND original invoice > ₹1 lakh).
 * Flat array (no ctin grouping).
 *
 * 🔒 V26 N2: CDNUR (Table 9B) only accepts `typ` B2CL or exports, and B2CL
 * implies an INTER-STATE POS. An intra-state unregistered note in CDNUR with
 * `typ:'B2CL'` is portal-rejected. B2CS notes (intra-state OR ≤ threshold)
 * are netted into B2CS by buildB2CS — they must NOT appear here. Exports
 * (EXPWP/EXPWOP) are out of scope until the app tracks export invoices.
 */
export function buildCDNUR(txns: Gstr1Transaction[], shop: ShopInfo): Gstr1CdnurEntry[] {
  // 🔒 V26 N2 + BUG-062: CDNUR (Table 9B) only accepts typ B2CL or exports,
  // and B2CL implies an INTER-STATE POS. Uses resolveNoteClassification to
  // look up the original invoice's isInterState + totalAmount (falls back to
  // note's own values if the original isn't in the txns array).
  const notes = txns.filter(t => {
    if (t.type !== 'credit-note' && t.type !== 'debit-note') return false
    if (t.partyGstin && t.partyGstin.length >= 15) return false  // registered → CDNR
    const orig = resolveNoteClassification(t, txns)
    return orig.isInterState && orig.totalAmount > B2CL_INVOICE_VALUE_THRESHOLD
  })
  return notes.map(txn => ({
    typ: 'B2CL' as const,
    nt_num: txn.invoiceNo || txn.id,
    nt_dt: formatPortalDate(txn.date),
    val: roundMoney(txn.totalAmount),
    ntty: (txn.type === 'credit-note' ? 'C' : 'D') as 'C' | 'D',
    pos: placeOfSupply(txn, shop),
    rchrg: 'N' as const,
    itms: txn.items.map((item, i) => ({
      num: i + 1,
      itm_det: {
        rt: item.gstRate,
        txval: itemTaxable(item),
        iamt: roundMoney(item.igst),
        camt: roundMoney(item.cgst),
        samt: roundMoney(item.sgst),
        csamt: roundMoney(item.csamt || 0),
      },
    })),
  }))
}

/**
 * Build HSN section: HSN-wise summary of ALL outward supplies (sales + credit notes).
 * Aggregates by HSN code + rate.
 */
export function buildHSN(txns: Gstr1Transaction[]): { data: Gstr1HsnEntry[] } {
  const outward = txns.filter(t => t.type === 'sale' || t.type === 'credit-note')
  const agg = new Map<string, { hsn: string; desc: string; qty: number; uqc: string; txval: number; iamt: number; camt: number; samt: number; csamt: number; rt: number }>()

  for (const txn of outward) {
    for (const item of txn.items) {
      /*
       * A line with no HSN is LEFT OUT of Table 12. It is not given a made-up one.
       *
       * WAS: `item.hsn || '9999'`. Verified in a generated August 2026 return,
       * where Tata Tea, Toor Dal and Colgate were all filed as HSN "9999" — the
       * same Colgate appearing correctly as 3306 a few rows below, from sales
       * made after HSN snapshotting was fixed.
       *
       * 9999 is not a valid HSN for goods. It belongs to the SERVICES code
       * range (SAC 9999xx, "other services"), so filing goods under it is not a
       * harmless placeholder — it declares the wrong thing. Since the 2025
       * Table 12 phases the portal validates HSN against a master list and this
       * would be rejected outright; before that it would simply have been
       * accepted and wrong, which is worse, because nothing would have told
       * anyone.
       *
       * Omitting is the honest option: a missing row is visibly missing and the
       * HSN report already names every sale lacking a code, so the shopkeeper
       * is told what to fix. A fabricated row looks complete and is false.
       *
       * NOTE this deliberately makes Table 12 total LESS than the return's
       * turnover when codes are missing. That gap is the point — it is a true
       * statement about incomplete data, where "9999" was a false statement
       * about complete data.
       */
      if (!item.hsn || !String(item.hsn).trim()) continue
      const hsn = String(item.hsn).trim()
      // 🔒 AUDIT G2: the UQC is part of the aggregation key.
      //
      // WAS: `${hsn}|${item.gstRate}` — so every line sharing an HSN and a rate
      // collapsed into one row, and `uqc` was taken from whichever item was
      // seen FIRST. Quantities in different units were then added together
      // under that arbitrary unit.
      //
      // A shop selling rice under one HSN both loose (kg) and in packets would
      // file a single row reading "15 KGS" for 5 kg + 10 packets. The value and
      // tax columns stayed correct — only the quantity became meaningless — so
      // nothing in the app or the return would look wrong, while Table 12 of
      // GSTR-1 carried a number that does not describe anything real.
      //
      // Keying by UQC as well emits one row per (HSN, rate, unit), which is
      // what Table 12 expects and what makes the quantity column mean
      // something. Shops that use a single unit per HSN — most of them — see no
      // change at all.
      const uqc = mapUnitToUqc(item.unit)
      const key = `${hsn}|${item.gstRate}|${uqc}`
      const existing = agg.get(key) || {
        hsn, desc: item.productName, qty: 0, uqc,
        txval: 0, iamt: 0, camt: 0, samt: 0, csamt: 0, rt: item.gstRate,
      }
      // Credit notes REDUCE the HSN totals (they're returns)
      const sign = txn.type === 'credit-note' ? -1 : 1
      existing.qty = roundMoney(existing.qty + sign * item.quantity)
      existing.txval = roundMoney(existing.txval + sign * itemTaxable(item))
      existing.iamt = roundMoney(existing.iamt + sign * item.igst)
      existing.camt = roundMoney(existing.camt + sign * item.cgst)
      existing.samt = roundMoney(existing.samt + sign * item.sgst)
      existing.csamt = roundMoney(existing.csamt + sign * (item.csamt || 0))
      agg.set(key, existing)
    }
  }

  let num = 0
  const data = Array.from(agg.values()).map(a => ({
    num: ++num,
    hsn_sc: a.hsn,
    desc: a.desc,
    uqc: a.uqc,
    qty: a.qty,
    txval: a.txval,
    iamt: a.iamt,
    camt: a.camt,
    samt: a.samt,
    csamt: a.csamt,
    rt: a.rt,
  }))

  return { data }
}

/** Map EkBook units to GST portal UQC codes. */
function mapUnitToUqc(unit: string): string {
  const uqcMap: Record<string, string> = {
    'pcs': 'PCS',
    'kg': 'KGS',
    'gm': 'GMS',
    'ltr': 'LTR',
    'ml': 'MLT',
    'm': 'MTR',
    'box': 'BOX',
    'dozen': 'DOZ',
    'packet': 'PAC',
  }
  return uqcMap[unit?.toLowerCase()] || 'PCS'
}

/**
 * Build NIL section: nil-rated, exempt, and non-GST outward supplies.
 *
 * 🔒 V26 BUG-059: Completely restructured. Was emitting 3 entries with
 * sply_ty = 'NIL'/'EXPT'/'NGST' — but the GSTN schema requires sply_ty to
 * be the SUPPLY TYPE (inter/intra-state × B2B/B2C), with separate amount
 * fields (nil_amt, expt_amt, ngsup_amt) WITHIN each entry.
 *
 * Correct structure (max 4 entries, one per supply type):
 *   { "sply_ty": "INTRAB2B", "nil_amt": 1000, "expt_amt": 0, "ngsup_amt": 0 }
 *   { "sply_ty": "INTRAB2C", "nil_amt": 500, "expt_amt": 0, "ngsup_amt": 0 }
 *
 * Supply type derivation:
 *   - isInterState=true + party has GSTIN → INTRB2B (inter-state B2B)
 *   - isInterState=true + no GSTIN       → INTRB2C (inter-state B2C)
 *   - isInterState=false + party has GSTIN → INTRAB2B (intra-state B2B)
 *   - isInterState=false + no GSTIN       → INTRAB2C (intra-state B2C)
 *
 * Amount classification:
 *   - nil_amt: items with gstRate=0 (nil-rated — 0% GST but taxable supply)
 *   - expt_amt: items marked as exempt (not yet tracked — Product.gstTreatment
 *     is not available in the builder's input; stays 0 until the app tracks it)
 *   - ngsup_amt: items marked as non-GST (same — stays 0 until tracked)
 *
 * Only entries with at least one non-zero amount are included.
 */
export function buildNIL(txns: Gstr1Transaction[]): { inv: Gstr1NilEntry[] } {
  const sales = txns.filter(t => t.type === 'sale' && !t.isReverseCharge)

  // 4 supply-type buckets
  const buckets: Record<'INTRAB2B' | 'INTRB2B' | 'INTRAB2C' | 'INTRB2C', {
    nil_amt: number; expt_amt: number; ngsup_amt: number
  }> = {
    INTRAB2B: { nil_amt: 0, expt_amt: 0, ngsup_amt: 0 },
    INTRB2B: { nil_amt: 0, expt_amt: 0, ngsup_amt: 0 },
    INTRAB2C: { nil_amt: 0, expt_amt: 0, ngsup_amt: 0 },
    INTRB2C: { nil_amt: 0, expt_amt: 0, ngsup_amt: 0 },
  }

  for (const txn of sales) {
    // Determine supply type
    const isB2B = !!(txn.partyGstin && txn.partyGstin.length >= 15)
    const sply_ty: 'INTRAB2B' | 'INTRB2B' | 'INTRAB2C' | 'INTRB2C' = txn.isInterState
      ? (isB2B ? 'INTRB2B' : 'INTRB2C')
      : (isB2B ? 'INTRAB2B' : 'INTRAB2C')

    for (const item of txn.items) {
      const taxable = itemTaxable(item)
      /*
       * Three legally distinct things, three boxes.
       *
       *   nil-rated — taxable supply at 0% (salt)
       *   exempt    — exempted by notification (fresh milk, unbranded rice)
       *   non-GST   — outside GST altogether (petrol, alcohol)
       *
       * The treatment is snapshotted on the line. Where it is absent — rows
       * written before the column existed — fall back to the old rate-based
       * rule rather than guessing, so historical periods report exactly what
       * they reported before and nothing silently moves between boxes.
       */
      const cls = classifySupplyLine(item)
      if (cls === 'exempt') {
        buckets[sply_ty].expt_amt = roundMoney(buckets[sply_ty].expt_amt + taxable)
      } else if (cls === 'nonGst') {
        buckets[sply_ty].ngsup_amt = roundMoney(buckets[sply_ty].ngsup_amt + taxable)
      } else if (cls === 'nil') {
        buckets[sply_ty].nil_amt = roundMoney(buckets[sply_ty].nil_amt + taxable)
      }
    }
  }

  // Only include buckets with at least one non-zero amount
  const inv: Gstr1NilEntry[] = (Object.entries(buckets) as Array<
    [keyof typeof buckets, typeof buckets['INTRAB2B']]>
  )
    .filter(([_, v]) => v.nil_amt > 0 || v.expt_amt > 0 || v.ngsup_amt > 0)
    .map(([sply_ty, v]) => ({
      sply_ty,
      nil_amt: v.nil_amt,
      expt_amt: v.expt_amt,
      ngsup_amt: v.ngsup_amt,
    }))

  return { inv }
}


/**
 * Tables 11A and 11B — money taken before the bill existed.
 *
 * WHY (2026-08-09). Advances for GOODS carry no GST (Notification 66/2017), but
 * advances for SERVICES are taxable the moment the money arrives. The liability
 * is declared in 11A while no invoice exists, and released in 11B in the period
 * the invoice is finally raised. Neither table was built, so a salon, tailor or
 * repair shop taking a deposit had a liability the app could not report.
 *
 * WHICH TABLE A RECEIPT LANDS IN:
 *
 *   11A — received in THIS period and still unbilled at the end of it. If the
 *         invoice went out in the same period there is nothing to declare: the
 *         invoice itself already carries the tax, and reporting both would tax
 *         the same money twice.
 *   11B — received in an EARLIER period (so already declared in that period's
 *         11A) and settled against an invoice during THIS one.
 *
 * Those two are deliberately mutually exclusive, and they are the same two
 * quantities GSTR-3B adds to and subtracts from 3.1(a), so the returns agree by
 * construction rather than by coincidence.
 */
function buildAdvanceTable(
  receipts: AdvanceReceipt[],
  amountOf: (r: AdvanceReceipt) => number,
): Gstr1AdvanceEntry[] {
  const byGroup = new Map<string, Gstr1AdvanceEntry>()

  for (const r of receipts) {
    if (!isTaxableAdvance(r)) continue
    const amount = roundMoney(amountOf(r))
    if (amount <= 0) continue

    const rate = r.advanceGstRate as number
    const t = advanceTax(amount, rate, r.isInterState)
    const sply_ty: 'INTER' | 'INTRA' = r.isInterState ? 'INTER' : 'INTRA'
    const key = `${r.pos}|${sply_ty}`

    let entry = byGroup.get(key)
    if (!entry) {
      entry = { pos: r.pos, sply_ty, itms: [] }
      byGroup.set(key, entry)
    }
    let itm = entry.itms.find((i) => i.rt === rate)
    if (!itm) {
      itm = { rt: rate, ad_amt: 0, iamt: 0, camt: 0, samt: 0, csamt: 0 }
      entry.itms.push(itm)
    }
    itm.ad_amt = roundMoney(itm.ad_amt + t.adAmt)
    itm.iamt = roundMoney(itm.iamt + t.igst)
    itm.camt = roundMoney(itm.camt + t.cgst)
    itm.samt = roundMoney(itm.samt + t.sgst)
  }

  return [...byGroup.values()].filter((e) => e.itms.some((i) => i.ad_amt > 0))
}

/**
 * Table 11A — advances received THIS period and still unbilled at the end of it.
 *
 * Pass only receipts dated inside the period. Handing this the whole ledger
 * would re-declare an old advance that is still sitting unbilled, and the shop
 * would pay tax on the same money every month until it was invoiced.
 */
export function buildAT(receivedThisPeriod: AdvanceReceipt[]): Gstr1AdvanceEntry[] {
  return buildAdvanceTable(receivedThisPeriod, (r) => r.amount - r.adjustedByPeriodEnd)
}

/**
 * Table 11B — advances from EARLIER periods released against invoices raised
 * this period.
 *
 * Pass only receipts dated before the period. A receipt taken and billed within
 * the same month belongs in neither table: it never reached an 11A, so there is
 * nothing to release, and the invoice already carries the tax.
 */
export function buildTXPD(receivedEarlier: AdvanceReceipt[]): Gstr1AdvanceEntry[] {
  return buildAdvanceTable(receivedEarlier, (r) => r.adjustedInPeriod)
}


/*
 * The issued range must span CANCELLED numbers too.
 *
 * Table 13 declares which numbers left the book. A cancelled invoice consumed
 * its number — that is precisely why the portal asks for a cancelled count
 * rather than letting the number quietly disappear. If the range covered only
 * surviving invoices, a cancelled one at either end would leave a hole that the
 * return does not explain, which is the gap seen in the August 2026 file:
 * INV-0044 jumping to INV-0053 while the return declared nothing cancelled.
 *
 * Numbers are compared as strings, matching the existing sort. A shop mixing
 * series ("INV-0041" and "2026/RG/001") gets a range spanning both, which is
 * what the portal expects when one series is declared.
 */
function issuedNumbers(active: string[], cancelled: Gstr1Transaction[]): string[] {
  const cancelledNos = cancelled
    .map(t => t.invoiceNo)
    .filter((n): n is string => !!n && n.trim().length > 0)
  return [...active, ...cancelledNos].sort()
}

function rangeFrom(active: string[], cancelled: Gstr1Transaction[]): string {
  return issuedNumbers(active, cancelled)[0] || ''
}

function rangeTo(active: string[], cancelled: Gstr1Transaction[]): string {
  const all = issuedNumbers(active, cancelled)
  return all.length > 0 ? all[all.length - 1] : ''
}

/**
 * Build DOC section: document issuance summary.
 * Counts invoices and credit notes issued, including cancelled ones.
 *
 * 🔒 V26 BUG-056: Was using `t.invoiceNo || t.id` as the document number
 * fallback. When a sale has no user-provided invoiceNo, `t.id` is a CUID
 * (~25 chars). The GST portal's doc_issue schema requires `from` and `to`
 * to be ≤ 16 characters. The CUID fallback produced a 25-char string that
 * the portal rejects with "Documents Sr. No. 'to' exceeds 16 characters."
 *
 * Fix: only include NUMBERED invoices in the from/to range. Unnumbered
 * invoices are still counted in `totnum` (the portal expects the total
 * count), but they don't appear in the from/to range. This matches the
 * portal's intent: from/to is the range of NUMBERED documents.
 */
export function buildDOC(
  txns: Gstr1Transaction[],
  cancelled: Gstr1Transaction[] = [],
): { doc_det: Gstr1DocEntry[] } {
  const sales = txns.filter(t => t.type === 'sale')
  const creditNotes = txns.filter(t => t.type === 'credit-note')
  const cancelledSales = cancelled.filter(t => t.type === 'sale')
  const cancelledCNs = cancelled.filter(t => t.type === 'credit-note')

  const doc_det: Gstr1DocEntry[] = []

  if (sales.length > 0) {
    // 🔒 V26 BUG-056: Only use sales with a real invoiceNo for from/to.
    // Unnumbered sales are still counted in totnum but excluded from the range.
    const numberedSales = sales.filter(t => t.invoiceNo && t.invoiceNo.trim().length > 0)
    const invoiceNos = numberedSales.map(t => t.invoiceNo!).sort()
    doc_det.push({
      doc_num: 1,
      doc_typ: 'Invoices for outward supply',
      docs: [{
        num: 1,
        from: rangeFrom(invoiceNos, cancelledSales),
        to: rangeTo(invoiceNos, cancelledSales),
        // Table 13 counts documents ISSUED, which includes ones later
        // cancelled — a cancelled number was still consumed from the series.
        totnum: sales.length + cancelledSales.length,
        cancel: cancelledSales.length,
        net_issue: sales.length,
      }],
    })
  }

  if (creditNotes.length > 0) {
    // 🔒 V26 BUG-056: Same fix for credit notes — only numbered ones for from/to.
    const numberedCNs = creditNotes.filter(t => t.invoiceNo && t.invoiceNo.trim().length > 0)
    const cnNos = numberedCNs.map(t => t.invoiceNo!).sort()
    doc_det.push({
      doc_num: 2,
      doc_typ: 'Credit Notes',
      docs: [{
        num: 1,
        from: rangeFrom(cnNos, cancelledCNs),
        to: rangeTo(cnNos, cancelledCNs),
        totnum: creditNotes.length + cancelledCNs.length,
        cancel: cancelledCNs.length,
        net_issue: creditNotes.length,
      }],
    })
  }

  return { doc_det }
}

/**
 * 🔒 V26 N9: Compute net outward-supply turnover from a set of transactions.
 *
 * Used for the GSTR-1 `gt` (prior-FY turnover) and `cur_gt` (current-period
 * turnover) fields, which were hardcoded 0 before N9. The portal treats these
 * as informational (non-blocking), but a world-class filing export populates
 * them.
 *
 * Turnover = value of all outward supplies (net of returns):
 *   Σ(sale taxable) − Σ(credit-note taxable) + Σ(debit-note taxable)
 *
 * where taxable = subtotal − discountAmount. Income/expense are NOT part of
 * outward supply for GST turnover purposes (income is non-supply income;
 * expense is non-supply expense).
 *
 * Pure function — fully testable without DB.
 *
 * @param txns  transactions to aggregate (any period)
 * @returns     net outward turnover in rupees
 */
export function computeOutwardTurnover(txns: Gstr1Transaction[]): number {
  let turnover = 0
  for (const t of txns) {
    const taxable = roundMoney(t.subtotal - (t.discountAmount || 0))
    if (t.type === 'sale') {
      turnover = roundMoney(turnover + taxable)
    } else if (t.type === 'credit-note') {
      // Credit notes reduce outward supply (sales return)
      turnover = roundMoney(turnover - taxable)
    } else if (t.type === 'debit-note') {
      // Debit notes increase outward supply (additional consideration)
      turnover = roundMoney(turnover + taxable)
    }
    // income / expense / estimate: not part of GST outward turnover
  }
  return turnover
}

/**
 * Build the complete GSTR-1 JSON structure from all transactions.
 * This is the main entry point — the API route calls this.
 *
 * 🔒 V26 N9: `cur_gt` (current-period turnover) is now computed from `txns`
 * via computeOutwardTurnover. `gt` (prior-FY turnover) requires data outside
 * the current period, so the caller passes it via `options.priorFyTurnover`.
 * When omitted, `gt` defaults to 0 (preserving pre-N9 behavior for callers
 * that don't have prior-FY data handy — e.g. tests).
 *
 * @param txns        transactions for the filing period (1 month)
 * @param shop        shop info (GSTIN, state)
 * @param monthYear   filing period string (MMYYYY, e.g. "072026")
 * @param options     optional: { priorFyTurnover?: number } — prior-FY outward
 *                    turnover in rupees, fetched by the caller via a separate
 *                    DB query against the prior financial year
 */
export function buildGstr1(
  txns: Gstr1Transaction[],
  shop: ShopInfo,
  monthYear: string,
  options?: {
    priorFyTurnover?: number
    cancelled?: Gstr1Transaction[]
    /*
     * The two advance windows, kept apart on purpose. They are different sets
     * of receipts answering different questions, and passing one list for both
     * would double-declare — see buildAT / buildTXPD.
     */
    advancesReceivedThisPeriod?: AdvanceReceipt[]
    advancesFromEarlierPeriods?: AdvanceReceipt[]
    /** Table 9A, computed by the caller — it needs the filed snapshots. */
    amendments?: { b2ba: Array<{ ctin: string; inv: unknown[] }>; b2cla: Array<{ pos: string; inv: unknown[] }> }
  },
): Gstr1Result {
  // 🔒 V26 N9: cur_gt = current-period outward turnover (computed from txns).
  // gt = prior-FY outward turnover (passed by caller; defaults to 0).
  const cur_gt = computeOutwardTurnover(txns)
  const gt = options?.priorFyTurnover ?? 0

  return {
    gstin: shop.gstin || '',
    fp: monthYear,
    gt: roundMoney(gt),
    cur_gt: roundMoney(cur_gt),
    b2b: buildB2B(txns, shop),
    b2cl: buildB2CL(txns, shop),
    b2cs: buildB2CS(txns, shop),
    cdnr: buildCDNR(txns, shop),
    cdnur: buildCDNUR(txns, shop),
    hsn: buildHSN(txns),
    nil: buildNIL(txns),
    doc_issue: buildDOC(txns, options?.cancelled || []),
    b2ba: options?.amendments?.b2ba || [],
    b2cla: options?.amendments?.b2cla || [],
    at: buildAT(options?.advancesReceivedThisPeriod || []),
    txpd: buildTXPD(options?.advancesFromEarlierPeriods || []),
  }
}
