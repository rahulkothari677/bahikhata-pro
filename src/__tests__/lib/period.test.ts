/**
 * 🔒 GUARD: a period means the same days however its ends are written
 * (lib/period.ts, shared by Insights and Home's proof sheets).
 *
 * 19 Oct (5c-1): `to=2026-09-30` was read as UTC midnight — 05:30 IST on the
 * 30th — so September lost most of its last day and read ₹1,225 short on a
 * hand check against the raw rows.
 */
import { describe, test, expect } from '@jest/globals'
import { rangeWindow } from '@/lib/period'

const iso = (d: Date | undefined) => d?.toISOString()

describe('rangeWindow', () => {
  test('instants the app sends are taken as they are', () => {
    const w = rangeWindow('2026-08-31T18:30:00.000Z', '2026-09-30T18:29:59.999Z')
    expect([iso(w?.from), iso(w?.to), w?.days]).toEqual(['2026-08-31T18:30:00.000Z', '2026-09-30T18:29:59.999Z', 30])
  })
  test('plain dates are whole Indian days, so both spellings give the same window', () => {
    const plain = rangeWindow('2026-09-01', '2026-09-30')
    const exact = rangeWindow('2026-08-31T18:30:00.000Z', '2026-09-30T18:29:59.999Z')
    expect(plain).toEqual(exact)
    const day = rangeWindow('2026-10-19', '2026-10-19')
    expect([iso(day?.from), iso(day?.to), day?.days]).toEqual(['2026-10-18T18:30:00.000Z', '2026-10-19T18:29:59.999Z', 1])
  })
  test('the period before is as long and ends 1 ms before this one starts', () => {
    const w = rangeWindow('2026-09-01', '2026-09-30')!
    expect(w.prevTo.getTime()).toBe(w.from.getTime() - 1)
    expect(w.to.getTime() - w.from.getTime()).toBe(w.from.getTime() - w.prevFrom.getTime())
  })
  test('refuses what is not a period: junk, an impossible date, from after to', () => {
    expect(rangeWindow('yesterday', '2026-09-30')).toBeNull()
    expect(rangeWindow('2026-02-31', '2026-03-05')).toBeNull()
    expect(rangeWindow('2026-09-30', '2026-09-01')).toBeNull()
  })
})
