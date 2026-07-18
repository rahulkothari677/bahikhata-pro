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
  sply_ty: 'NIL' | 'EXPT' | 'NGST'
  description: string
  txval: number
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
  // 🔒 V26 N2: Notes whose original supply is B2CS — same criterion applied
  // to the note itself (the note inherits isInterState from the original).
  const b2csNotes = txns.filter(t =>
    (t.type === 'credit-note' || t.type === 'debit-note') &&
    (!t.partyGstin || t.partyGstin.length < 15) &&
    (!t.isInterState || t.totalAmount <= B2CL_INVOICE_VALUE_THRESHOLD)
  )

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
  const notes = txns.filter(t =>
    (t.type === 'credit-note' || t.type === 'debit-note') &&
    (!t.partyGstin || t.partyGstin.length < 15) &&
    t.isInterState &&
    t.totalAmount > B2CL_INVOICE_VALUE_THRESHOLD
  )
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
 * For now, nil-rated = items with gstRate=0 on non-RCM sales.
 * Exempt and non-GST are 0 until products have gstTreatment set.
 */
export function buildNIL(txns: Gstr1Transaction[]): { inv: Gstr1NilEntry[] } {
  const sales = txns.filter(t => t.type === 'sale' && !t.isReverseCharge)
  let nilValue = 0
  for (const txn of sales) {
    for (const item of txn.items) {
      if (item.gstRate === 0) {
        nilValue = roundMoney(nilValue + itemTaxable(item))
      }
    }
  }

  return {
    inv: [
      { sply_ty: 'NIL', description: 'Nil rated supplies', txval: nilValue },
      { sply_ty: 'EXPT', description: 'Exempted supplies', txval: 0 },
      { sply_ty: 'NGST', description: 'Non-GST supplies', txval: 0 },
    ],
  }
}

/**
 * Build DOC section: document issuance summary.
 * Counts invoices and credit notes issued (no cancellation tracking yet).
 */
export function buildDOC(txns: Gstr1Transaction[]): { doc_det: Gstr1DocEntry[] } {
  const sales = txns.filter(t => t.type === 'sale')
  const creditNotes = txns.filter(t => t.type === 'credit-note')

  const doc_det: Gstr1DocEntry[] = []

  if (sales.length > 0) {
    const invoiceNos = sales.map(t => t.invoiceNo || t.id).sort()
    doc_det.push({
      doc_num: 1,
      doc_typ: 'Invoices for outward supply',
      docs: [{
        num: 1,
        from: invoiceNos[0] || '',
        to: invoiceNos[invoiceNos.length - 1] || '',
        totnum: sales.length,
        cancel: 0,  // no cancellation tracking yet
        net_issue: sales.length,
      }],
    })
  }

  if (creditNotes.length > 0) {
    const cnNos = creditNotes.map(t => t.invoiceNo || t.id).sort()
    doc_det.push({
      doc_num: 2,
      doc_typ: 'Credit Notes',
      docs: [{
        num: 1,
        from: cnNos[0] || '',
        to: cnNos[cnNos.length - 1] || '',
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
