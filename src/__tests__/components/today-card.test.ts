/**
 * 🔒 GUARD: the Today card and To collect / To pay (Phase 5b-2).
 *
 * - "from 12 customers" counts the same parties the ₹ total adds (balance > 0),
 *   so the count and the rupees cannot describe different people.
 * - "Same time last Wednesday" is one window for Home and its proof sheet.
 * - Cash in drawer on Home, in its sheet and in the Close-the-day dialog is one
 *   query (useDaySummary), so the three cannot show different figures.
 */
import { describe, test, expect, jest } from '@jest/globals'

jest.mock('sonner', () => ({ toast: { info: jest.fn(), success: jest.fn(), error: jest.fn() } }))

import { partiesLine } from '@/components/dashboard/TodayCard'
import { sameTimeLastWeek, istDayStart } from '@/lib/timezone'
import { translations } from '@/lib/i18n'
import { readCode } from '@/test-support/read-source'

const en = translations.en as unknown as Record<string, string>
const hi = translations.hi as unknown as Record<string, string>
const t = (k: string) => en[k] ?? k

describe('parties line', () => {
  test('none / one / many, both sides', () => {
    expect(partiesLine(0, 'customer', t)).toBe('Nobody owes you')
    expect(partiesLine(1, 'customer', t)).toBe('from 1 customer')
    expect(partiesLine(12, 'customer', t)).toBe('from 12 customers')
    expect(partiesLine(0, 'supplier', t)).toBe('You owe nobody')
    expect(partiesLine(1, 'supplier', t)).toBe('to 1 supplier')
    expect(partiesLine(3, 'supplier', t)).toBe('to 3 suppliers')
  })
  test('every Today word exists in English and Hindi', () => {
    const keys = Object.keys(en).filter((k) => k.startsWith('today.'))
    expect(keys.length).toBeGreaterThanOrEqual(13)
    expect(keys.filter((k) => !hi[k])).toEqual([])
  })
})

describe('same time last week', () => {
  test('IST midnight a week ago to this time a week ago', () => {
    const now = new Date('2026-10-14T08:00:00.000Z') // 13:30 IST, Wednesday
    const w = sameTimeLastWeek(now)
    expect(w.to.toISOString()).toBe('2026-10-07T08:00:00.000Z')
    expect(w.from.toISOString()).toBe(new Date(istDayStart(now).getTime() - 7 * 86_400_000).toISOString())
    expect(w.from.toISOString()).toBe('2026-10-06T18:30:00.000Z') // 7 Oct 00:00 IST
  })
  test('Home and the proof sheet both use it', () => {
    expect(readCode('src/app/api/dashboard/route.ts')).toMatch(/sameTimeLastWeek\(now\)/)
    expect(readCode('src/app/api/dashboard/explain/route.ts')).toMatch(/sameTimeLastWeek\(now\)/)
  })
})

describe('one definition each', () => {
  test('the counts and the rupees come from the same parties (#261: khataSides, by who the party is)', () => {
    const route = readCode('src/app/api/dashboard/route.ts')
    // One group per card: its amount and its count, never two separate loops that could drift.
    expect(route).toMatch(/const totalReceivable = sides\.collect\.amount\s*const totalPayable = sides\.pay\.amount\s*const receivableCount = sides\.collect\.count\s*const payableCount = sides\.pay\.count/)
    // …and the group's amount and count are worked out from one list of parties.
    expect(readCode('src/lib/khata-list.ts')).toMatch(/return \{ amount: parties\.reduce\([^)]*\)[^}]*count: parties\.length, parties \}/)
  })
  test('cash in drawer: Home, its sheet and the Close-the-day dialog read useDaySummary', () => {
    for (const f of ['src/components/dashboard/Dashboard.tsx', 'src/components/dashboard/ProofSheet.tsx', 'src/components/dashboard/DayEndSummary.tsx']) {
      const code = readCode(f)
      expect({ f, shared: /useDaySummary\(/.test(code), own: /queryKey: \['day-summary'/.test(code) }).toEqual({ f, shared: true, own: false })
    }
  })
})
