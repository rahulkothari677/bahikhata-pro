/**
 * #254 (Phase 6a, Rahul's decision 21 Oct): an item saved with cost ₹0 has
 * "no cost price", and its sales book no profit — everywhere.
 *
 * Before: the bill booked cost-₹0 sales as 100% profit, a typed-in line as ₹0,
 * Insights called both "typed in", and the two profit reports and Ask worked
 * out their own "revenue − quantity × cost" — so one sale was ₹0 profit on
 * Home and its whole value in Item-wise Profit.
 *
 * The rules are tested with known-good and known-bad inputs; the sweep at the
 * end keeps any file from growing its own profit formula again.
 */
import fs from 'fs'
import path from 'path'
import { hasCostPrice, isNoCostLine, marginOnCosted, stockPotentialProfit } from '@/lib/unit-profit'
import { computeLineItems } from '@/lib/line-items'
import { productProfitAnswer } from '@/lib/ask-customer-rank'
import { readCode } from '@/test-support/read-source'

describe('the rules', () => {
  test('hasCostPrice: ₹0, blank and missing are "no cost price"; any positive cost is one', () => {
    expect([0, null, undefined, NaN, -5].map((v) => hasCostPrice({ purchasePrice: v as any }))).toEqual([false, false, false, false, false])
    expect([0.01, 1, 230].map((v) => hasCostPrice({ purchasePrice: v }))).toEqual([true, true, true])
  })

  test('isNoCostLine: typed in, or its item had no cost when sold — the JS twin of NO_COST_LINE', () => {
    expect(isNoCostLine({ productId: null, purchasePriceAtSale: 50 })).toBe(true) // typed in
    expect(isNoCostLine({ productId: 'p1', purchasePriceAtSale: 0 })).toBe(true) // cost ₹0
    expect(isNoCostLine({ productId: 'p1', purchasePriceAtSale: 10 })).toBe(false)
    // The SQL twin says the same, word for word.
    expect(readCode('src/lib/insights-queries.ts')).toContain('NO_COST_LINE = Prisma.sql`(ti."productId" IS NULL OR ti."purchasePriceAtSale" <= 0)`')
  })

  test('marginOnCosted: over the sales that have a cost; null when none had; 0 when nothing sold', () => {
    expect(marginOnCosted(10, 100, 0)).toBe(10)
    expect(marginOnCosted(10, 150, 50)).toBe(10) // ₹50 with no cost is left out, not counted as a 0% sale
    expect(marginOnCosted(0, 50, 50)).toBeNull()
    expect(marginOnCosted(0, 0, 0)).toBe(0)
    expect(marginOnCosted(-10, -100, 0)).toBe(10) // a return: the margin given back
    expect(marginOnCosted(1, 3, 0)).toBe(33.3)
  })

  test('stock with no cost price promises no profit', () => {
    const atta = { salePrice: 255, gstRate: 5, priceIncludesGst: true, currentStock: 10 }
    expect(stockPotentialProfit({ ...atta, purchasePrice: 0 }, { chargesGst: true })).toBe(0)
    expect(stockPotentialProfit({ ...atta, purchasePrice: 230 }, { chargesGst: true })).toBe(128.57)
  })
})

describe('the bill books it', () => {
  const productMap = new Map<string, any>([
    ['free', { id: 'free', name: 'No cost', purchasePrice: 0, gstRate: 0, unit: 'pcs' }],
    ['cost', { id: 'cost', name: 'Costed', purchasePrice: 60, gstRate: 0, unit: 'pcs' }],
  ])
  const bill = (type: string, ...ids: string[]) => computeLineItems({
    items: ids.map((id) => ({ productId: id, productName: id, quantity: 1, unitPrice: 100, gstRate: 0, unit: 'pcs' })),
    productMap,
    isInterState: false,
    orderDiscount: 0,
    type,
    chargesGst: false,
  } as any)

  test('a sale of an item at cost ₹0 books ₹0 profit, never its whole value', () => {
    expect(bill('sale', 'free').grossProfit).toBe(0)
    expect(bill('sale', 'cost').grossProfit).toBe(40)
    expect(bill('sale', 'free', 'cost').grossProfit).toBe(40)
  })
  test('a return of it reverses nothing', () => {
    expect(bill('credit-note', 'free').grossProfit).toBe(0)
    expect(bill('credit-note', 'cost').grossProfit).toBe(-40)
  })
  test('the line still records the cost it was sold at (₹0), so every reader can tell', () => {
    expect(bill('sale', 'free').txItems.map((l: any) => isNoCostLine(l))).toEqual([true])
    expect(bill('sale', 'cost').txItems.map((l: any) => isNoCostLine(l))).toEqual([false])
  })
})

describe('Ask never calls a no-cost item "the most profit"', () => {
  const money = (n: number) => `₹${n}`
  test('top item with no cost price → "no profit counted"', () => {
    const a = productProfitAnswer([{ id: 'x', name: 'Loose tea', revenue: 500, profit: 0, margin: null, qty: 5 }], 'this month', money, 1)
    expect(a.headline).toBe('No profit counted this month')
    expect(a.detail).toContain('Loose tea has no cost price')
  })
  test('a costed item still ranks with its margin', () => {
    const a = productProfitAnswer([{ id: 'x', name: 'Atta', revenue: 100, profit: 10, margin: 10, qty: 1 }], 'this month', money, 1)
    expect(a.headline).toBe('Atta made the most profit this month')
    expect(a.detail).toContain('10.0% margin')
  })
})

/*
 * One profit definition. The cost of a sold line is multiplied in exactly one
 * place — SIGNED_PROFIT — and the bill's own number is computed by
 * line-items.ts. A second "quantity × purchasePriceAtSale" is a second
 * definition of profit, which is what #254 found in three files.
 */
function ownProfitFormulas(code: string): string[] {
  const re = /purchasePriceAtSale"?(?:::[a-z0-9]+)?\s*\*|\*\s*(?:[A-Za-z_]+\.)?"?purchasePriceAtSale/g
  return code.match(re) ?? []
}

describe('one profit definition', () => {
  test('the rule catches the shapes it must, and lets others be', () => {
    expect(ownProfitFormulas('SUM(ti."purchasePriceAtSale" * ti."quantity")')).toHaveLength(1)
    expect(ownProfitFormulas('const c = item.purchasePriceAtSale * item.quantity')).toHaveLength(1)
    expect(ownProfitFormulas('qty * item.purchasePriceAtSale')).toHaveLength(1)
    expect(ownProfitFormulas('ti."quantity"::float8 * ti."purchasePriceAtSale"::float8')).toHaveLength(1)
    expect(ownProfitFormulas('purchasePriceAtSale: true, total: true')).toHaveLength(0)
    expect(ownProfitFormulas('isNoCostLine({ purchasePriceAtSale: 0 })')).toHaveLength(0)
  })

  test('no file outside insights-queries.ts multiplies a sold line\'s cost', () => {
    const root = path.join(process.cwd(), 'src')
    const found: string[] = []
    const walk = (dir: string) => {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, e.name)
        if (e.isDirectory()) { if (e.name !== '__tests__') walk(full); continue }
        if (!/\.(ts|tsx)$/.test(e.name)) continue
        const rel = path.relative(process.cwd(), full).split(path.sep).join('/')
        if (rel === 'src/lib/insights-queries.ts') continue
        if (ownProfitFormulas(readCode(rel)).length) found.push(rel)
      }
    }
    walk(root)
    expect(found).toEqual([])
    // ...and the one allowed place really is where the rule lives (the sweep is not vacuous).
    expect(ownProfitFormulas(readCode('src/lib/insights-queries.ts'))).toHaveLength(1)
  })
})

describe('every reader uses the shared rule', () => {
  const route = readCode('src/app/api/reports/route.ts')
  const at = (code: string, s: string) => { const i = code.indexOf(s); expect({ s, found: i >= 0 }).toEqual({ s, found: true }); return i }
  const between = (code: string, a: string, b: string) => { const s = code.slice(at(code, a), at(code, b)); expect(s.length).toBeGreaterThan(200); return s }

  test('bill-wise profit: the profit each bill booked, the no-cost lines by the shared rule', () => {
    const block = between(route, "if (type === 'bill-profit')", "if (type === 'item-profit')")
    expect(block).toContain('const profit = t.grossProfit')
    expect(block).toContain('isNoCostLine(item)')
    expect(block).toContain('grossProfit: true')
    expect(block).toContain('${NO_COST_LINE}')
    expect(block).toContain('marginOnCosted(')
    // a return takes its value off the total (the old aggregate added it)
    expect(block).toMatch(/const sign = g\.type === 'sale' \? 1 : -1/)
  })

  test('item-wise profit: SIGNED_PROFIT and the no-cost value, margin over costed sales', () => {
    const block = route.slice(at(route, "if (type === 'item-profit')"))
    expect(block.length).toBeGreaterThan(200)
    expect(block).toContain('SUM(${SIGNED_PROFIT}) AS "profit"')
    expect(block).toContain('WHEN ${NO_COST_LINE} THEN ${SIGNED_LINE}')
    expect(block).toContain('marginOnCosted(profit, revenue, noCost)')
  })

  test('stock report: no-cost stock is left out of potential profit, as on the items screen', () => {
    const block = between(route, "if (type === 'stock')", "if (type === 'bill-profit')")
    expect(block).toContain('FILTER (WHERE "purchasePrice" <= 0)')
    expect(block).toContain('totalPotentialBeforeGst - noCostBeforeGst - totalStockValue')
  })

  test('Ask\'s product profit is the item-wise report\'s arithmetic', () => {
    const ask = readCode('src/app/api/ask/route.ts')
    const block = between(ask, "case 'product_profit':", "case 'least_products':")
    expect(block).toContain('SUM(${SIGNED_PROFIT})')
    expect(block).toContain('marginOnCosted(')
  })

  test('Insights: the total margin and the lowest-margin list use the same rule as the reports', () => {
    const ins = readCode('src/app/api/insights/route.ts')
    const block = between(ins, 'async function profitSection', 'costUp: costUp.map')
    // found on the local check: Insights said 7.7% while both reports said 7.8% (₹100 with no cost price)
    expect(block).toContain('marginOnCosted(profit, netSales, noCostSales)')
    expect(block).toContain('marginOnCosted(r.profit, r.sales, noCost)')
    expect(block).toContain('r.margin === null ? []')
    expect(block).not.toMatch(/profit \/ netSales/)
  })

  test('the item screens check for a cost price before showing a profit', () => {
    for (const f of ['src/components/inventory/Inventory.tsx', 'src/components/inventory/ProductDialog.tsx']) {
      const code = readCode(f)
      const calls = code.split('unitProfit(').length - 1
      expect({ f, calls: calls > 0 }).toEqual({ f, calls: true })
      expect({ f, checks: code.split('hasCostPrice(').length - 1 >= calls }).toEqual({ f, checks: true })
    }
  })

  test('the bill screen and a saved bill say "No cost price" by the shared line rule', () => {
    expect(readCode('src/components/ledger/TransactionEntry.tsx')).toContain('isNoCostLine(l) ? lineTaxable(l) : 0')
    expect(readCode('src/components/ledger/TransactionDetail.tsx')).toContain('isNoCostLine(it) ? lineTaxable(it) : 0')
  })
})
