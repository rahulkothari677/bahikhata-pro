/**
 * 🔒 GUARD: the Insights screen helpers lay out the engine's numbers without
 * making any up (Phase 5c-2). No base → no change shown; no sale → an empty
 * calendar cell; the calendar starts on the right weekday in IST.
 */
import { describe, test, expect } from '@jest/globals'
import { calendarCells, changeVsBefore, daysOld, hourLabel, hourWindow, LIVE_SECTIONS } from '@/lib/insights-view'

/** The engine's day keys: naive IST midnights. */
const key = (y: number, m: number, d: number) => new Date(Date.UTC(y, m - 1, d)).toISOString()

describe('change on the period before', () => {
  test('up, down, same — whole percent', () => {
    expect(changeVsBefore(1120, 1000)).toEqual({ dir: 'up', pct: 12 })
    expect(changeVsBefore(880, 1000)).toEqual({ dir: 'down', pct: 12 })
    expect(changeVsBefore(1002, 1000)).toEqual({ dir: 'same', pct: 0 })
  })
  test('nothing to compare with shows nothing — never "↑ ∞%" or "↓ 100%" from a missing base', () => {
    expect(changeVsBefore(500, 0)).toBeNull()
    expect(changeVsBefore(500, -20)).toBeNull()
    expect(changeVsBefore(Number.NaN, 100)).toBeNull()
  })
})

describe('day calendar', () => {
  test('1 Oct 2026 is a Thursday: three blanks, then the days in order, Monday first', () => {
    const days = [1, 2, 3, 4, 5].map((d) => ({ day: key(2026, 10, d), amount: d * 100 }))
    const cells = calendarCells(days)
    expect(cells.slice(0, 3).every((c) => c.day === null)).toBe(true)
    expect(cells.slice(3).map((c) => [c.day, c.weekday])).toEqual([[1, 3], [2, 4], [3, 5], [4, 6], [5, 0]])
  })
  test('levels: no sale is 0; the lowest selling day 1, the highest 4; one value for all → 3', () => {
    const cells = calendarCells([
      { day: key(2026, 10, 5), amount: 0 }, { day: key(2026, 10, 6), amount: 100 },
      { day: key(2026, 10, 7), amount: 550 }, { day: key(2026, 10, 8), amount: 1000 }, { day: key(2026, 10, 9), amount: -40 },
    ]).filter((c) => c.day !== null)
    expect(cells.map((c) => c.level)).toEqual([0, 1, 3, 4, 0])
    expect(calendarCells([{ day: key(2026, 10, 5), amount: 70 }, { day: key(2026, 10, 6), amount: 70 }]).map((c) => c.level)).toEqual([3, 3])
    expect(calendarCells([])).toEqual([])
  })
})

describe('hours and age', () => {
  test('the hours window runs from the first bill to the last; none → empty', () => {
    const hours = Array.from({ length: 24 }, (_, h) => ({ hour: h, perDay: 0, bills: h === 9 || h === 13 ? 2 : 0 }))
    expect(hourWindow(hours).map((h) => h.hour)).toEqual([9, 10, 11, 12, 13])
    expect(hourWindow(hours.map((h) => ({ ...h, bills: 0 })))).toEqual([])
  })
  test('hour labels', () => {
    expect([0, 9, 12, 13, 23].map(hourLabel)).toEqual(['12 am', '9 am', '12 pm', '1 pm', '11 pm'])
  })
  test('days old counts IST calendar days; no unpaid bill is null (an opening balance)', () => {
    const now = new Date('2026-10-19T19:00:00Z') // 00:30 IST on 20 Oct
    expect(daysOld('2026-10-19T17:30:00Z', now)).toBe(1) // 23:00 IST on 19 Oct
    expect(daysOld(null, now)).toBeNull()
    expect(daysOld('not a date', now)).toBeNull()
  })
  test('sections built so far', () => {
    expect([...LIVE_SECTIONS]).toEqual(['sales', 'items', 'customers', 'udhaar'])
  })
})
