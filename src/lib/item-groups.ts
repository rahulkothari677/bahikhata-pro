/**
 * Phase 7d (#299) — the groups (categories) an item can belong to.
 *
 * A group was free text, so one shop grew "Tea" next to "Tea & coffee",
 * "Personal Care" next to "Personal care", "Oil" next to "Oil & ghee" (the
 * entry study's D-07: junk groups, and a chip strip longer than the list it
 * was meant to shorten). Two things fix it:
 *  - one list to choose from when an item is saved (the shop's own groups
 *    first, then a standard list), so the doubles stop being made;
 *  - findDoubles(): groups that are spelling variants of one another, or a
 *    one- or two-word group inside a bigger one ("Tea" in "Tea & coffee"),
 *    offered for one-tap merging. Only when the target is clear: a group that
 *    could go into two others is not suggested (never a guess).
 *
 * The standard list is for a general shop; the shop-type lists (medical,
 * garments, hardware) arrive with shop profiles in Phase 12.
 */
import { normalise } from './resolve-name'
import { SHOP_WORD_GROUPS } from './shop-words'

export const STANDARD_GROUPS: readonly string[] = [
  'Atta & flour', 'Rice', 'Dal & pulses', 'Oil & ghee', 'Spices & masala', 'Sugar, salt & jaggery',
  'Tea & coffee', 'Biscuits & cookies', 'Snacks & namkeen', 'Dairy & eggs', 'Bread & bakery',
  'Breakfast & noodles', 'Drinks & juices', 'Chocolates & sweets', 'Dry fruits', 'Sauces & pickles',
  'Personal care', 'Cleaning & laundry', 'Household', 'Stationery', 'Loose items', 'Other',
]

/** "No group" as the app stores it. */
export const NO_GROUP = 'Uncategorized'

const STOP = new Set(['and', 'n', 'the', 'of', 'items', 'item'])
// A word stands for its shop-word group ("flour" = "atta"), so "Flour" sits inside "Atta & flour".
const SYN = new Map<string, string>()
for (const g of SHOP_WORD_GROUPS) for (const w of g) SYN.set(normalise(w).replace(/\s+/g, ''), normalise(g[0]).replace(/\s+/g, ''))

/** A group's words, as one spelling: lower case, no "&"/"and", singular, shop words joined. */
export function groupWords(name: string): string[] {
  return normalise(String(name || '').replace(/&/g, ' '))
    .split(/[\s,/]+/)
    .filter((w) => w && !STOP.has(w))
    .map((w) => (w.length > 3 && w.endsWith('s') ? w.slice(0, -1) : w))
    .map((w) => SYN.get(w) ?? w)
}

const keyOf = (name: string) => [...new Set(groupWords(name))].sort().join(' ')

export interface GroupCount { name: string; items: number }
export interface GroupDouble { from: string; into: string; fromItems: number; intoItems: number; why: 'spelling' | 'inside' }

/**
 * Groups that should be one. A spelling variant goes into the one with more
 * items; a small group goes into the ONE bigger group that holds all its words
 * — when two bigger groups hold them, nothing is suggested.
 */
export function findDoubles(groups: readonly GroupCount[]): GroupDouble[] {
  const real = groups.filter((g) => g.name && g.name !== NO_GROUP)
  const out: GroupDouble[] = []
  const used = new Set<string>()
  // 1. Spelling variants: the same words.
  const byKey = new Map<string, GroupCount[]>()
  for (const g of real) byKey.set(keyOf(g.name), [...(byKey.get(keyOf(g.name)) ?? []), g])
  for (const same of byKey.values()) {
    if (same.length < 2) continue
    const [into, ...rest] = [...same].sort((a, b) => b.items - a.items || a.name.localeCompare(b.name))
    for (const r of rest) { out.push({ from: r.name, into: into.name, fromItems: r.items, intoItems: into.items, why: 'spelling' }); used.add(r.name) }
  }
  // 2. A small group inside one bigger group.
  for (const g of real) {
    if (used.has(g.name)) continue
    const words = new Set(groupWords(g.name))
    if (!words.size || words.size > 2) continue
    const holders = real.filter((h) => h.name !== g.name && !used.has(h.name)
      && groupWords(h.name).length > words.size && [...words].every((w) => groupWords(h.name).includes(w)))
    if (holders.length === 1) out.push({ from: g.name, into: holders[0].name, fromItems: g.items, intoItems: holders[0].items, why: 'inside' })
  }
  return out.sort((a, b) => b.intoItems - a.intoItems || a.from.localeCompare(b.from))
}

/** What to offer while a group is typed: the shop's own groups first, then the standard list, no doubles. */
export function groupChoices(shopGroups: readonly string[], typed = ''): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const g of [...shopGroups, ...STANDARD_GROUPS]) {
    if (!g || g === NO_GROUP) continue
    const k = keyOf(g)
    if (seen.has(k)) continue
    seen.add(k)
    out.push(g)
  }
  const t = keyOf(typed)
  if (!t) return out
  const tw = t.split(' ')
  return out.filter((g) => tw.every((w) => groupWords(g).some((gw) => gw.startsWith(w))))
}
