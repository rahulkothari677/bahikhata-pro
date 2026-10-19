/**
 * How long stock has sat unsold — one rule for the Inventory Aging report and
 * Insights → Items (Phase 5c-4).
 *
 * An item's age is the days since it last sold; an item that never sold is
 * aged from the day it was added, so a product added last week is not "not
 * sold in 90 days". 90 days or more is dead stock.
 *
 * Found 19 Oct: the report aged stock by the item's created date — and the
 * stock data never even carried that date, so every item read "Fresh" and the
 * Dead Stock bucket was always empty, while searching "dead stock" led there.
 * Insights counted "no sale in 90 days" without the added-date rule. Three
 * places, one fact; now one rule.
 */
export const SLOW_DAYS = 30
export const DEAD_DAYS = 90
const DAY_MS = 86_400_000

export type AgeBucket = 'fresh' | 'slow' | 'dead'

/** Whole days since the item last sold (or was added, if it never sold); null when neither date is known. */
export function stockAgeDays(lastSoldAt: string | Date | null | undefined, createdAt: string | Date | null | undefined, now: Date): number | null {
  const from = lastSoldAt ?? createdAt
  if (!from) return null
  const t = new Date(from).getTime()
  if (Number.isNaN(t)) return null
  return Math.max(0, Math.floor((now.getTime() - t) / DAY_MS))
}

export function ageBucket(days: number | null): AgeBucket | null {
  if (days === null) return null
  return days >= DEAD_DAYS ? 'dead' : days >= SLOW_DAYS ? 'slow' : 'fresh'
}
