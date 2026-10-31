/**
 * 🔒 GUARD (Phase 8c, #340 #341): every row the app writes into GSTR-1 has the
 * fields GSTN's upload requires, and no field it forbids.
 *
 * The sets below are GSTN's "Save GSTR1" schema v5.0 (23 Feb 2026; v4.1 the
 * same for these), read field by field on 31 Oct 2026 — the rate-row variant of
 * each table. Every one of these tables is `additionalProperties: false`, so
 * one stray field rejects the whole file.
 *
 * Why this exists: reading the schema found four tables the app could not
 * upload, each green in its own unit tests — B2CS without `sply_ty` (the table
 * nearly every shop uses), CDNR with `typ` where `inv_typ` is required, CDNUR
 * with a forbidden `rchrg`, and every amendment row (no items, wrong keys, an
 * extra `changes`). Tests that check values never check the shape.
 */
import { buildGstr1, documentRow, type Gstr1Transaction, type Gstr1Item, type ShopInfo } from '@/lib/gstr1-builder'
import { buildCorrections, filedVersionsFrom, latestVersions, amendmentTables, type CurrentDoc } from '@/lib/gstr1-amendments'

const SCHEMA: Record<string, { required: string[]; allowed: string[]; itmDet?: string[] }> = {
  b2b: { required: ['inum', 'idt', 'val', 'rchrg', 'inv_typ', 'itms', 'pos'], allowed: ['flag', 'inum', 'idt', 'val', 'pos', 'diff_percent', 'rchrg', 'inv_typ', 'irngendate', 'irn', 'srctyp', 'itms', 'sez_auth'], itmDet: ['txval', 'rt', 'iamt', 'camt', 'samt', 'csamt'] },
  b2cl: { required: ['inum', 'idt', 'val', 'itms'], allowed: ['flag', 'inum', 'idt', 'val', 'diff_percent', 'itms'], itmDet: ['rt', 'txval', 'iamt', 'csamt'] },
  b2cs: { required: ['rt', 'sply_ty', 'typ', 'txval', 'pos'], allowed: ['typ', 'sply_ty', 'rt', 'flag', 'pos', 'diff_percent', 'txval', 'iamt', 'camt', 'samt', 'csamt'] },
  cdnr: { required: ['val', 'nt_dt', 'nt_num', 'ntty', 'itms', 'pos', 'rchrg', 'inv_typ'], allowed: ['flag', 'val', 'ntty', 'nt_num', 'nt_dt', 'diff_percent', 'pos', 'rchrg', 'inv_typ', 'irngendate', 'irn', 'srctyp', 'itms', 'sez_auth', 'eco_typ', 'estin'] },
  cdnur: { required: ['val', 'nt_dt', 'nt_num', 'ntty', 'typ', 'itms'], allowed: ['typ', 'flag', 'pos', 'val', 'ntty', 'nt_num', 'nt_dt', 'diff_percent', 'irngendate', 'irn', 'srctyp', 'itms'] },
  b2ba: { required: ['inum', 'idt', 'oinum', 'oidt', 'val', 'rchrg', 'inv_typ', 'itms', 'pos'], allowed: ['flag', 'inum', 'idt', 'oinum', 'oidt', 'val', 'pos', 'diff_percent', 'rchrg', 'inv_typ', 'itms', 'sez_auth'], itmDet: ['txval', 'rt', 'iamt', 'camt', 'samt', 'csamt'] },
  b2cla: { required: ['inum', 'idt', 'oinum', 'oidt', 'val', 'itms'], allowed: ['flag', 'inum', 'idt', 'oinum', 'oidt', 'val', 'diff_percent', 'itms'], itmDet: ['rt', 'txval', 'iamt', 'csamt'] },
  cdnra: { required: ['val', 'nt_dt', 'nt_num', 'ont_num', 'ont_dt', 'ntty', 'itms', 'pos', 'rchrg', 'inv_typ'], allowed: ['flag', 'pos', 'rchrg', 'inv_typ', 'val', 'ntty', 'nt_num', 'nt_dt', 'ont_num', 'ont_dt', 'diff_percent', 'itms', 'sez_auth', 'eco_typ', 'estin'] },
  cdnura: { required: ['val', 'nt_dt', 'nt_num', 'ont_num', 'ont_dt', 'ntty', 'typ', 'itms'], allowed: ['typ', 'flag', 'pos', 'val', 'ntty', 'nt_num', 'nt_dt', 'ont_num', 'ont_dt', 'diff_percent', 'itms'] },
}

/** The schema rule as a function, so it can be watched failing on a bad row (CLAUDE.md, Cause 7). */
export function rowProblems(table: string, row: Record<string, any>): string[] {
  const s = SCHEMA[table]
  const p: string[] = []
  for (const k of s.required) if (row[k] === undefined || row[k] === null) p.push(`${table}: missing ${k}`)
  for (const k of Object.keys(row)) if (!s.allowed.includes(k)) p.push(`${table}: forbidden ${k}`)
  if (s.itmDet) for (const it of row.itms || []) for (const k of Object.keys(it.itm_det || {})) if (!s.itmDet.includes(k)) p.push(`${table}: itm_det forbidden ${k}`)
  return p
}

const SHOP: ShopInfo = { gstin: '08ABCDE1234F1Z5', state: 'Rajasthan', stateCode: '08' }
const REG = '08AAAPL1234C1Z5'
const line = (over: Partial<Gstr1Item> = {}): Gstr1Item => ({ productId: 'a', productName: 'Atta', hsn: '1101', quantity: 10, unit: 'pcs', unitPrice: 50, gstRate: 5, discountAmount: 0, cgst: 12.5, sgst: 12.5, igst: 0, csamt: 0, ...over })
let n = 0
const doc = (over: Partial<Gstr1Transaction>): Gstr1Transaction => ({
  id: `t${++n}`, type: 'sale', invoiceNo: `INV-${n}`, date: new Date('2026-08-10T06:30:00Z'),
  totalAmount: 525, subtotal: 500, discountAmount: 0, cgst: 12.5, sgst: 12.5, igst: 0, isInterState: false, isReverseCharge: false,
  partyId: null, partyName: null, partyGstin: null, partyState: 'Rajasthan', items: [line()], ...over,
})
const interLine = line({ cgst: 0, sgst: 0, igst: 25 })
const DOCS: Gstr1Transaction[] = [
  doc({ partyGstin: REG }),                                                                          // b2b
  doc({}),                                                                                           // b2cs INTRA
  doc({ isInterState: true, cgst: 0, sgst: 0, igst: 25, deliveryState: 'Maharashtra', items: [interLine] }),   // b2cs INTER (small)
  doc({ isInterState: true, totalAmount: 150000, subtotal: 142857.14, cgst: 0, sgst: 0, igst: 7142.86, deliveryState: 'Maharashtra', items: [line({ quantity: 1, unitPrice: 142857.14, cgst: 0, sgst: 0, igst: 7142.86 })] }), // b2cl
  doc({ type: 'credit-note', invoiceNo: 'CN-1', partyGstin: REG, totalAmount: 105, subtotal: 100, items: [line({ quantity: 2, cgst: 2.5, sgst: 2.5 })] }), // cdnr
]
// An unregistered note against the large inter-state sale → cdnur.
DOCS.push(doc({ type: 'credit-note', invoiceNo: 'CN-2', isInterState: true, totalAmount: 1050, subtotal: 1000, cgst: 0, sgst: 0, igst: 50, deliveryState: 'Maharashtra', originalTransactionId: DOCS[3].id, items: [line({ quantity: 1, unitPrice: 1000, cgst: 0, sgst: 0, igst: 50 })] }))

describe('the schema check itself fails on bad rows (it can catch what it guards)', () => {
  test.each([
    ['b2cs', { typ: 'OE', pos: '08', rt: 5, txval: 1 }, 'b2cs: missing sply_ty'],
    ['cdnr', { nt_num: 'CN-1', nt_dt: '01-08-2026', ntty: 'C', val: 1, pos: '08', rchrg: 'N', typ: 'R', itms: [] }, 'cdnr: forbidden typ'],
    ['cdnur', { typ: 'B2CL', nt_num: 'CN-2', nt_dt: '01-08-2026', ntty: 'C', val: 1, pos: '27', rchrg: 'N', itms: [] }, 'cdnur: forbidden rchrg'],
    ['b2ba', { oinum: 'X', oidt: '01-08-2026', inum: 'X', idt: '01-08-2026', val: 1, pos: '08', changes: ['x'] }, 'b2ba: forbidden changes'],
  ])('%s', (table, row, expected) => {
    expect(rowProblems(table, row)).toContain(expected)
  })
})

describe('every row of every table the app writes', () => {
  const g = buildGstr1(DOCS, SHOP, '082026', { originalInvoices: new Map([[DOCS[3].id, { isInterState: true, totalAmount: 150000 }]]) })
  const rows: Array<[string, Record<string, any>]> = [
    ...g.b2b.flatMap((p) => p.inv.map((r) => ['b2b', r] as [string, any])),
    ...g.b2cl.flatMap((p) => p.inv.map((r) => ['b2cl', r] as [string, any])),
    ...g.b2cs.map((r) => ['b2cs', r] as [string, any]),
    ...g.cdnr.flatMap((p) => p.nt.map((r) => ['cdnr', r] as [string, any])),
    ...g.cdnur.map((r) => ['cdnur', r] as [string, any]),
  ]

  test('the fixture reaches every original table (else the check passes on nothing)', () => {
    expect([...new Set(rows.map(([t]) => t))].sort()).toEqual(['b2b', 'b2cl', 'b2cs', 'cdnr', 'cdnur'])
  })
  test('no row is missing a required field or carries a forbidden one', () => {
    expect(rows.flatMap(([t, r]) => rowProblems(t, r))).toEqual([])
  })
  test('B2CS says INTRA inside the shop\'s state and INTER outside it', () => {
    expect(g.b2cs.map((r) => [r.pos, r.sply_ty]).sort()).toEqual([['08', 'INTRA'], ['27', 'INTER']])
  })

  test('every amendment table, built from these documents edited after filing', () => {
    const filedJson: any = { b2b: g.b2b, b2cl: g.b2cl, cdnr: g.cdnr, cdnur: g.cdnur }
    const latest = latestVersions(filedVersionsFrom(filedJson, '082026'))
    const originals = new Map([[DOCS[3].id, { isInterState: true, totalAmount: 150000 }]])
    const current = new Map<string, CurrentDoc>(DOCS.map((d) => {
      const edited = { ...d, totalAmount: d.totalAmount + 10 }
      return [String(d.invoiceNo), { exists: true, placed: documentRow(edited, SHOP, originals) }]
    }))
    const t = amendmentTables(buildCorrections(latest, current))
    const amended: Array<[string, Record<string, any>]> = [
      ...t.b2ba.flatMap((p) => p.inv.map((r) => ['b2ba', r] as [string, any])),
      ...t.b2cla.flatMap((p) => p.inv.map((r) => ['b2cla', r] as [string, any])),
      ...t.cdnra.flatMap((p) => p.nt.map((r) => ['cdnra', r] as [string, any])),
      ...t.cdnura.map((r) => ['cdnura', r] as [string, any]),
    ]
    expect([...new Set(amended.map(([x]) => x))].sort()).toEqual(['b2ba', 'b2cla', 'cdnra', 'cdnura'])
    expect(amended.flatMap(([x, r]) => rowProblems(x, r))).toEqual([])
  })
})
