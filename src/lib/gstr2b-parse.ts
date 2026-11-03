/**
 * Read a GSTR-2B download into bill lines — the one parser (#353, 2 Nov 2026).
 *
 * THE BUG THIS REPLACES. The importer read each bill's money from
 * `itms[].itm_det.{txval, iamt, camt, samt}` — the GSTR-2A / GSTR-1 layout.
 * A real GSTR-2B puts it in `items[].{rt, txval, igst, cgst, sgst, cess}`
 * (GSTN GSTR-2B GET response, as published in the GSP API documentation).
 * On a genuine 2B neither `itms` nor the invoice-level fallbacks exist, so
 * every bill imported with taxable ₹0 and GST ₹0 — and GSTR-3B claims the
 * smaller of books and 2B, head by head (#116), so the shop would claim no
 * input credit at all. Reverse charge was read from `rchrg`; 2B calls it `rev`.
 *
 * WHAT IT READS, per bill in `docdata.b2b[].inv[]`:
 *   - money: `items` (2B), else `itms[].itm_det` (the older shape the tests
 *     carried), else fields on the bill itself (a flattened file);
 *   - `itcavl`: "N" means the portal says no input credit is available on
 *     this bill (with the reason code in `rsn`). Kept as itcAvailable=false so
 *     GSTR-3B never claims it; any other value (or none) is available.
 *   - `rev` / `rchrg`: reverse charge.
 *
 * 9a-1 (3 Nov 2026): also the other three sections a small shop's 2B carries —
 *   - `docdata.b2ba`  corrected bills, the original number in `oinum`;
 *   - `docdata.cdnr`  suppliers' credit / debit notes, under `nt[]` with
 *                     `ntnum` and `typ` "C" or "D";
 *   - `docdata.cdnra` corrected notes, the original number in `ontnum`.
 * Each line says what it is (docType) so a note is never matched as a bill.
 * Not read: `itcrev` (reversals), `isd`, `impg`, `ecom` — not a kirana's 2B.
 */
import { roundMoney as r2 } from '@/lib/money'

/** What a 2B line is: a supplier's bill, or a credit / debit note they issued to you. */
export type Gstr2bDocType = 'invoice' | 'credit-note' | 'debit-note'

export interface Gstr2bLine {
  docType: Gstr2bDocType
  /** For a corrected bill or note (b2ba / cdnra): the number it replaces. */
  originalNumber: string | null
  supplierGstin: string
  /** The bill's or note's number (inum / ntnum). */
  invoiceNumber: string
  invoiceDate: string | null
  taxableValue: number
  igst: number
  cgst: number
  sgst: number
  totalAmount: number
  isReverseCharge: boolean
  /** False when 2B marks the bill `itcavl: "N"` — no credit may be claimed on it. */
  itcAvailable: boolean
  /** 2B's reason code (`rsn`) when credit is not available, as the portal sent it. */
  itcReason: string | null
}

export interface Gstr2bFile {
  gstin: string | null
  period: string | null
  /** True when the file has any bill or note section (b2b, b2ba, cdnr, cdnra), even an empty one. */
  hasDocuments: boolean
  lines: Gstr2bLine[]
}

type Obj = Record<string, unknown>
const isObj = (v: unknown): v is Obj => !!v && typeof v === 'object' && !Array.isArray(v)
const num = (v: unknown) => Number(v) || 0

/** The bill's money, from whichever layout the file uses. */
function moneyOf(inv: Obj): { taxable: number; igst: number; cgst: number; sgst: number } {
  if (Array.isArray(inv.items) && inv.items.length) {
    const sum = (f: string) => (inv.items as unknown[]).reduce<number>((s, it) => s + (isObj(it) ? num(it[f]) : 0), 0)
    return { taxable: sum('txval'), igst: sum('igst'), cgst: sum('cgst'), sgst: sum('sgst') }
  }
  if (Array.isArray(inv.itms) && inv.itms.length) {
    const sum = (f: string) => (inv.itms as unknown[]).reduce<number>((s, it) => s + (isObj(it) && isObj(it.itm_det) ? num(it.itm_det[f]) : 0), 0)
    return { taxable: sum('txval'), igst: sum('iamt'), cgst: sum('camt'), sgst: sum('samt') }
  }
  return {
    taxable: num(inv.txval),
    igst: num(inv.igst ?? inv.iamt),
    cgst: num(inv.cgst ?? inv.camt),
    sgst: num(inv.sgst ?? inv.samt),
  }
}

/** One document (a bill under `inv`, a note under `nt`) into a line. */
function lineOf(sup: Obj, doc: Obj, docType: Gstr2bDocType, originalNumber: unknown): Gstr2bLine {
  const m = moneyOf(doc)
  const itcavl = String(doc.itcavl ?? '').toUpperCase()
  return {
    docType,
    originalNumber: originalNumber != null && originalNumber !== '' ? String(originalNumber) : null,
    supplierGstin: String(sup.ctin).toUpperCase(),
    invoiceNumber: String(doc.inum ?? doc.ntnum ?? doc.inum_inv ?? 'UNKNOWN'),
    invoiceDate: (doc.dt ?? doc.idt ?? null) as string | null,
    taxableValue: r2(m.taxable),
    igst: r2(m.igst),
    cgst: r2(m.cgst),
    sgst: r2(m.sgst),
    totalAmount: r2(num(doc.val) || num(doc.itcval)),
    isReverseCharge: String(doc.rev ?? doc.rchrg ?? doc.rchrgitc ?? 'N').toUpperCase() === 'Y',
    itcAvailable: itcavl !== 'N',
    itcReason: itcavl === 'N' && doc.rsn != null ? String(doc.rsn) : null,
  }
}

/** Every document of one section: suppliers (`ctin`) each holding `inv` or `nt`. */
function sectionLines(section: unknown, list: 'inv' | 'nt', amended: boolean): Gstr2bLine[] {
  const out: Gstr2bLine[] = []
  for (const sup of Array.isArray(section) ? section : []) {
    if (!isObj(sup) || !sup.ctin) continue
    for (const doc of Array.isArray(sup[list]) ? sup[list] : []) {
      if (!isObj(doc)) continue
      const docType: Gstr2bDocType = list === 'inv' ? 'invoice'
        : String(doc.typ ?? doc.ntty ?? 'C').toUpperCase() === 'D' ? 'debit-note' : 'credit-note'
      out.push(lineOf(sup, doc, docType, amended ? (list === 'inv' ? doc.oinum : doc.ontnum) : null))
    }
  }
  return out
}

export function parseGstr2b(file: unknown): Gstr2bFile {
  const top = isObj(file) ? file : {}
  // The portal nests the payload: { chksum, data: { gstin, rtnprd, docdata: { b2b } } }.
  const root = isObj(top.data) ? top.data : top
  const docdata = isObj(root.docdata) ? root.docdata : root
  const lines: Gstr2bLine[] = [
    ...sectionLines(docdata.b2b, 'inv', false),
    ...sectionLines(docdata.b2ba, 'inv', true),
    ...sectionLines(docdata.cdnr, 'nt', false),
    ...sectionLines(docdata.cdnra, 'nt', true),
  ]
  return {
    gstin: root.gstin ? String(root.gstin) : null,
    period: (root.rtnprd ?? root.fp ?? null) as string | null,
    hasDocuments: ['b2b', 'b2ba', 'cdnr', 'cdnra'].some((k) => Array.isArray(docdata[k])),
    lines,
  }
}
