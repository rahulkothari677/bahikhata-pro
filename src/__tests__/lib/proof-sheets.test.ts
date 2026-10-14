/**
 * 🔒 GUARD: every "how is this worked out?" sheet adds up to its number
 * (Phase 5b-1).
 *
 * Hard rule: every figure shows receipts. A sheet whose lines do not add up
 * to the figure it explains is worse than no sheet — it teaches the
 * shopkeeper that the app's numbers do not agree with themselves.
 *
 * Checked: each builder on hand-worked cases, a random sweep, the remainder
 * line when a list is cut short, and that "Cash in drawer" uses exactly the
 * day-summary route's terms and signs (one definition, not two).
 */
import { describe, test, expect } from '@jest/globals'
import {
  DRAWER_TERMS, drawerProof, listProof, netProfitProof, proofGap, profitProof, purchasesProof, salesProof,
  type Proof, type SalesGroup,
} from '@/lib/proof-sheets'
import { translations } from '@/lib/i18n'
import { readCode } from '@/test-support/read-source'

describe('proofGap (good and bad input)', () => {
  test('0 when the lines add up, the difference in paise when they do not', () => {
    expect(proofGap({ total: 100, rows: [{ amount: 60 }, { amount: 40 }] })).toBe(0)
    expect(proofGap({ total: 100, rows: [{ amount: 60 }, { amount: 39.5 }] })).toBe(-50)
  })
})

describe('Sales: bills − returns, split by what was paid at the counter', () => {
  test('a ₹600 cash bill with ₹200 paid is ₹200 cash and ₹400 udhaar (the drawer double-count case)', () => {
    const p = salesProof([{ type: 'sale', paymentMode: 'cash', total: 600, paid: 200, count: 1 }])
    expect(p.total).toBe(600)
    expect(p.rows).toEqual([{ key: 'proof.paid_cash', amount: 200 }, { key: 'proof.on_udhaar', amount: 400 }])
    expect(p.bills).toBe(1)
    expect(proofGap(p)).toBe(0)
  })

  test('returns come off as a minus line; a credit bill is all udhaar; unknown modes are "other"', () => {
    const p = salesProof([
      { type: 'sale', paymentMode: 'upi', total: 1380, paid: 1380, count: 4 },
      { type: 'sale', paymentMode: 'credit', total: 2120, paid: 0, count: 3 },
      { type: 'sale', paymentMode: 'mixed', total: 100, paid: 100, count: 1 },
      { type: 'credit-note', paymentMode: 'cash', total: 150, paid: 150, count: 1 },
      { type: 'purchase', paymentMode: 'cash', total: 999, paid: 999, count: 1 },
    ])
    expect(p.total).toBe(1380 + 2120 + 100 - 150)
    expect(p.rows.map((r) => r.key)).toEqual(['proof.paid_upi', 'proof.paid_other', 'proof.on_udhaar', 'proof.returns'])
    expect(p.rows.find((r) => r.key === 'proof.returns')!.amount).toBe(-150)
    expect(p.bills).toBe(8)
    expect(proofGap(p)).toBe(0)
  })

  test('nothing sold: total 0, no lines', () => {
    expect(salesProof([])).toEqual({ total: 0, rows: [], bills: 0 })
  })

  test('sweep: 500 random days always add up to the paise', () => {
    let seed = 7
    const rnd = (n: number) => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed % n }
    const modes = ['cash', 'upi', 'card', 'bank', 'credit', null, 'mixed']
    for (let i = 0; i < 500; i++) {
      const groups: SalesGroup[] = Array.from({ length: rnd(9) }, () => {
        const total = rnd(5_000_000) / 100
        return { type: rnd(5) === 0 ? 'credit-note' : 'sale', paymentMode: modes[rnd(modes.length)], total, paid: rnd(2) ? total : rnd(Math.round(total * 100) + 1) / 100, count: 1 + rnd(5) }
      })
      const p = salesProof(groups)
      expect({ i, gap: proofGap(p) }).toEqual({ i, gap: 0 })
    }
  })
})

describe('Profit and net profit', () => {
  test('profit = sales before GST − what the goods cost', () => {
    const p = profitProof({ netSales: 8460.1, profit: 1120.2 })
    expect(p.rows).toEqual([{ key: 'proof.net_sales', amount: 8460.1 }, { key: 'proof.cost', amount: -7339.9 }])
    expect(proofGap(p)).toBe(0)
  })
  test('net profit adds other income and takes off expenses; zero lines are left out', () => {
    const p = netProfitProof({ netSales: 50000, profit: 9000, income: 500, expenses: 6840 })
    expect(p.total).toBe(9000 + 500 - 6840)
    expect(p.rows.map((r) => r.key)).toEqual(['proof.net_sales', 'proof.cost', 'proof.other_income', 'proof.expenses'])
    expect(proofGap(p)).toBe(0)
    expect(netProfitProof({ netSales: 10, profit: 2, income: 0, expenses: 0 }).rows).toHaveLength(2)
  })
  test('typed-in items with no cost price get their own line, never a made-up cost (local copy, 14 Oct)', () => {
    // Two typed-in items, ₹1,100: profit ₹0 because no cost price exists.
    const p = profitProof({ netSales: 1100, profit: 0, noCost: 1100 })
    expect(p.rows).toEqual([{ key: 'proof.net_sales', amount: 1100 }, { key: 'proof.no_cost', amount: -1100 }])
    expect(proofGap(p)).toBe(0)
    // Mixed: ₹1,000 of priced goods costing ₹850, plus ₹200 typed in.
    const m = netProfitProof({ netSales: 1200, profit: 150, noCost: 200, income: 0, expenses: 50 })
    expect(m.rows).toEqual([
      { key: 'proof.net_sales', amount: 1200 }, { key: 'proof.cost', amount: -850 },
      { key: 'proof.no_cost', amount: -200 }, { key: 'proof.expenses', amount: -50 },
    ])
    expect(proofGap(m)).toBe(0)
  })
  test('a loss reads as a negative total that still adds up', () => {
    const p = netProfitProof({ netSales: 1000, profit: 100, income: 0, expenses: 900 })
    expect(p.total).toBe(-800)
    expect(proofGap(p)).toBe(0)
  })
})

describe('Purchases (5b-3): paid at billing + on credit = the bills', () => {
  test('adds up; a fully paid or fully unpaid period has one line', () => {
    const p = purchasesProof({ total: 12500.5, paid: 9000 })
    expect(p.rows).toEqual([{ key: 'proof.purchase_paid', amount: 9000 }, { key: 'proof.purchase_due', amount: 3500.5 }])
    expect(proofGap(p)).toBe(0)
    expect(purchasesProof({ total: 100, paid: 100 }).rows.map((r) => r.key)).toEqual(['proof.purchase_paid'])
    expect(purchasesProof({ total: 100, paid: 0 }).rows.map((r) => r.key)).toEqual(['proof.purchase_due'])
  })
})

describe('Stock value is the Home feed\'s own sum (5b-3)', () => {
  // The expression both routes must share: goods only, oversold as 0, rounded per product.
  const SUM = 'SUM(ROUND(GREATEST("currentStock", 0)::numeric * "purchasePrice"::numeric))'
  test('both routes compute it the same way', () => {
    for (const f of ['src/app/api/dashboard/route.ts', 'src/app/api/dashboard/explain/route.ts']) {
      const code = readCode(f)
      expect({ f, same: code.includes(SUM) && /FILTER \(\s*WHERE "tracksInventory" = true\s*\)/.test(code) }).toEqual({ f, same: true })
    }
  })
})

describe('A list cut short says so and still adds up', () => {
  const items = [{ label: 'Deepak', amount: 1500 }, { label: 'Suresh', amount: 800 }]
  test('all entries shown: no extra line', () => {
    const p = listProof(items, 2300, 2)
    expect(p.rows).toHaveLength(2)
    expect(proofGap(p)).toBe(0)
  })
  test('more entries than fetched: "and N more" carries the rest', () => {
    const p = listProof(items, 3000.55, 5)
    expect(p.rows[2]).toEqual({ key: 'proof.more', params: { n: 3 }, amount: 700.55 })
    expect(proofGap(p)).toBe(0)
  })
})

describe('Cash in drawer is the day-summary route\'s own formula', () => {
  const terms = { cashInFromSales: 4960, cashIncome: 0, udhaarCollectedCash: 800, cashRefundsIn: 0, cashOutForPurchases: 0, cashExpenses: 350, udhaarPaidCash: 0, cashRefundsOut: 0 }
  test('adds up, leaves out zero terms', () => {
    const p = drawerProof(terms)
    expect(p.total).toBe(5410)
    expect(p.rows.map((r) => r.amount)).toEqual([4960, 800, -350])
    expect(proofGap(p)).toBe(0)
  })

  /** The terms and signs inside the route's `const expectedCash = roundMoney(...)`. */
  function routeDrawerTerms(code: string): { field: string; sign: 1 | -1 }[] {
    const at = code.indexOf('const expectedCash = roundMoney(')
    if (at < 0) return []
    let depth = 0
    let end = at
    for (let i = code.indexOf('(', at); i < code.length; i++) {
      if (code[i] === '(') depth++
      else if (code[i] === ')' && --depth === 0) { end = i; break }
    }
    const expr = code.slice(code.indexOf('(', at) + 1, end)
    return [...expr.matchAll(/([+-]?)\s*([A-Za-z]\w*)/g)].map((m) => ({ field: m[2], sign: m[1] === '-' ? -1 : 1 }))
  }

  test('the reader works on good and bad input', () => {
    expect(routeDrawerTerms('const expectedCash = roundMoney(\n a + b\n - c\n)')).toEqual([
      { field: 'a', sign: 1 }, { field: 'b', sign: 1 }, { field: 'c', sign: -1 },
    ])
    expect(routeDrawerTerms('no formula here')).toEqual([])
  })

  test('same eight terms, same signs as the route that the Close-the-day sheet uses', () => {
    const route = routeDrawerTerms(readCode('src/app/api/day-summary/route.ts'))
    const sort = (xs: { field: string; sign: number }[]) => [...xs].sort((a, b) => a.field.localeCompare(b.field))
    expect(sort(route)).toEqual(sort(DRAWER_TERMS.map(({ field, sign }) => ({ field, sign }))))
  })
})

describe('the route uses Home\'s definitions and never caps silently', () => {
  const code = readCode('src/app/api/dashboard/explain/route.ts')
  test('sales and profit come from the shared net-sales helpers', () => {
    for (const fn of ['netSalesTotal(', 'netSalesProfit(', 'netSalesTaxable(']) expect(code).toContain(fn)
    expect(code).toMatch(/type: \{ in: \['sale', 'credit-note'\] \}/)
  })
  test('the only list is capped AND carries the rest through listProof', () => {
    expect(code).toMatch(/take: PROOF_LIST_LIMIT/)
    expect(code).toMatch(/listProof\(items, /)
  })
  test('profit follows the hide-profit setting', () => {
    expect(code).toMatch(/shouldHideProfit\(/)
  })
})

describe('every line a sheet can show has words in English and Hindi', () => {
  const sample: Proof[] = [
    salesProof([
      { type: 'sale', paymentMode: 'cash', total: 10, paid: 5, count: 1 }, { type: 'sale', paymentMode: 'upi', total: 1, paid: 1, count: 1 },
      { type: 'sale', paymentMode: 'card', total: 1, paid: 1, count: 1 }, { type: 'sale', paymentMode: 'bank', total: 1, paid: 1, count: 1 },
      { type: 'sale', paymentMode: 'x', total: 1, paid: 2, count: 1 }, { type: 'credit-note', paymentMode: 'cash', total: 1, paid: 1, count: 1 },
    ]),
    salesProof([{ type: 'sale', paymentMode: 'cash', total: 1, paid: 2, count: 1 }]),
    netProfitProof({ netSales: 2, profit: 1, noCost: 1, income: 1, expenses: 1 }),
    listProof([], 5, 2),
    purchasesProof({ total: 2, paid: 1 }),
    drawerProof({ cashInFromSales: 1, cashIncome: 1, udhaarCollectedCash: 1, cashRefundsIn: 1, cashOutForPurchases: 1, cashExpenses: 1, udhaarPaidCash: 1, cashRefundsOut: 1 }),
  ]
  const keys = new Set([...sample.flatMap((p) => p.rows.map((r) => r.key!).filter(Boolean)), 'proof.cmp_last_week', 'proof.cmp_prev_period', 'proof.after_expenses',
    ...['bills', 'payments', 'entries', 'items'].flatMap((n) => [`proof.${n}_one`, `proof.${n}_n`])])
  test('keys exist', () => {
    const en = translations.en as unknown as Record<string, string>
    const hi = translations.hi as unknown as Record<string, string>
    expect(keys.size).toBeGreaterThan(18)
    expect([...keys].filter((k) => !en[k] || !hi[k])).toEqual([])
  })
})
