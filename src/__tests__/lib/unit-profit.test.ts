/**
 * Phase 1b-3 (2 Oct 2026) — #134: profit is worked on the price BEFORE GST,
 * everywhere, by one rule.
 *
 * The bill screen used the taxable value; the product form, inventory card,
 * inventory table, inventory total and stock report used `salePrice −
 * purchasePrice`, counting the GST inside an MRP price as profit (atta at ₹255
 * incl. 5%, cost ₹230: "+₹25 (10%)" — really ₹12.86, 5.3%). Margins were also
 * divided by GST-inclusive totals on the bill screen, dashboard and sales list.
 */
import fs from 'fs'
import path from 'path'
import { computeLineItems } from '@/lib/line-items'
import { saleValueBeforeGst, unitProfit, stockPotentialProfit, todayMarginPct } from '@/lib/unit-profit'

const toPaise = (r: number) => Math.round(r * 100)
const ATTA = { salePrice: 255, purchasePrice: 230, gstRate: 5, priceIncludesGst: true }

describe('unitProfit() — the cases seen first-hand', () => {
  test('MRP atta: ₹255 incl. 5%, cost ₹230 → ₹12.86 a pack, 5.3%', () => {
    const r = unitProfit(ATTA)
    expect(r.profit).toBe(12.86)
    expect(r.margin).toBeCloseTo(5.294, 2)
    expect(saleValueBeforeGst(ATTA)).toBeCloseTo(242.857, 3)
  })

  test('a price before GST is used as it is', () => {
    expect(unitProfit({ salePrice: 100, purchasePrice: 80, gstRate: 18, priceIncludesGst: false })).toEqual({ profit: 20, margin: 20 })
  })

  test('a shop that charges no GST keeps the whole price', () => {
    expect(unitProfit(ATTA, { chargesGst: false }).profit).toBe(25)
  })

  test('0% GST and missing fields do not divide or NaN', () => {
    expect(unitProfit({ salePrice: 50, purchasePrice: 40, gstRate: 0, priceIncludesGst: true }).profit).toBe(10)
    expect(unitProfit({})).toEqual({ profit: 0, margin: 0 })
  })

  test('a loss is a negative profit and a negative margin', () => {
    const r = unitProfit({ salePrice: 210, purchasePrice: 230, gstRate: 5, priceIncludesGst: true })
    expect(r.profit).toBe(-30)
    expect(r.margin).toBeLessThan(0)
  })
})

describe('stockPotentialProfit()', () => {
  test('10 packs of MRP atta = ₹128.57, not 10 × ₹12.86 and not 10 × ₹25', () => {
    expect(stockPotentialProfit({ ...ATTA, currentStock: 10 })).toBe(128.57)
  })
  test('oversold stock counts as zero', () => {
    expect(stockPotentialProfit({ ...ATTA, currentStock: -5 })).toBe(0)
  })
})

describe('#134 — the inventory and the bill screen agree to the paisa', () => {
  const PRICES = [1, 9.99, 25.5, 99, 110, 230, 255, 1199, 4999.99]
  const RATES = [0, 0.25, 3, 5, 12, 18, 28, 40]

  test('selling n units: bill-screen profit = inventory potential profit, every n × price × rate × MRP flag', () => {
    const failures: string[] = []
    for (const inclusive of [true, false]) {
      for (const rate of RATES) {
        for (const price of PRICES) {
          const cost = Math.round(price * 0.83 * 100) / 100
          const product = { id: 'p1', name: 'P', unit: 'pcs', salePrice: price, purchasePrice: cost, gstRate: rate, priceIncludesGst: inclusive }
          for (let n = 1; n <= 60; n++) {
            const bill = computeLineItems({
              items: [{ productId: 'p1', productName: 'P', quantity: n, unitPrice: price, gstRate: rate, unit: 'pcs', priceIncludesGst: inclusive }],
              productMap: new Map([['p1', product]]),
              isInterState: false, orderDiscount: 0, type: 'sale',
            })
            const inv = stockPotentialProfit({ ...product, currentStock: n })
            if (toPaise(bill.grossProfit) !== toPaise(inv)) {
              failures.push(`${n} × ₹${price} @${rate}% ${inclusive ? 'incl' : 'excl'}: bill ₹${bill.grossProfit}, inventory ₹${inv}`)
              if (failures.length > 10) break
            }
          }
        }
      }
    }
    expect(failures).toEqual([])
  })

  test('the bill screen no longer rounds per unit: 10 MRP packs book ₹128.57', () => {
    const bill = computeLineItems({
      items: [{ productId: 'p1', productName: 'Atta', quantity: 10, unitPrice: 255, gstRate: 5, unit: 'pcs', priceIncludesGst: true }],
      productMap: new Map([['p1', { id: 'p1', name: 'Atta', unit: 'pcs', ...ATTA }]]),
      isInterState: false, orderDiscount: 0, type: 'sale',
    })
    expect(bill.grossProfit).toBe(128.57)
  })
})

describe('todayMarginPct()', () => {
  test('profit over sales before GST', () => {
    expect(todayMarginPct({ todayProfit: 38.57, todayNetSales: 728.57, todayRevenue: 765 })).toBeCloseTo(5.294, 2)
  })
  test('nothing sold is 0%, not NaN', () => {
    expect(todayMarginPct({ todayProfit: 0, todayNetSales: 0, todayRevenue: 0 })).toBe(0)
  })
  test('an older cached response without todayNetSales falls back to revenue', () => {
    expect(todayMarginPct({ todayProfit: 10, todayRevenue: 100 })).toBe(10)
  })
})

/**
 * THE CLASS. Two guards, each a function tested on good and bad code, then
 * swept over src (comments blanked in place so line numbers are exact).
 *
 *  1. No profit as `salePrice − purchasePrice` outside lib/unit-profit.ts.
 *  2. No margin divided by a GST-inclusive total (`totalAmount`, `todayRevenue`).
 */
function blankComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, block => block.replace(/[^\n]/g, ''))
    .replace(/(^|[ \t])\/\/[^\n]*/gm, (_m, lead) => lead)
    .replace(/--[^\n]*/g, m => (/^--\s/.test(m) ? '' : m)) // SQL line comments
}

const SALE_MINUS_COST = /salePrice["'\s)]*(?:\|\|\s*0\s*\)?\s*)?-\s*\(?\s*[\w.]*["']?purchasePrice/
const MARGIN_ON_GROSS = /[pP]rofit\w*\)?\s*\/\s*\(?\s*[\w.?]*\b(?:totalAmount|todayRevenue)\b/

function findLines(source: string, re: RegExp): number[] {
  const out: number[] = []
  blankComments(source).split(/\r?\n/).forEach((line, i) => { if (re.test(line)) out.push(i + 1) })
  return out
}

const ALLOWED_SALE_MINUS_COST: Record<string, { count: number; why: string }> = {
  'src/lib/seed.ts': { count: 1, why: 'Sample products are all priced before GST; the seed adds GST on top (calculateGst), so sale − cost is the taxable profit.' },
}

function sourceFiles(dir: string): string[] {
  const out: string[] = []
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      if (entry.name === '__tests__' || entry.name === 'node_modules') continue
      out.push(...sourceFiles(full))
    } else if (/\.(ts|tsx)$/.test(entry.name)) out.push(full)
  }
  return out
}

describe('guard — profit before GST, margin on sales before GST', () => {
  test('catches each old shape', () => {
    expect(findLines('const profit = (p.salePrice || 0) - (p.purchasePrice || 0)', SALE_MINUS_COST)).toEqual([1])
    expect(findLines('const profit = salePrice - purchasePrice', SALE_MINUS_COST)).toEqual([1])
    expect(findLines('SELECT "salePrice" - "purchasePrice" FROM x', SALE_MINUS_COST)).toEqual([1])
    expect(findLines('x\n{totalAmount > 0 ? ((totalProfit / totalAmount) * 100).toFixed(1) : 0}', MARGIN_ON_GROSS)).toEqual([2])
    expect(findLines('const m = (kpis.todayProfit / kpis.todayRevenue) * 100', MARGIN_ON_GROSS)).toEqual([1])
  })

  test('passes the new shapes and ignores comments', () => {
    expect(findLines('const { profit } = unitProfit(p, opts)', SALE_MINUS_COST)).toEqual([])
    expect(findLines('// was: salePrice - purchasePrice', SALE_MINUS_COST)).toEqual([])
    expect(findLines('const m = profit / revenue', MARGIN_ON_GROSS)).toEqual([])
    expect(findLines('((totalProfit / totalNetSales) * 100)', MARGIN_ON_GROSS)).toEqual([])
  })

  test('sweep: no file outside unit-profit.ts works profit or margin the old way', () => {
    const root = path.join(__dirname, '..', '..')
    const offenders: string[] = []
    const counts: Record<string, number> = {}
    for (const file of sourceFiles(root)) {
      const rel = path.relative(path.join(root, '..'), file).replace(/\\/g, '/')
      if (rel === 'src/lib/unit-profit.ts') continue
      const src = fs.readFileSync(file, 'utf8')
      const sm = findLines(src, SALE_MINUS_COST)
      if (sm.length) counts[rel] = sm.length
      for (const line of sm) if (!ALLOWED_SALE_MINUS_COST[rel]) offenders.push(`${rel}:${line} sale − cost`)
      for (const line of findLines(src, MARGIN_ON_GROSS)) offenders.push(`${rel}:${line} margin on a GST-inclusive total`)
    }
    expect(offenders).toEqual([])
    for (const [rel, { count }] of Object.entries(ALLOWED_SALE_MINUS_COST)) expect(counts[rel] ?? 0).toBe(count)
  })
})
