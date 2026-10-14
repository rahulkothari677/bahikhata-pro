/**
 * 🔒 GUARD: the "how is this worked out?" sheet reads its lines right and
 * Home's numbers open it (Phase 5b-1).
 */
import { describe, test, expect, jest } from '@jest/globals'

jest.mock('sonner', () => ({ toast: { info: jest.fn(), success: jest.fn(), error: jest.fn() } }))

import { proofCountLine, proofRowLabel, proofUrl } from '@/components/dashboard/ProofSheet'
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

describe('the count line', () => {
  test('one is singular (local copy, 14 Oct: "1 payments")', () => {
    expect(proofCountLine(1, true, t)).toBe('1 payment')
    expect(proofCountLine(3, true, t)).toBe('3 payments')
    expect(proofCountLine(1, false, t)).toBe('1 bill')
    expect(proofCountLine(10, false, t)).toBe('10 bills')
  })
})

describe('the address', () => {
  test('today sends no dates; a period sends Home\'s own from/to', () => {
    expect(proofUrl({ kind: 'explain', metric: 'sales', scope: 'today', titleKey: 'x' })).toBe('/api/dashboard/explain?metric=sales&scope=today')
    const from = new Date('2026-10-01T00:00:00.000Z')
    const to = new Date('2026-10-14T10:00:00.000Z')
    expect(proofUrl({ kind: 'explain', metric: 'netProfit', scope: 'range', from, to, titleKey: 'x' }))
      .toBe(`/api/dashboard/explain?metric=netProfit&scope=range&from=${encodeURIComponent(from.toISOString())}&to=${encodeURIComponent(to.toISOString())}`)
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
    for (const m of ["metric: 'sales', scope: 'today'", "metric: 'profit', scope: 'today'", "metric: 'sales', scope: 'range'", "metric: 'netProfit', scope: 'range'", "metric: 'got', scope: 'today'", "kind: 'drawer'"]) {
      expect({ m, found: all.includes(m) }).toEqual({ m, found: true })
    }
    expect(code).toMatch(/<ProofSheet spec=\{proof\}/)
  })
  test('each passes the number it shows, so a stale card is refreshed', () => {
    const all = specs(code)
    expect(all.length).toBeGreaterThanOrEqual(7)
    expect(all.filter((o) => !/shown: /.test(o))).toEqual([])
  })
})
