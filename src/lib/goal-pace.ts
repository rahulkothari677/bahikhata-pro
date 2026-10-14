/**
 * The monthly sales goal as plain arithmetic (Phase 5b-4, ledger model §7).
 *
 * "43% of ₹2,90,000 · 18 days left · ₹9,201 a day needed · so far ₹9,568 a
 * day." Every figure is a division of numbers the shop already has — the
 * month's sales so far, the target, and the calendar. No forecast: the model
 * removed "estimates" on purpose (a prediction dressed as a fact is a hard
 * rule), so "so far" is what happened, and "needed" is what is left divided
 * by the days left.
 *
 * Days are IST calendar days. Today counts as a day already worked ("so far"
 * divides by today's date) and not as a day left ("needed" divides by the
 * days after today), which is how a shopkeeper counts on the 13th: 13 days
 * gone, 18 to go in October.
 */
import { getISTDateParts } from './timezone'
import { roundMoney } from './money'

export interface GoalPace {
  pct: number            // whole percent of the target reached (can pass 100)
  reached: boolean
  daysGone: number       // including today
  daysLeft: number       // after today
  soFarPerDay: number    // achieved ÷ daysGone
  neededPerDay: number   // (target − achieved) ÷ daysLeft; the whole remainder on the last day; 0 once reached
  remaining: number      // target − achieved, never below 0
}

export function goalPace({ target, achieved, now = new Date() }: { target: number; achieved: number; now?: Date }): GoalPace | null {
  if (!(target > 0)) return null
  const { year, month, day } = getISTDateParts(now)
  const daysInMonth = new Date(Date.UTC(year, month + 1, 0)).getUTCDate()
  const daysGone = day
  const daysLeft = daysInMonth - day
  const got = Math.max(0, achieved)
  const remaining = Math.max(0, roundMoney(target - got))
  const reached = got >= target
  return {
    pct: Math.floor((got / target) * 100),
    reached,
    daysGone,
    daysLeft,
    soFarPerDay: roundMoney(got / daysGone),
    neededPerDay: reached ? 0 : roundMoney(remaining / Math.max(daysLeft, 1)),
    remaining,
  }
}
