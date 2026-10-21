/**
 * #230 (Phase 6d): the notes a customer is likely to hand over, as one-tap
 * buttons on the Pay sheet.
 *
 * The prototype found that for a ₹16,092 bill the only quick button was
 * "Exact". Customers round up to the notes in their pocket: a ₹282 bill gets
 * ₹290, ₹300 or ₹500; a ₹16,092 bill gets ₹16,100, ₹16,500 or ₹18,000. So the
 * buttons are the bill rounded UP to the next ₹10, ₹100, ₹500 and ₹2,000 —
 * different values only, strictly above the bill ("Exact" covers equal) —
 * topped up with a ₹1,000 step when those collapse into fewer.
 */
import { roundMoney } from './money'

const STEPS = [10, 100, 500, 2000]
const TOP_UP_STEPS = [1000]

export function quickCashNotes(total: number, max = 3): number[] {
  const t = roundMoney(Number(total) || 0)
  if (t <= 0) return []
  const out: number[] = []
  const add = (step: number) => {
    const up = Math.ceil(t / step) * step
    if (up > t && !out.includes(up)) out.push(up)
  }
  STEPS.forEach(add)
  for (const step of TOP_UP_STEPS) { if (out.length >= max) break; add(step) }
  return out.sort((a, b) => a - b).slice(0, max)
}

/**
 * What the shopkeeper hands back (positive) or is still owed (negative) when
 * `given` is paid against `total`, to the paisa.
 */
export function changeFor(total: number, given: number): number {
  return roundMoney((Number(given) || 0) - (Number(total) || 0))
}
