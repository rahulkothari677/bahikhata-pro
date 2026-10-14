/**
 * 🔒 GUARD: the trend chart draws every bucket of the period, keyed exactly
 * as the SQL groups (Phase 5b-5). See lib/trend-buckets.ts for the two gaps
 * this closed (14-day cap; weeks that matched only on Sundays).
 */
import { describe, test, expect } from '@jest/globals'
import { sqlBucketKey, trendBuckets } from '@/lib/trend-buckets'
import { readCode } from '@/test-support/read-source'

const ist = (s: string) => new Date(`${s}+05:30`) // an IST wall-clock time

describe('SQL keys (what DATE_TRUNC(unit, istLocal(date)) returns)', () => {
  test('day: the IST date, even for a sale at 00:30 IST (still the previous UTC day)', () => {
    expect(sqlBucketKey(ist('2026-10-02T00:30:00'), 'day')).toBe('2026-10-02T00:00:00.000Z')
    expect(sqlBucketKey(ist('2026-10-02T23:59:00'), 'day')).toBe('2026-10-02T00:00:00.000Z')
  })
  test('week: the Monday of the ISO week; month: the 1st', () => {
    expect(sqlBucketKey(ist('2026-10-14T10:00:00'), 'week')).toBe('2026-10-12T00:00:00.000Z') // Wed → Mon 12 Oct
    expect(sqlBucketKey(ist('2026-10-12T00:10:00'), 'week')).toBe('2026-10-12T00:00:00.000Z') // Mon itself
    expect(sqlBucketKey(ist('2026-10-18T22:00:00'), 'week')).toBe('2026-10-12T00:00:00.000Z') // Sun → same week
    expect(sqlBucketKey(ist('2026-10-01T00:05:00'), 'month')).toBe('2026-10-01T00:00:00.000Z')
  })
})

describe('buckets cover the whole period', () => {
  test('a 31-day month has 31 day bars (was capped at 14)', () => {
    const b = trendBuckets(ist('2026-10-01T00:00:00'), ist('2026-10-31T20:00:00'), 'day')
    expect(b).toHaveLength(31)
    expect(b[0]).toEqual({ key: '2026-10-01T00:00:00.000Z', label: '01 Oct' })
    expect(b[30].key).toBe('2026-10-31T00:00:00.000Z')
  })
  test('every sale in the period lands on a drawn bar, for each unit', () => {
    const from = ist('2026-07-01T00:00:00')
    const to = ist('2026-10-14T15:00:00')
    const sales = [ist('2026-07-01T00:20:00'), ist('2026-08-15T09:00:00'), ist('2026-10-12T00:05:00'), ist('2026-10-14T14:59:00')]
    for (const unit of ['day', 'week', 'month'] as const) {
      const keys = new Set(trendBuckets(from, to, unit).map((x) => x.key))
      expect({ unit, missing: sales.map((s) => sqlBucketKey(s, unit)).filter((k) => !keys.has(k)) }).toEqual({ unit, missing: [] })
    }
  })
  test('the route draws these buckets (no second bucket rule)', () => {
    const route = readCode('src/app/api/dashboard/route.ts')
    expect(route).toMatch(/trendBuckets\(rangeFrom, rangeTo, truncUnit\)/)
    expect(route).not.toMatch(/const maxBuckets = 14/)
  })
})
