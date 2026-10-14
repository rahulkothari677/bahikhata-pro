/**
 * 🔒 GUARD: the monthly goal is plain arithmetic on this month (Phase 5b-4).
 *
 * The old Monthly Goals card compared the MONTHLY target with the period chip's
 * sales — choose "This Year" and a ₹2,90,000 October goal read "Target
 * achieved!". The ring reads month-to-date sales (monthRevenue), never the
 * chip's period, and shows actual pace, never a forecast.
 */
import { describe, test, expect } from '@jest/globals'
import { goalPace } from '@/lib/goal-pace'
import { readCode } from '@/test-support/read-source'

// 13 Oct 2026, 15:00 IST — the model's example day
const OCT13 = new Date('2026-10-13T09:30:00.000Z')

describe('goal pace', () => {
  test('the model example: 13 days gone, 18 left in October', () => {
    const p = goalPace({ target: 290000, achieved: 124384, now: OCT13 })!
    expect(p.pct).toBe(42)
    expect(p.daysGone).toBe(13)
    expect(p.daysLeft).toBe(18)
    expect(p.soFarPerDay).toBe(9568) // 124384 / 13
    expect(p.neededPerDay).toBe(9200.89) // 165616 / 18
    expect(p.reached).toBe(false)
  })

  test('IST, not the server clock: 00:30 IST on the 1st is day 1 of the new month', () => {
    const p = goalPace({ target: 1000, achieved: 0, now: new Date('2026-10-31T19:00:00.000Z') })! // 1 Nov 00:30 IST
    expect(p.daysGone).toBe(1)
    expect(p.daysLeft).toBe(29)
  })

  test('the last day: the whole remainder is needed today', () => {
    const p = goalPace({ target: 1000, achieved: 400, now: new Date('2026-10-31T10:00:00.000Z') })!
    expect(p.daysLeft).toBe(0)
    expect(p.neededPerDay).toBe(600)
  })

  test('reached: nothing needed, percent can pass 100', () => {
    const p = goalPace({ target: 1000, achieved: 1250, now: OCT13 })!
    expect(p).toMatchObject({ reached: true, pct: 125, neededPerDay: 0, remaining: 0 })
  })

  test('no target, or returns larger than sales: no ring / no negative pace', () => {
    expect(goalPace({ target: 0, achieved: 10, now: OCT13 })).toBeNull()
    expect(goalPace({ target: 1000, achieved: -200, now: OCT13 })!.soFarPerDay).toBe(0)
  })
})

describe('the ring reads this month, never the chip', () => {
  test('Home hands GoalCard this month\'s figures; nothing compares a goal with the chip\'s period', () => {
    const home = readCode('src/components/dashboard/Dashboard.tsx')
    expect(home).toMatch(/<GoalCard\s+monthRevenue=\{kpis\.monthRevenue \?\? 0\}\s+monthExpenses=\{kpis\.monthExpenses \?\? 0\}/)
    expect(home).not.toMatch(/rangeRevenue \/ revenueTarget|rangeRevenue >= revenueTarget|rangeExpenses \|\| 0\) \/ expenseBudget/)
    const card = readCode('src/components/dashboard/GoalCard.tsx')
    expect(card).not.toMatch(/rangeRevenue|rangeExpenses|dateRange/)
    expect(card).toMatch(/goalPace\(\{ target: revenueTarget \?\? 0, achieved: monthRevenue \}\)/)
  })
  test('the Home feed sums the IST month to date', () => {
    const route = readCode('src/app/api/dashboard/route.ts')
    expect(route).toMatch(/"date" >= \$\{startOfMonth\} AND "date" <= \$\{now\} THEN "totalAmount"[\s\S]*AS month_revenue/)
  })
})
