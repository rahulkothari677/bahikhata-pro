/**
 * Phase 7b (#293) — sizes of one brand: reading them, ordering them, and
 * suggesting which items are sizes of one another.
 *
 * Shops write the size at the END of the name: "Aashirvaad Atta 5 kg",
 * "Parle-G ₹10", "Fortune Sunflower Oil 15 L tin", "Lifebuoy Soap Pack of 4".
 * Sorted as text that gives "1 kg, 10 kg, 5 kg" and "1000g, 100g, 250g" (the
 * entry study's D-08 and D-17). Here a size is read once into a kind and a
 * number, so a brand's sizes always run small to large: 50 g, 100 g, 1 kg;
 * ₹5, ₹10, ₹20; S, M, L, XL.
 *
 * SUGGEST, NEVER DECIDE. suggestFamilies() only proposes ("these 4 look like
 * sizes of Parle-G"); nothing is grouped until the shop taps Yes. A guess that
 * is wrong costs one "Not now", never a wrong bill.
 */

export type SizeKind = 'price' | 'weight' | 'volume' | 'count' | 'apparel' | 'power' | 'pages'

export interface ParsedSize {
  /** The name without its size: "Aashirvaad Atta". */
  base: string
  /** The size as written, tidied: "5 kg", "₹10", "Pack of 4", "15 L tin". */
  label: string
  kind: SizeKind
  /** Grams, ml, rupees, pieces… — compared only within one kind. */
  value: number
}

const UNIT: Record<string, { kind: SizeKind; per: number; show: string }> = {
  g: { kind: 'weight', per: 1, show: 'g' }, gm: { kind: 'weight', per: 1, show: 'g' }, gms: { kind: 'weight', per: 1, show: 'g' },
  gram: { kind: 'weight', per: 1, show: 'g' }, grams: { kind: 'weight', per: 1, show: 'g' },
  kg: { kind: 'weight', per: 1000, show: 'kg' }, kgs: { kind: 'weight', per: 1000, show: 'kg' }, kilo: { kind: 'weight', per: 1000, show: 'kg' },
  ml: { kind: 'volume', per: 1, show: 'ml' },
  l: { kind: 'volume', per: 1000, show: 'L' }, lt: { kind: 'volume', per: 1000, show: 'L' }, ltr: { kind: 'volume', per: 1000, show: 'L' },
  litre: { kind: 'volume', per: 1000, show: 'L' }, liter: { kind: 'volume', per: 1000, show: 'L' },
  pcs: { kind: 'count', per: 1, show: 'pcs' }, pc: { kind: 'count', per: 1, show: 'pcs' }, pieces: { kind: 'count', per: 1, show: 'pcs' },
  tabs: { kind: 'count', per: 1, show: 'tablets' }, tablets: { kind: 'count', per: 1, show: 'tablets' },
  pack: { kind: 'count', per: 1, show: 'pack' }, packs: { kind: 'count', per: 1, show: 'pack' },
  w: { kind: 'power', per: 1, show: 'W' }, watt: { kind: 'power', per: 1, show: 'W' },
  pages: { kind: 'pages', per: 1, show: 'pages' },
}
const APPAREL = ['xxs', 'xs', 's', 'm', 'l', 'xl', 'xxl', 'xxxl']
/** Words that may follow a size and belong to it: "15 L tin", "1 kg pouch". */
const CONTAINERS = 'tin|jar|pouch|bottle|box|bag|sack|can|packet|pkt|refill|sachet'

const num = (s: string) => Number(s.replace(',', '.'))

/** The size at the end of an item's name, or null when there is none ("Sugar (loose)"). */
export function parseSize(name: string): ParsedSize | null {
  const n = String(name || '').trim().replace(/\s+/g, ' ')
  if (!n) return null
  const tries: Array<[RegExp, (m: RegExpMatchArray) => Omit<ParsedSize, 'base'> | null]> = [
    // ₹10, ₹ 10, ₹10 pack, Rs 10
    [/\s(?:₹|rs\.?\s?)\s?(\d+(?:\.\d+)?)(?:\s?pack)?$/i, (m) => ({ label: `₹${num(m[1])}`, kind: 'price', value: num(m[1]) })],
    // Pack of 4, Tray of 30, Box of 12
    [/\s(pack|tray|box|set) of (\d+)$/i, (m) => ({ label: `${m[1][0].toUpperCase()}${m[1].slice(1).toLowerCase()} of ${m[2]}`, kind: 'count', value: num(m[2]) })],
    // 4 pack, 8-pack, 10 pcs, 15 tablets, 9 W, 172 pages
    [new RegExp(`\\s(\\d+)\\s?-?\\s?(pack|packs|pcs|pc|pieces|tabs|tablets|w|watt|pages)$`, 'i'),
      (m) => { const u = UNIT[m[2].toLowerCase()]; return { label: `${m[1]} ${u.show}`, kind: u.kind, value: num(m[1]) } }],
    // 5 kg, 500g, 1.5 L, 15 L tin, 1 kg pouch
    [new RegExp(`\\s(\\d+(?:[.,]\\d+)?)\\s?(g|gm|gms|grams?|kgs?|kilo|ml|l|lt|ltr|litre|liter)(?:\\s(${CONTAINERS}))?$`, 'i'),
      (m) => { const u = UNIT[m[2].toLowerCase()]; return { label: `${num(m[1])} ${u.show}${m[3] ? ` ${m[3].toLowerCase()}` : ''}`, kind: u.kind, value: num(m[1]) * u.per } }],
    // S, M, L, XL (garments)
    [new RegExp(`\\s(${APPAREL.join('|')})$`, 'i'), (m) => ({ label: m[1].toUpperCase(), kind: 'apparel', value: APPAREL.indexOf(m[1].toLowerCase()) })],
  ]
  for (const [re, make] of tries) {
    const m = n.match(re)
    if (!m || m.index === undefined) continue
    const base = n.slice(0, m.index).replace(/[\s\-–,·]+$/, '').trim()
    const size = make(m)
    if (!size || !base) continue
    return { base, ...size }
  }
  return null
}

const KIND_ORDER: SizeKind[] = ['price', 'weight', 'volume', 'count', 'apparel', 'power', 'pages']

/**
 * A number that orders a brand's sizes: by kind first (packs priced ₹10 before
 * weighed ones), then small to large. Null for a size it cannot read; those go
 * last, by label.
 */
export function sizeRank(label: string | null | undefined): number | null {
  if (!label) return null
  const p = parseSize(`x ${label}`)
  if (!p) return null
  return KIND_ORDER.indexOf(p.kind) * 1e9 + p.value
}

/** Sizes of one brand in order (for the Items screen and the bill picker). */
export function bySize<T extends { sizeRank?: number | null; sizeLabel?: string | null; name: string }>(a: T, b: T): number {
  const ra = a.sizeRank ?? null
  const rb = b.sizeRank ?? null
  if (ra !== null && rb !== null && ra !== rb) return ra - rb
  if (ra !== null && rb === null) return -1
  if (ra === null && rb !== null) return 1
  return (a.sizeLabel || a.name).localeCompare(b.sizeLabel || b.name)
}

const baseKey = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim()

export interface FamilySuggestion {
  name: string
  members: { id: string; name: string; sizeLabel: string; sizeRank: number | null }[]
}

/**
 * Items that look like sizes of one brand: the same name once the size at the
 * end is taken off, two or more of them, each with a DIFFERENT size. Two items
 * with the same size are left out — that is a duplicate (entry study D-02),
 * not a family, and grouping it would hide the problem.
 */
export function suggestFamilies(items: readonly { id: string; name: string; familyId?: string | null }[]): FamilySuggestion[] {
  const groups = new Map<string, { names: string[]; members: FamilySuggestion['members'] }>()
  for (const it of items) {
    if (it.familyId) continue
    const p = parseSize(it.name)
    if (!p) continue
    const key = baseKey(p.base)
    const g = groups.get(key) ?? { names: [], members: [] }
    g.names.push(p.base)
    g.members.push({ id: it.id, name: it.name, sizeLabel: p.label, sizeRank: sizeRank(p.label) })
    groups.set(key, g)
  }
  const out: FamilySuggestion[] = []
  for (const g of groups.values()) {
    if (g.members.length < 2) continue
    const labels = g.members.map((m) => m.sizeLabel.toLowerCase())
    if (new Set(labels).size !== labels.length) continue
    // The brand written the way most of its items write it.
    const counts = new Map<string, number>()
    for (const nm of g.names) counts.set(nm, (counts.get(nm) ?? 0) + 1)
    const name = [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0][0]
    out.push({ name, members: [...g.members].sort((a, b) => bySize({ ...a, name: a.name }, { ...b, name: b.name })) })
  }
  return out.sort((a, b) => b.members.length - a.members.length || a.name.localeCompare(b.name))
}
