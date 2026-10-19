/**
 * Insights screen layout helpers (Phase 5c-2) — pure, so they are tested.
 *
 * The engine (/api/insights) does every sum; these only arrange what it
 * returned for the screen: the change on the period before, the day calendar,
 * the busy-hours window, how old a balance is. Nothing here makes a number up:
 * no base means no change shown, no sale means an empty cell.
 */
import { istDaysBetween } from './insights'

/** The five sections, in chip order (ledger model v4). Profit is left out for staff who may not see it. */
export const LIVE_SECTIONS = ['sales', 'items', 'customers', 'udhaar', 'profit'] as const
export type InsightSection = (typeof LIVE_SECTIONS)[number]

/** The chips a viewer gets: Profit only for those who may see profit (the engine refuses the rest anyway). */
export function visibleSections(hideProfit: boolean): InsightSection[] {
  return LIVE_SECTIONS.filter((s) => !(hideProfit && s === 'profit'))
}

/** Change on the period before, in whole percent. Null when there is nothing to compare with. */
export function changeVsBefore(now: number, before: number): { dir: 'up' | 'down' | 'same'; pct: number } | null {
  if (!(before > 0) || !Number.isFinite(now)) return null
  const pct = Math.round((Math.abs(now - before) / before) * 100)
  return { dir: pct === 0 ? 'same' : now > before ? 'up' : 'down', pct }
}

export interface CalendarCell {
  /** The day's key from the engine; blank cells get 'blank-n'. */
  key: string
  /** Day of the month, or null for a blank before the first day. */
  day: number | null
  /** Monday = 0 … Sunday = 6 (blank cells too). */
  weekday: number
  amount: number
  /** 0 no sale, 1–4 lower to higher. */
  level: 0 | 1 | 2 | 3 | 4
}

/**
 * The day-by-day calendar, Monday first. Keys are the engine's naive IST
 * midnights ("2026-10-02T00:00:00.000Z"), so the UTC fields ARE the IST date.
 * Levels spread the days that sold between the lowest and the highest; a day
 * with no sale (or net returns) is level 0, never a made-up shade.
 */
export function calendarCells(days: { day: string; amount: number }[]): CalendarCell[] {
  if (days.length === 0) return []
  const lead = (new Date(days[0].day).getUTCDay() + 6) % 7
  const sold = days.map((d) => d.amount).filter((a) => a > 0)
  const lo = Math.min(...sold), hi = Math.max(...sold)
  const level = (a: number): CalendarCell['level'] => {
    if (!(a > 0)) return 0
    if (hi === lo) return 3
    return (1 + Math.min(3, Math.floor(((a - lo) / (hi - lo)) * 4))) as CalendarCell['level']
  }
  const blanks: CalendarCell[] = Array.from({ length: lead }, (_, i) => ({ key: `blank-${i}`, day: null, weekday: i, amount: 0, level: 0 }))
  return [...blanks, ...days.map((d) => {
    const at = new Date(d.day)
    return { key: d.day, day: at.getUTCDate(), weekday: (at.getUTCDay() + 6) % 7, amount: d.amount, level: level(d.amount) }
  })]
}

/** The hours worth drawing: from the first hour with a bill to the last. Empty when there were none. */
export function hourWindow<T extends { hour: number; bills: number }>(hours: T[]): T[] {
  const sold = hours.filter((h) => h.bills > 0).map((h) => h.hour)
  if (sold.length === 0) return []
  const first = Math.min(...sold), last = Math.max(...sold)
  return hours.filter((h) => h.hour >= first && h.hour <= last)
}

/** 0 → "12 am", 13 → "1 pm". */
export function hourLabel(h: number): string {
  const n = h % 12 === 0 ? 12 : h % 12
  return `${n} ${h < 12 ? 'am' : 'pm'}`
}

/** Whole IST days since the oldest unpaid bill; null when there is none (an opening balance). */
export function daysOld(oldest: string | Date | null | undefined, now: Date): number | null {
  if (!oldest) return null
  const at = new Date(oldest)
  return Number.isNaN(at.getTime()) ? null : istDaysBetween(at, now)
}
