/**
 * 🔒 GUARD: the "how is this worked out?" sheet reads its lines right and
 * Home's numbers open it (Phase 5b-1).
 */
import { describe, test, expect, jest } from '@jest/globals'

jest.mock('sonner', () => ({ toast: { info: jest.fn(), success: jest.fn(), error: jest.fn() } }))

import { proofCountLine, proofMargin, proofRowDetail, proofRowLabel, proofUrl } from '@/components/dashboard/ProofSheet'
import { translations } from '@/lib/i18n'
import { readCode } from '@/test-support/read-source'

const en = translations.en as unknown as Record<string, string>
const t = (k: string) => en[k] ?? k

describe('line words', () => {
  test('a key is translated and its placeholder filled', () => {
    expect(proofRowLabel({ key: 'proof.more', params: { n: 12 }, amount: 1 }, t, false)).toBe('and 12 more')
  })
  test('a party line gets its payment mode; an unknown mode reads "Other"', () => {
    expect(proofRowLabel({ label: 'Deepak Kumar', mode: 'upi', amount: 1 }, t, false)).toBe('Deepak Kumar · UPI')
    expect(proofRowLabel({ label: 'Asha', mode: 'cheque', amount: 1 }, t, false)).toBe('Asha · Other')
  })
  test('"Sales" says "before GST" only for a shop that charges GST (most shops never see GST)', () => {
    expect(proofRowLabel({ key: 'proof.net_sales', amount: 1 }, t, false)).toBe('Sales')
    expect(proofRowLabel({ key: 'proof.net_sales', amount: 1 }, t, true)).toBe('Sales before GST')
  })
})

describe('margin (15 Oct feature check: the old Today\'s Profit card showed it)', () => {
  test('profit ÷ sales before GST, from the sheet\'s own lines; none without sales', () => {
    expect(proofMargin({ total: 27, rows: [{ key: 'proof.net_sales', amount: 1010 }, { key: 'proof.cost', amount: -483 }] })!.toFixed(1)).toBe('2.7')
    expect(proofMargin({ total: 0, rows: [] })).toBeNull()
  })
})

describe('line details (5b-3)', () => {
  test('stock: quantity × cost, whole or decimal quantities; nothing without both', () => {
    expect(proofRowDetail({ label: 'Atta', qty: 33, unit: 'pcs', each: 241.5, amount: 7969.5 })).toBe('33 pcs × ₹241.50')
    expect(proofRowDetail({ label: 'Rice', qty: 12.5, unit: 'kg', each: 40, amount: 500 })).toBe('12.5 kg × ₹40')
    expect(proofRowDetail({ label: 'x', amount: 1 })).toBe('')
  })
  test('expenses: the date follows the label', () => {
    expect(proofRowLabel({ label: 'Transport', date: '2026-10-13T06:00:00.000Z', amount: 350 }, t, false)).toBe('Transport · 13 Oct')
  })
})

describe('the count line', () => {
  test('one is singular (local copy, 14 Oct: "1 payments")', () => {
    expect(proofCountLine(1, 'payments', t)).toBe('1 payment')
    expect(proofCountLine(3, 'payments', t)).toBe('3 payments')
    expect(proofCountLine(1, 'bills', t)).toBe('1 bill')
    expect(proofCountLine(10, 'bills', t)).toBe('10 bills')
  })
})

describe('the address', () => {
  test('today sends no dates; a period sends Home\'s own from/to', () => {
    expect(proofUrl({ kind: 'explain', metric: 'sales', scope: 'today', titleKey: 'x' })).toBe('/api/dashboard/explain?metric=sales&scope=today')
    const from = new Date('2026-10-01T00:00:00.000Z')
    const to = new Date('2026-10-14T10:00:00.000Z')
    expect(proofUrl({ kind: 'explain', metric: 'profit', scope: 'range', from, to, titleKey: 'x' }))
      .toBe(`/api/dashboard/explain?metric=profit&scope=range&from=${encodeURIComponent(from.toISOString())}&to=${encodeURIComponent(to.toISOString())}`)
  })
})

describe('Home\'s numbers open the sheet', () => {
  // 5b-2: the Today card (TodayCard.tsx) holds today's figures; the period
  // cards stay in Dashboard.tsx. Both hand a ProofSpec to the one sheet.
  const code = readCode('src/components/dashboard/Dashboard.tsx') + readCode('src/components/dashboard/TodayCard.tsx')
  /** Every sheet a page can open: { kind: 'explain' | 'drawer', … } literals. */
  const specs = (src: string) => [...src.matchAll(/\{ kind: '(explain|drawer)'[^}]*\}/g)].map((m) => m[0])
  test('the reader works on good and bad input', () => {
    expect(specs("onProof({ kind: 'explain', metric: 'got', scope: 'today', shown: kpis.x })")).toHaveLength(1)
    expect(specs('setView(\'sales\')')).toEqual([])
  })
  test('today\'s sales, profit, cash in drawer, udhaar collected, period sales and net profit each open their sheet', () => {
    const all = specs(code).join('\n')
    // 5b-3: the Business overview's five — Sales, Profit (its "after expenses" line
    // replaced the Net profit card), Purchases, Expenses, Stock value.
    for (const m of ["metric: 'sales', scope: 'today'", "metric: 'profit', scope: 'today'", "metric: 'got', scope: 'today'", "kind: 'drawer'",
      "metric: 'sales', scope: 'range'", "metric: 'profit', scope: 'range'", "metric: 'purchases', scope: 'range'", "metric: 'expenses', scope: 'range'", "metric: 'stock'"]) {
      expect({ m, found: all.includes(m) }).toEqual({ m, found: true })
    }
    expect(code).toMatch(/<ProofSheet spec=\{proof\}/)
  })
  test('every period card follows the one period chip (5b plan: "all cards follow the chosen period")', () => {
    const period = specs(code).filter((s) => /scope: 'range'/.test(s))
    expect(period.length).toBeGreaterThanOrEqual(4)
    expect(period.filter((s) => !/from: dateRange\.from, to: dateRange\.to/.test(s))).toEqual([])
    // …and no card on Home is labelled with a fixed period of its own any more.
    expect(code).not.toMatch(/title=\{`\$\{rangeLabel\} Revenue`\}/)
    expect(code).not.toMatch(/t\('dash\.today_revenue'\)/)
  })
  test('each passes the number it shows, so a stale card is refreshed', () => {
    const all = specs(code)
    expect(all.length).toBeGreaterThanOrEqual(7)
    expect(all.filter((o) => !/shown: /.test(o))).toEqual([])
  })
})
