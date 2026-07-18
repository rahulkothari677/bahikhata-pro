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
    const inv: Gstr1B2bInvoice = {
      inum: txn.invoiceNo || txn.id,
      idt: formatPortalDate(txn.date),
      val: roundMoney(txn.totalAmount),
      pos,
      rchrg: txn.isReverseCharge ? 'Y' : 'N',
      inv_typ: 'R',  // Regular (no export tracking)
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
    const inv = {
      inum: txn.invoiceNo || txn.id,
      idt: formatPortalDate(txn.date),
      val: roundMoney(txn.totalAmount),
      itms: txn.items.map((item, i) => ({
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
    for (const item of txn.items) addToAgg(item, pos, 1)
  }
  // 🔒 V26 N2: Subtract B2CS notes (credit notes reduce, debit notes increase)
  for (const txn of b2csNotes) {
    const pos = placeOfSupply(txn, shop)
    const sign: 1 | -1 = txn.type === 'credit-note' ? -1 : 1
    for (const item of txn.items) addToAgg(item, pos, sign)
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
      const hsn = item.hsn || '9999'  // default HSN for unclassified
      const key = `${hsn}|${item.gstRate}`
      const existing = agg.get(key) || {
        hsn, desc: item.productName, qty: 0, uqc: mapUnitToUqc(item.unit),
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
      // nil-rated = gstRate is 0 (0% GST but still a taxable supply)
      if (item.gstRate === 0) {
        buckets[sply_ty].nil_amt = roundMoney(buckets[sply_ty].nil_amt + taxable)
      }
      // expt_amt and ngsup_amt stay 0 — the app doesn't track gstTreatment
      // on items yet (Product.gstTreatment exists in the schema but isn't
      // passed to the builder). When it is, add:
      //   if (item.gstTreatment === 'exempt') buckets[sply_ty].expt_amt += taxable
      //   if (item.gstTreatment === 'nonGst') buckets[sply_ty].ngsup_amt += taxable
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
 * Build DOC section: document issuance summary.
 * Counts invoices and credit notes issued (no cancellation tracking yet).
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
export function buildDOC(txns: Gstr1Transaction[]): { doc_det: Gstr1DocEntry[] } {
  const sales = txns.filter(t => t.type === 'sale')
  const creditNotes = txns.filter(t => t.type === 'credit-note')

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
        from: invoiceNos[0] || '',
        to: invoiceNos.length > 0 ? invoiceNos[invoiceNos.length - 1] : '',
        totnum: sales.length,  // total count includes unnumbered
        cancel: 0,  // no cancellation tracking yet
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
        from: cnNos[0] || '',
        to: cnNos.length > 0 ? cnNos[cnNos.length - 1] : '',
        totnum: creditNotes.length,
        cancel: 0,
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
  options?: { priorFyTurnover?: number },
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
    doc_issue: buildDOC(txns),
  }
}
