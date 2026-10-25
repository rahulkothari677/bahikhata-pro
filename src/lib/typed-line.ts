/**
 * Phase 7c step 2d (change C12) — reading what a shopkeeper types in the bill's
 * search box: a name AND an amount, the way it is said at the counter.
 *
 *   toor 400            → Toor Dal, 400 (own unit: 400 g on a kg item)
 *   cheeni 1.25 kilo    → sugar, 1.25 kg
 *   50 rs ka gud        → gud, ₹50 of it
 *   3 parle 10          → 3 × Parle ₹10
 *   parle g 5 wala 23   → 23 × Parle-G ₹5 ("wala" marks the size)
 *
 * This only SPLITS the words. Which item they mean is lib/item-search.ts (the
 * app's one search rule) and lib/typed-pick.ts; how much is lib/loose-entry.ts.
 */
import { UNIT_WORD_GROUPS } from './shop-words'
import type { NextQty, NextUnit } from './loose-entry'

export interface TypedLine {
  /** The text as typed. */
  said: string
  /** The name words — what to search for the item. */
  name: string
  /** Size numbers that belong to the name ("parle g 5 wala": 5). */
  sizes: number[]
  /** A count written before the name ("3 parle 10"). */
  count: number | null
  /** An amount with its unit (400 g, 1.25 kg, ₹50). */
  amount: NextQty | null
  /** A bare number after the name: a size, or a count, or the item's own unit — the item decides. */
  tail: number | null
}

const UNIT_OF = new Map<string, NextUnit>()
UNIT_WORD_GROUPS.forEach((group) => {
  const u: NextUnit | null = group.includes('kg') ? 'kg' : group.includes('g') ? 'g' : group.includes('ml') ? 'ml'
    : group.includes('l') ? 'ltr' : group.includes('pcs') || group.includes('pack') ? 'count' : null
  if (u) group.forEach((w) => UNIT_OF.set(w, u))
})
const RUPEE_WORDS = new Set(['rs', 'rs.', 'rupees', 'rupee', 'rupaye', 'rupay', 'rupiya', 'inr'])
const SIZE_MARK = new Set(['wala', 'wali', 'wale', 'vala', 'waala'])
const KA = new Set(['ka', 'ki', 'ke'])
const NOISE = new Set(['x', '×', 'aur', 'and', 'nos', 'of', 'worth'])

const isNum = (w: string) => /^\d+(\.\d+)?$/.test(w)

export function parseTypedLine(text: string): TypedLine {
  const said = String(text || '').trim()
  const words = said.toLowerCase()
    .replace(/₹\s*(\d)/g, '₹$1')
    .replace(/(\d)(kgs?|kilos?|gms?|grams?|g|mls?|ltrs?|litres?|liters?|l|pcs|pc)\b/g, '$1 $2')
    .split(/[\s,]+/).filter(Boolean)
  const name: string[] = []
  const sizes: number[] = []
  let count: number | null = null
  let amount: NextQty | null = null
  const bare: { n: number; at: number }[] = []
  for (let i = 0; i < words.length; i++) {
    const w = words[i]
    const nextW = words[i + 1]
    if (/^₹\d+(\.\d+)?$/.test(w)) { amount = { n: Number(w.slice(1)), unit: 'rs' }; continue }
    if (RUPEE_WORDS.has(w)) {
      if (isNum(nextW ?? '') && !amount) { amount = { n: Number(nextW), unit: 'rs' }; i++ }
      continue
    }
    if (isNum(w)) {
      const n = Number(w)
      if (nextW && RUPEE_WORDS.has(nextW)) { amount = { n, unit: 'rs' }; i++; if (KA.has(words[i + 1] ?? '')) i++; continue }
      if (nextW && KA.has(nextW)) { amount = { n, unit: 'rs' }; i++; continue }
      if (nextW && UNIT_OF.has(nextW)) { amount = { n, unit: UNIT_OF.get(nextW)! }; i++; continue }
      if (nextW && SIZE_MARK.has(nextW)) { sizes.push(n); i++; continue }
      bare.push({ n, at: name.length })
      continue
    }
    if (NOISE.has(w) || SIZE_MARK.has(w) || KA.has(w)) continue
    name.push(w)
  }
  // A small whole number before any name word is a count ("3 parle 10").
  if (bare.length && bare[0].at === 0 && name.length && Number.isInteger(bare[0].n) && bare[0].n < 100) count = bare.shift()!.n
  // The last bare number after the name is the tail; any between name words is a size ("parle g 5 23").
  const tail = bare.length && bare[bare.length - 1].at === name.length ? bare.pop()!.n : null
  bare.forEach((b) => sizes.push(b.n))
  return { said, name: name.join(' '), sizes, count, amount, tail }
}

/**
 * A whole list in one go: "toor 400, cheeni 1.25 kilo, anda 23" or a pasted
 * WhatsApp message (one item a line). "aur"/"and" between items splits too.
 */
export function splitTypedList(text: string): string[] {
  return String(text || '')
    .split(/[,\n;]+|\s+(?:aur|and|phir)\s+/i)
    .map((s) => s.replace(/^\s*(?:[-•*]|\d+[.)])\s+/, '').trim())
    .filter(Boolean)
}

/** Did the shopkeeper type more than one item? */
export function isTypedList(text: string): boolean {
  return splitTypedList(text).length > 1
}
