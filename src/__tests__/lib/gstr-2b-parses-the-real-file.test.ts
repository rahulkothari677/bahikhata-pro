/**
 * The 2B importer must read the file the portal actually gives you.
 *
 * 9 Aug 2026: the parser was written against a flat shape the portal does not
 * produce, so a real file was rejected, and one that imported read ₹0.
 *
 * #353 (2 Nov 2026): the 9 Aug fix read the money from `itms[].itm_det` — the
 * GSTR-2A / GSTR-1 layout — and this test checked a COPY of that extraction
 * ("kept in step with the route"), so it pinned the wrong shape. A real
 * GSTR-2B carries `items[].{rt, txval, igst, cgst, sgst, cess}` (GSTN GSTR-2B
 * GET response as published in GSP API docs) and `rev` for reverse charge, so
 * every real bill imported at ₹0 tax and GSTR-3B (which claims the smaller of
 * books and 2B, #116) would have claimed no credit at all.
 *
 * Now the route and this test call the same parser (lib/gstr2b-parse.ts).
 */
import fs from 'node:fs'
import path from 'node:path'
import { parseGstr2b } from '@/lib/gstr2b-parse'

/** One bill exactly as the GSTR-2B GET response lays it out (keys as published). */
const TWO_B_BILL = {
  inum: 'S008400', typ: 'R', dt: '24-11-2026', val: 11800, pos: '27', rev: 'N',
  itcavl: 'Y', rsn: '', diffprcnt: 1, srctyp: 'e-Invoice', irn: 'abc', irngendate: '24-11-2026',
  items: [{ num: 1, rt: 18, txval: 10000, igst: 0, cgst: 900, sgst: 900, cess: 0 }],
}
const portal = (inv: object[], extra: object = {}) => ({
  chksum: 'abc',
  data: { gstin: '27ABCDE1234F1Z5', rtnprd: '112026', version: '1.0', gendt: '14-12-2026', ...extra, docdata: { b2b: [{ ctin: '29bbbbb1111b1z2', trdnm: 'Supplier', supfildt: '11-12-2026', supprd: '112026', inv }] } },
})

describe('a genuine GSTR-2B download (#353)', () => {
  it('reads the GSTIN, the period and the money from `items`', () => {
    const r = parseGstr2b(portal([TWO_B_BILL]))
    expect(r.gstin).toBe('27ABCDE1234F1Z5')
    expect(r.period).toBe('112026')
    expect(r.lines).toEqual([{
      supplierGstin: '29BBBBB1111B1Z2', invoiceNumber: 'S008400', invoiceDate: '24-11-2026',
      taxableValue: 10000, igst: 0, cgst: 900, sgst: 900, totalAmount: 11800,
      isReverseCharge: false, itcAvailable: true, itcReason: null,
    }])
  })

  it('adds every rate line of one bill', () => {
    const mixed = { ...TWO_B_BILL, val: 12650, items: [
      { num: 1, rt: 18, txval: 10000, igst: 0, cgst: 900, sgst: 900, cess: 0 },
      { num: 2, rt: 5, txval: 1000, igst: 0, cgst: 25, sgst: 25, cess: 0 },
    ] }
    const [l] = parseGstr2b(portal([mixed])).lines
    expect([l.taxableValue, l.cgst, l.sgst]).toEqual([11000, 925, 925])
  })

  it('an inter-state bill carries IGST', () => {
    const inter = { ...TWO_B_BILL, items: [{ num: 1, rt: 18, txval: 10000, igst: 1800, cgst: 0, sgst: 0, cess: 0 }] }
    expect(parseGstr2b(portal([inter])).lines[0].igst).toBe(1800)
  })

  it('reverse charge comes from `rev`', () => {
    expect(parseGstr2b(portal([{ ...TWO_B_BILL, rev: 'Y' }])).lines[0].isReverseCharge).toBe(true)
  })

  it('a bill 2B marks itcavl "N" is kept, with its reason, as credit NOT available', () => {
    const [l] = parseGstr2b(portal([{ ...TWO_B_BILL, itcavl: 'N', rsn: 'P' }])).lines
    expect([l.itcAvailable, l.itcReason]).toEqual([false, 'P'])
  })
})

describe('the older shapes still read', () => {
  const OLD = { inum: 'SUP-11', idt: '05-08-2026', val: 11800, rchrg: 'N', itms: [{ num: 1, itm_det: { rt: 18, txval: 10000, iamt: 0, camt: 900, samt: 900 } }] }

  it('itms / itm_det', () => {
    const [l] = parseGstr2b({ data: { gstin: 'G', rtnprd: '082026', docdata: { b2b: [{ ctin: 'C', inv: [OLD] }] } } }).lines
    expect([l.taxableValue, l.cgst, l.sgst, l.invoiceDate]).toEqual([10000, 900, 900, '05-08-2026'])
  })

  it('a flattened file with amounts on the bill', () => {
    const [l] = parseGstr2b({ gstin: 'G', b2b: [{ ctin: 'C', inv: [{ inum: 'X', txval: 500, cgst: 45, sgst: 45 }] }] }).lines
    expect([l.taxableValue, l.cgst]).toEqual([500, 45])
  })

  it('no b2b section is reported, so the route can refuse it', () => {
    expect(parseGstr2b({ data: { gstin: 'G', docdata: {} } }).hasB2b).toBe(false)
  })
})

describe('one parser', () => {
  it('the import route uses lib/gstr2b-parse and reads no bill field itself', () => {
    const route = fs.readFileSync(path.join(process.cwd(), 'src/app/api/gstr-2b/import/route.ts'), 'utf8')
    expect(route).toMatch(/parseGstr2b\(/)
    expect(route).not.toMatch(/itm_det|\.itms\b|inv\.rchrg|inv\.inum/)
  })

  it('GSTR-3B claims only bills 2B says carry credit', () => {
    const route = fs.readFileSync(path.join(process.cwd(), 'src/app/api/gstr-3b/route.ts'), 'utf8')
    const call = route.slice(route.indexOf('claimForPeriod('), route.indexOf('claimForPeriod(') + 600)
    expect(call).toMatch(/claimForPeriod\(/)
    expect(call).toMatch(/gstr2b\.invoices\.filter\(\(i\) => i\.itcAvailable\)/)
  })
})
