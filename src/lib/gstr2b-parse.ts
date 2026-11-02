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
 * Credit notes (`docdata.cdnr`) are left to Phase 9a.
 */
import { roundMoney as r2 } from '@/lib/money'

export interface Gstr2bLine {
  supplierGstin: string
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
  /** True when the file has a `b2b` section at all (even an empty one). */
  hasB2b: boolean
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

export function parseGstr2b(file: unknown): Gstr2bFile {
  const top = isObj(file) ? file : {}
  // The portal nests the payload: { chksum, data: { gstin, rtnprd, docdata: { b2b } } }.
  const root = isObj(top.data) ? top.data : top
  const docdata = isObj(root.docdata) ? root.docdata : root
  const b2b = Array.isArray(docdata.b2b) ? docdata.b2b : null
  const lines: Gstr2bLine[] = []
  for (const sup of b2b ?? []) {
    if (!isObj(sup) || !sup.ctin) continue
    for (const inv of Array.isArray(sup.inv) ? sup.inv : []) {
      if (!isObj(inv)) continue
      const m = moneyOf(inv)
      const itcavl = String(inv.itcavl ?? '').toUpperCase()
      lines.push({
        supplierGstin: String(sup.ctin).toUpperCase(),
        invoiceNumber: String(inv.inum ?? inv.inum_inv ?? 'UNKNOWN'),
        invoiceDate: (inv.dt ?? inv.idt ?? null) as string | null,
        taxableValue: r2(m.taxable),
        igst: r2(m.igst),
        cgst: r2(m.cgst),
        sgst: r2(m.sgst),
        totalAmount: r2(num(inv.val) || num(inv.itcval)),
        isReverseCharge: String(inv.rev ?? inv.rchrg ?? inv.rchrgitc ?? 'N').toUpperCase() === 'Y',
        itcAvailable: itcavl !== 'N',
        itcReason: itcavl === 'N' && inv.rsn != null ? String(inv.rsn) : null,
      })
    }
  }
  return {
    gstin: root.gstin ? String(root.gstin) : null,
    period: (root.rtnprd ?? root.fp ?? null) as string | null,
    hasB2b: !!b2b,
    lines,
  }
}
