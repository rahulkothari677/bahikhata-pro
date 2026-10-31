/**
 * #128 (Phase 8c) — GSTR-1 Table 12 in its two tabs, as GSTN's upload takes it.
 *
 * The rules below are GSTN's "Save GSTR1" schema, v4.1 (4 Feb 2025) and v5.0
 * (23 Feb 2026), read field by field on 31 Oct 2026 (identical for Table 12):
 *   hsn: { flag?, hsn_b2b: row[], hsn_b2c: row[] }   — no "data"; at least one tab
 *   row (rate rows): required num, hsn_sc, uqc, qty, txval, rt;
 *     optional desc, user_desc, iamt, camt, samt, csamt, flag, val (must be 0);
 *     no other key; num integer ≥ 1; hsn_sc ^[0-9]{2,8}$; uqc letters only, 1–30;
 *     amounts and qty multiples of 0.01; rt 0–999.99 in 0.01 steps.
 * Which tab a supply belongs in is the law report's table (GSTN Table 12
 * advisory, updated 25 Apr 2025): registered buyers B2B, everyone else B2C.
 */
import { readCode } from '@/test-support/read-source'
import { buildHSN, buildGstr1, isRegisteredBuyer, type Gstr1Transaction, type Gstr1Item, type ShopInfo } from '@/lib/gstr1-builder'

const SHOP: ShopInfo = { gstin: '27ABCDE1234F1Z5', state: 'Maharashtra', stateCode: '27' }
const REG = '27AAAPL1234C1Z5'

function item(over: Partial<Gstr1Item> = {}): Gstr1Item {
  return {
    productId: 'p1', productName: 'Rice 1kg', hsn: '1006', quantity: 10, unit: 'kg', unitPrice: 50, gstRate: 5,
    discountAmount: 0, cgst: 12.5, sgst: 12.5, igst: 0, csamt: 0, ...over,
  }
}
let n = 0
function doc(type: Gstr1Transaction['type'], gstin: string | null, items: Gstr1Item[]): Gstr1Transaction {
  n++
  return {
    id: `t${n}`, type, invoiceNo: `D-${n}`, date: new Date('2026-07-15'),
    totalAmount: 525, subtotal: 500, discountAmount: 0, cgst: 12.5, sgst: 12.5, igst: 0,
    isInterState: false, isReverseCharge: false,
    partyId: gstin ? 'p' : null, partyName: gstin ? 'Rahul Traders' : null, partyGstin: gstin, partyState: 'Maharashtra',
    items,
  }
}

/** GSTN's Table 12 row rules (rate-row variant), as a function that can be tested both ways. */
const REQUIRED = ['num', 'hsn_sc', 'uqc', 'qty', 'txval', 'rt']
const ALLOWED = new Set([...REQUIRED, 'desc', 'user_desc', 'iamt', 'camt', 'samt', 'csamt', 'flag', 'val'])
const cents = (x: unknown) => typeof x === 'number' && Math.abs(Math.round(x * 100) - x * 100) < 1e-6
export function hsnRowProblems(row: Record<string, unknown>): string[] {
  const p: string[] = []
  for (const k of REQUIRED) if (!(k in row)) p.push(`missing ${k}`)
  for (const k of Object.keys(row)) if (!ALLOWED.has(k)) p.push(`extra key ${k}`)
  if (!(Number.isInteger(row.num) && (row.num as number) >= 1)) p.push('num')
  if (!/^[0-9]{2,8}$/.test(String(row.hsn_sc))) p.push('hsn_sc')
  if (!/^[a-zA-Z]{1,30}$/.test(String(row.uqc))) p.push('uqc')
  for (const k of ['qty', 'txval', 'iamt', 'camt', 'samt', 'csamt']) if (k in row && !cents(row[k])) p.push(`${k} not to 0.01`)
  if (!(cents(row.rt) && (row.rt as number) >= 0 && (row.rt as number) <= 999.99)) p.push('rt')
  if ('val' in row && row.val !== 0) p.push('val must be 0')
  return p
}

describe('the schema check itself catches what it should (Cause 7: a guard must fail on bad input)', () => {
  test('a good row passes; each broken row is named', () => {
    const good = { num: 1, hsn_sc: '1006', desc: 'Rice', uqc: 'KGS', qty: 10, txval: 500, iamt: 0, camt: 12.5, samt: 12.5, csamt: 0, rt: 5 }
    expect(hsnRowProblems(good)).toEqual([])
    expect(hsnRowProblems({ ...good, rt: undefined as unknown as number })).toContain('rt')
    expect(hsnRowProblems({ ...good, hsn_sc: '9999A' })).toContain('hsn_sc')
    expect(hsnRowProblems({ ...good, qty: 0.125 })).toContain('qty not to 0.01')
    expect(hsnRowProblems({ ...good, num: 0 })).toContain('num')
    expect(hsnRowProblems({ ...good, rate: 5 } as Record<string, unknown>)).toContain('extra key rate')
  })
})

describe('#128: Table 12 has two tabs, in GSTN\'s shape', () => {
  const txns = [
    doc('sale', REG, [item(), item({ hsn: '1701', productName: 'Sugar', gstRate: 5 })]),
    doc('sale', null, [item({ quantity: 4, cgst: 5, sgst: 5 }), item({ hsn: '3401', productName: 'Soap', unit: 'pcs', gstRate: 18, cgst: 9, sgst: 9 })]),
  ]
  const g = buildGstr1(txns, SHOP, '072026')

  test('hsn is { hsn_b2b, hsn_b2c } — the old single "data" list is gone', () => {
    expect(Object.keys(g.hsn).sort()).toEqual(['hsn_b2b', 'hsn_b2c'])
  })

  test('every row in both tabs meets GSTN\'s row rules', () => {
    const problems = [...g.hsn.hsn_b2b, ...g.hsn.hsn_b2c].flatMap((r) => hsnRowProblems(r as unknown as Record<string, unknown>).map((x) => `${r.hsn_sc}: ${x}`))
    expect(problems).toEqual([])
  })

  test('each tab numbers its rows from 1', () => {
    expect(g.hsn.hsn_b2b.map((r) => r.num)).toEqual([1, 2])
    expect(g.hsn.hsn_b2c.map((r) => r.num)).toEqual([1, 2])
  })

  test('the registered buyer\'s lines are in B2B, the walk-in\'s in B2C', () => {
    expect(g.hsn.hsn_b2b.map((r) => r.hsn_sc).sort()).toEqual(['1006', '1701'])
    expect(g.hsn.hsn_b2c.map((r) => r.hsn_sc).sort()).toEqual(['1006', '3401'])
  })
})

describe('notes land in their buyer\'s tab with the right sign', () => {
  test('a credit note subtracts; a debit note (a PURCHASE RETURN in EkBook) is not in Table 12 at all', () => {
    // Corrected 31 Oct 2026: d75f3b5e added debit notes here as "missing" — in
    // EkBook a debit note is a return TO a supplier, the supplier's document.
    const r = buildHSN([
      doc('sale', REG, [item({ quantity: 10 })]),                          // +500
      doc('debit-note', REG, [item({ quantity: 2, unitPrice: 50 })]),       // ignored
      doc('credit-note', REG, [item({ quantity: 3, unitPrice: 50 })]),      // −150
    ])
    expect(r.hsn_b2b).toHaveLength(1)
    expect(r.hsn_b2b[0].qty).toBe(7)
    expect(r.hsn_b2b[0].txval).toBe(350)
    expect(r.hsn_b2c).toEqual([])
  })

  test('an unregistered buyer\'s credit note reduces the B2C tab, never B2B', () => {
    const r = buildHSN([
      doc('sale', null, [item({ quantity: 10 })]),
      doc('credit-note', null, [item({ quantity: 1 })]),
      doc('sale', REG, [item({ quantity: 5 })]),
    ])
    expect(r.hsn_b2c[0].qty).toBe(9)
    expect(r.hsn_b2b[0].qty).toBe(5)
  })
})

describe('one rule for "registered buyer"', () => {
  test('a 15-character GSTIN is registered; blank or short is not', () => {
    expect(isRegisteredBuyer({ partyGstin: REG })).toBe(true)
    expect(isRegisteredBuyer({ partyGstin: null })).toBe(false)
    expect(isRegisteredBuyer({ partyGstin: '27AAAPL' })).toBe(false)
  })

  test('gstr1-builder.ts writes the test once, inside isRegisteredBuyer', () => {
    const code = readCode('src/lib/gstr1-builder.ts') // comments stripped: a comment quoting the rule is not a copy
    // Both spellings: "registered" (>= 15) and "unregistered" (< 15) — B2CL and B2CS used the second.
    const copies = code.match(/partyGstin\.length\s*(>=|<)\s*15/g) ?? []
    expect(copies).toHaveLength(1)
    expect(code).toMatch(/export function isRegisteredBuyer[\s\S]{0,160}partyGstin\.length >= 15/)
  })
})

describe('a debit note is a purchase return in EkBook — never a GSTR-1 document', () => {
  test('neither the builder nor the GSTR-1 route names \'debit-note\' in code', () => {
    for (const f of ['src/lib/gstr1-builder.ts', 'src/app/api/gstr-1/route.ts']) {
      expect({ f, hits: (readCode(f).match(/['"]debit-note['"]/g) ?? []).length }).toEqual({ f, hits: 0 })
    }
  })
})
