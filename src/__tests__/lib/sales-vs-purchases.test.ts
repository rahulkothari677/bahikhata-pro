/**
 * 🔒 GUARD: Home's Sales vs Purchases card shows one set of figures (#237, Phase 5a-1).
 *
 * The card's Purchases line read `totalPayable` (a balance) while its
 * difference subtracted `rangePurchases` and its colour followed sales − payable,
 * so a ₹11.7K shortfall showed in green beside a ₹1.5K "Purchases" line.
 *
 * Two layers: the calculation is one function (tested here), and the chart file
 * may not read any balance field at all (the class of the bug, swept below).
 */
import { describe, test, expect } from '@jest/globals'
import * as fs from 'fs'
import * as path from 'path'
import { salesVsPurchases } from '@/lib/sales-vs-purchases'
import { balanceFieldsInPeriodChart } from '@/test-support/chart-rules'
import { stripComments } from '@/test-support/read-source'

describe('salesVsPurchases: the line, the difference and the colour agree', () => {
  test('the demo shop case: purchases above sales is a shortfall, shown as not positive', () => {
    const r = salesVsPurchases({ rangeRevenue: 6163.3, rangePurchases: 17900 })
    expect(r.purchases).toBe(17900)
    expect(r.difference).toBeCloseTo(6163.3 - 17900, 2)
    expect(r.differenceIsPositive).toBe(false)
  })

  test('sales above purchases is positive, and equal is not a loss', () => {
    expect(salesVsPurchases({ rangeRevenue: 124380, rangePurchases: 96250 })).toMatchObject({ difference: 28130, differenceIsPositive: true })
    expect(salesVsPurchases({ rangeRevenue: 500, rangePurchases: 500 }).differenceIsPositive).toBe(true)
  })

  test('missing figures count as zero and an empty period says so', () => {
    expect(salesVsPurchases({})).toMatchObject({ sales: 0, purchases: 0, difference: 0, empty: true })
    expect(salesVsPurchases({ rangeRevenue: null, rangePurchases: 10 }).empty).toBe(false)
  })

  test('a payable balance passed in is ignored: only period figures count', () => {
    const withPayable = { rangeRevenue: 6000, rangePurchases: 18000, totalPayable: 1500 } as Parameters<typeof salesVsPurchases>[0]
    expect(salesVsPurchases(withPayable).purchases).toBe(18000)
  })
})

describe('the rule: a period chart reads no balance field (good and bad input)', () => {
  test('a balance read is caught with its line', () => {
    expect(balanceFieldsInPeriodChart('const a = 1\n<b>{formatINR(kpis.totalPayable)}</b>')).toEqual(['line 2: reads totalPayable'])
    expect(balanceFieldsInPeriodChart('x.totalReceivable + y.totalPayable')).toHaveLength(2)
  })
  test('period figures pass, and a longer name containing the word does not match', () => {
    expect(balanceFieldsInPeriodChart('svp.purchases + kpis.rangePurchases')).toEqual([])
    expect(balanceFieldsInPeriodChart('kpis.totalPayableCount')).toEqual([])
  })
})

describe('the Home charts', () => {
  test('DashboardCharts reads no balance field (balances live on the To collect / To pay cards)', () => {
    const file = path.resolve(process.cwd(), 'src/components/dashboard/DashboardCharts.tsx')
    const code = stripComments(fs.readFileSync(file, 'utf8'))
    expect(balanceFieldsInPeriodChart(code)).toEqual([])
    expect(code).toMatch(/salesVsPurchases\(kpis\)/)
  })
})
