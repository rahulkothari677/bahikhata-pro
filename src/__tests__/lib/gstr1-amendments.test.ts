/**
 * Correcting a document after its GSTR-1 was filed — Tables 9A / 9C.
 *
 * Rewritten in Phase 8c (31 Oct 2026) for #103 (nothing goes in without a
 * switch), #104 (compare with the LAST filed version) and #340 (rows the
 * portal accepts: GSTN Save GSTR1 v4.1/v5.0, additionalProperties: false).
 * Every intent of the first version's tests is kept below.
 */
import {
  buildCorrections, filedVersionsFrom, latestVersions, amendmentTables, includedCorrections, amendmentRowProblems, fingerprint,
  type CurrentDoc, type LatestVersion,
} from '@/lib/gstr1-amendments'
import { documentRow, type Gstr1Transaction, type ShopInfo } from '@/lib/gstr1-builder'

const SHOP: ShopInfo = { gstin: '08ABCDE1234F1Z5', state: 'Rajasthan', stateCode: '08' }
const BUYER = '08AAAPL1234C1Z5'
const OTHER = '27AAAPL9999C1Z1'

function sale(over: Partial<Gstr1Transaction> = {}, qty = 10): Gstr1Transaction {
  return {
    id: 's1', type: 'sale', invoiceNo: 'INV-0003', date: new Date('2026-08-10T06:30:00Z'),
    totalAmount: 525, subtotal: 500, discountAmount: 0, cgst: 12.5, sgst: 12.5, igst: 0,
    isInterState: false, isReverseCharge: false,
    partyId: 'p', partyName: 'Rahul Traders', partyGstin: BUYER, partyState: 'Rajasthan',
    items: [{ productId: 'a', productName: 'Atta', hsn: '1101', quantity: qty, unit: 'pcs', unitPrice: 50, gstRate: 5, discountAmount: 0, cgst: 12.5, sgst: 12.5, igst: 0, csamt: 0 }],
    ...over,
  }
}

/** A filed GSTR-1 holding `docs`, as the route stores it. */
function filedReturn(docs: Gstr1Transaction[], extra: Record<string, unknown> = {}) {
  const g: any = { b2b: [], b2cl: [], cdnr: [], cdnur: [], ...extra }
  for (const d of docs) {
    const p = documentRow(d, SHOP)!
    const table = g[p.section]
    if (p.section === 'cdnur') table.push(p.row)
    else {
      const key = p.section === 'b2cl' ? 'pos' : 'ctin'
      const list = p.section === 'cdnr' ? 'nt' : 'inv'
      let grp = table.find((x: any) => x[key] === p.group)
      if (!grp) table.push((grp = { [key]: p.group, [list]: [] }))
      grp[list].push(p.row)
    }
  }
  return g
}
const now = (t: Gstr1Transaction | null): CurrentDoc => (t ? { exists: true, placed: documentRow(t, SHOP) } : { exists: false, placed: null })
const run = (filed: LatestVersion[], docs: Record<string, Gstr1Transaction | null>) =>
  buildCorrections(filed, new Map(Object.entries(docs).map(([k, t]) => [k, now(t)])))

describe('nothing changed', () => {
  test('declares no correction when the document still matches', () => {
    const filed = latestVersions(filedVersionsFrom(filedReturn([sale()]), '082026'))
    expect(run(filed, { 'INV-0003': sale() })).toEqual([])
  })
  test('ignores sub-rupee drift', () => {
    const filed = latestVersions(filedVersionsFrom(filedReturn([sale()]), '082026'))
    expect(run(filed, { 'INV-0003': sale({ totalAmount: 525.4 }) })).toEqual([])
  })
})

describe('#340: a corrected B2B invoice, written as GSTN\'s Table 9A takes it', () => {
  const filed = latestVersions(filedVersionsFrom(filedReturn([sale()]), '082026'))
  const [c] = run(filed, { 'INV-0003': sale({ totalAmount: 1050, subtotal: 1000 }, 20) })

  test('the row has exactly the allowed fields — the original number and date, and the corrected items', () => {
    expect(Object.keys(c.row!).sort()).toEqual(['idt', 'inum', 'inv_typ', 'itms', 'oidt', 'oinum', 'pos', 'rchrg', 'val'])
    expect(c.row).toMatchObject({ oinum: 'INV-0003', oidt: '10-08-2026', inum: 'INV-0003', val: 1050, rchrg: 'N', inv_typ: 'R' })
    expect((c.row!.itms as any[])[0].itm_det).toEqual({ rt: 5, txval: 1000, iamt: 0, camt: 12.5, samt: 12.5, csamt: 0 })
    expect(amendmentRowProblems('b2b', c.row!)).toEqual([])
  })
  test('what changed is said in words — on the screen, never in the file', () => {
    expect(c.changes).toEqual(['Value changed from ₹525 to ₹1050'])
    expect(JSON.stringify(c.row)).not.toContain('changed')
  })
  test('filed and now figures for the screen', () => {
    expect([c.filedVal, c.nowVal]).toEqual([525, 1050])
  })
})

describe('other changes are caught', () => {
  const filed = latestVersions(filedVersionsFrom(filedReturn([sale()]), '082026'))
  test('a changed date', () => {
    expect(run(filed, { 'INV-0003': sale({ date: new Date('2026-08-12T06:30:00Z') }) })[0].changes).toEqual(['Date changed from 10-08-2026 to 12-08-2026'])
  })
  test('a changed customer GSTIN — the credit went to the wrong buyer', () => {
    const [c] = run(filed, { 'INV-0003': sale({ partyGstin: '08AAAPL5555C1Z9' }) })
    expect(c.changes).toContain(`Customer GSTIN changed from ${BUYER} to 08AAAPL5555C1Z9`)
  })
  test('it is filed under the GSTIN it was ORIGINALLY declared against', () => {
    const [c] = run(filed, { 'INV-0003': sale({ partyGstin: '08AAAPL5555C1Z9' }) })
    expect(amendmentTables([c]).b2ba[0].ctin).toBe(BUYER)
  })
})

describe('a document cancelled after filing', () => {
  test('is declared at nil — the last filed row with every amount zero — never quietly dropped', () => {
    const filed = latestVersions(filedVersionsFrom(filedReturn([sale()]), '082026'))
    const [c] = run(filed, { 'INV-0003': null })
    expect(c.changes).toEqual(['This was cancelled after the return was filed'])
    expect(c.row).toMatchObject({ oinum: 'INV-0003', inum: 'INV-0003', val: 0 })
    expect((c.row!.itms as any[])[0].itm_det).toEqual({ rt: 5, txval: 0, iamt: 0, camt: 0, samt: 0, csamt: 0 })
    expect(amendmentRowProblems('b2b', c.row!)).toEqual([])
  })
})

describe('large inter-state B2C', () => {
  test('is grouped by place of supply, and the row carries no pos of its own (b2cla)', () => {
    const big = sale({ partyGstin: null, isInterState: true, totalAmount: 150000, subtotal: 142857.14, cgst: 0, sgst: 0, igst: 7142.86, deliveryState: 'Maharashtra' })
    big.items = [{ ...big.items[0], quantity: 1, unitPrice: 142857.14, cgst: 0, sgst: 0, igst: 7142.86 }]
    const filed = latestVersions(filedVersionsFrom(filedReturn([big]), '082026'))
    expect(filed[0].section).toBe('b2cl')
    const [c] = run(filed, { 'INV-0003': { ...big, totalAmount: 160000 } })
    const t = amendmentTables([c])
    expect(t.b2cla[0].pos).toBe('27')
    expect(Object.keys(c.row!).sort()).toEqual(['idt', 'inum', 'itms', 'oidt', 'oinum', 'val'])
  })
})

describe('credit notes amend into 9C, keyed as notes (#340)', () => {
  const note = (over: Partial<Gstr1Transaction> = {}) => sale({ id: 'n1', type: 'credit-note', invoiceNo: 'CN-0001', totalAmount: 105, subtotal: 100, cgst: 2.5, sgst: 2.5, items: [{ ...sale().items[0], quantity: 2, cgst: 2.5, sgst: 2.5 }], ...over })
  test('a registered buyer\'s note goes to cdnra with nt_num / ont_num — not invoice keys', () => {
    const filed = latestVersions(filedVersionsFrom(filedReturn([note()]), '082026'))
    const [c] = run(filed, { 'CN-0001': note({ totalAmount: 210, subtotal: 200 }) })
    expect(c.section).toBe('cdnr')
    expect(Object.keys(c.row!).sort()).toEqual(['inv_typ', 'itms', 'nt_dt', 'nt_num', 'ntty', 'ont_dt', 'ont_num', 'pos', 'rchrg', 'val'])
    expect(c.row).toMatchObject({ ont_num: 'CN-0001', nt_num: 'CN-0001', ntty: 'C' })
    expect(amendmentTables([c]).cdnra[0].ctin).toBe(BUYER)
  })
  test('stays silent when a note is unchanged', () => {
    const filed = latestVersions(filedVersionsFrom(filedReturn([note()]), '082026'))
    expect(run(filed, { 'CN-0001': note() })).toEqual([])
  })
})

describe('#104: compared with the LAST filed version, still naming the original', () => {
  // August filed INV-0003 at ₹525. September filed a correction to ₹1050.
  // Now it reads ₹1575: the change is from ₹1050 (not ₹525), and the portal key is still INV-0003 / 10-08-2026.
  const aug = filedVersionsFrom(filedReturn([sale()]), '082026')
  const corrected = documentRow(sale({ totalAmount: 1050, subtotal: 1000 }, 20), SHOP)!
  const sepJson = { b2ba: [{ ctin: BUYER, inv: [{ ...corrected.row, oinum: 'INV-0003', oidt: '10-08-2026' }] }] }
  const sep = filedVersionsFrom(sepJson, '092026')
  const latest = latestVersions([...sep, ...aug]) // order of reading must not matter

  test('one document, its September version, first filed in August', () => {
    expect(latest).toHaveLength(1)
    expect(latest[0]).toMatchObject({ key: 'b2b:INV-0003', fp: '092026', firstFp: '082026', val: 1050, original: { num: 'INV-0003', dt: '10-08-2026' } })
  })
  test('no correction when the books still match September\'s version', () => {
    expect(run(latest, { 'INV-0003': sale({ totalAmount: 1050, subtotal: 1000 }, 20) })).toEqual([])
  })
  test('a further edit is measured from September, keyed to August\'s original', () => {
    const [c] = run(latest, { 'INV-0003': sale({ totalAmount: 1575, subtotal: 1500 }, 30) })
    expect(c.changes).toEqual(['Value changed from ₹1050 to ₹1575'])
    expect(c.row).toMatchObject({ oinum: 'INV-0003', oidt: '10-08-2026', val: 1575 })
    expect([c.lastFp, c.firstFp]).toEqual(['092026', '082026'])
  })
})

describe('#103: nothing goes in until switched on, and an edit turns the switch off', () => {
  const filed = latestVersions(filedVersionsFrom(filedReturn([sale()]), '082026'))
  const [c1] = run(filed, { 'INV-0003': sale({ totalAmount: 1050, subtotal: 1000 }, 20) })
  test('not switched on → not in the return', () => {
    expect(includedCorrections([c1], null)).toEqual([])
    expect(includedCorrections([c1], {})).toEqual([])
  })
  test('switched on for this exact version → in', () => {
    expect(includedCorrections([c1], { [c1.key]: c1.fingerprint })).toEqual([c1])
  })
  test('the bill edited again after switching on → out, until confirmed again', () => {
    const [c2] = run(filed, { 'INV-0003': sale({ totalAmount: 1575, subtotal: 1500 }, 30) })
    expect(c2.fingerprint).not.toBe(c1.fingerprint)
    expect(includedCorrections([c2], { [c1.key]: c1.fingerprint })).toEqual([])
  })
  test('a correction the app cannot write is never included, even if switched on', () => {
    const blocked = { ...c1, row: null, problem: 'x' }
    expect(includedCorrections([blocked], { [c1.key]: c1.fingerprint })).toEqual([])
  })
  test('the fingerprint is stable: the same row twice gives the same print, key order aside', () => {
    expect(fingerprint({ a: 1, b: [2, { c: 3, d: 4 }] })).toBe(fingerprint({ b: [2, { d: 4, c: 3 }], a: 1 }))
  })
})

describe('what the app cannot correct on its own says so', () => {
  test('a document that moved to another table (GSTIN removed) gets a reason, not a row', () => {
    const filed = latestVersions(filedVersionsFrom(filedReturn([sale()]), '082026'))
    const [c] = run(filed, { 'INV-0003': sale({ partyGstin: null }) })
    expect(c.row).toBeNull()
    expect(c.problem).toMatch(/Ask your CA/)
  })
  test('a legacy filed row with no items (stored before 8c) cannot be re-declared — reason, no row', () => {
    const legacy = { b2ba: [{ ctin: BUYER, inv: [{ oinum: 'INV-0003', oidt: '10-08-2026', inum: 'INV-0003', idt: '10-08-2026', val: 525, pos: '08', changes: ['x'] }] }] }
    const latest = latestVersions(filedVersionsFrom(legacy, '092026'))
    const [c] = run(latest, { 'INV-0003': null })
    expect(c.row).toBeNull()
    expect(c.problem).toMatch(/older format/)
  })
})

describe('reading a filed return back', () => {
  test('survives a snapshot with no JSON', () => {
    expect(filedVersionsFrom(null, '082026')).toEqual([])
    expect(filedVersionsFrom('nonsense', '082026')).toEqual([])
  })
  test('reads originals and their amendments, each keyed by the original', () => {
    const v = filedVersionsFrom({ ...filedReturn([sale()]), b2ba: [{ ctin: OTHER, inv: [{ oinum: 'INV-0001', oidt: '01-07-2026', inum: 'INV-0001', idt: '01-07-2026', val: 10, pos: '08' }] }] }, '082026')
    expect(v.map((x) => `${x.section}:${x.original.num}`).sort()).toEqual(['b2b:INV-0001', 'b2b:INV-0003'])
  })
})
