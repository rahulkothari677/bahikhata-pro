/**
 * Phase 7c step 2d (change C12) — which item a typed line means (lib/typed-pick.ts),
 * on the big general store with the app's own search (lib/item-search.ts).
 * A line goes straight on only when exactly one item can take it; otherwise a
 * question with choices. Never a guess on the bill.
 */
import { describe, test, expect } from '@jest/globals'
import { bigShopCatalog } from '@/test-support/big-shop-catalog'
import { itemSearch } from '@/lib/item-search'
import { pickTypedLine, teach, learnedId, type LearnedPicks } from '@/lib/typed-pick'

const items = bigShopCatalog().map((c, i) => ({
  id: `p${i}`, name: c.name, category: c.category, unit: c.unit, salePrice: c.price,
  familyId: c.family ? `f:${c.family}` : null, family: c.family ? { id: `f:${c.family}`, name: c.family } : null,
  sizeLabel: c.sizeLabel ?? null, sizeRank: i,
}))
const byId = new Map(items.map((i) => [i.id, i]))
const opts = (learned: LearnedPicks = {}) => ({
  search: (q: string) => itemSearch(items, q, { nameOnly: true }),
  gramsRule: true,
  rupeesToQty: (p: { salePrice: number }, r: number) => Math.round((r / p.salePrice) * 1000) / 1000,
  learned: (k: string) => learnedId(learned, k),
})
const got = (text: string, learned?: LearnedPicks) => {
  const r = pickTypedLine(text, opts(learned))
  if (r.kind === 'add') return `${r.product.name} × ${r.qty}${r.learned ? ' (learned)' : ''}`
  if (r.kind === 'ask') return `ask: ${r.choices.map((c) => c.product.name).slice(0, 3).join(' | ')}${r.choices.length ? '' : '(none)'}`
  return 'none'
}

describe('straight on the bill — exactly one item can take it', () => {
  test('a loose good with an amount: toor 400 = 400 g; cheeni 1.25 kilo; ₹50 of gud; sarson tel 750 ml', () => {
    expect(got('toor 400')).toBe('Toor Dal (loose) × 0.4')
    expect(got('cheeni 1.25 kilo')).toBe('Sugar (loose) × 1.25')
    expect(got('50 rs ka gud')).toBe('Gud (loose) × 0.833')
    expect(got('mustard oil 750 ml')).toBe('Mustard Oil (loose) × 0.75')
  })
  test('a size and a count: parle g 10; 3 parle g 10; parle g 5 wala 23; eggs 23', () => {
    expect(got('parle g 10')).toBe('Parle-G ₹10 × 1')
    expect(got('3 parle g 10')).toBe('Parle-G ₹10 × 3')
    expect(got('parle g 5 wala 23')).toBe('Parle-G ₹5 × 23')
    expect(got('eggs 23')).toBe('Eggs × 23')
  })
  test('the one named in full: tata salt (not Tata Salt Lite)', () => {
    expect(got('tata salt')).toBe('Tata Salt 1 kg × 1')
  })
})

describe('a question, never a guess', () => {
  test('dal 400: which dal? — the loose dals, each at 400 g', () => {
    const r = pickTypedLine('dal 400', opts())
    expect(r.kind).toBe('ask')
    if (r.kind !== 'ask') return
    expect(r.choices.slice(0, 3).every((c) => c.product.name.endsWith('Dal (loose)') && c.qty === 0.4)).toBe(true)
  })
  test('maggi 2: which pack? lays 10: which flavour? — never Lays Magic Masala from a spelling guess', () => {
    expect(got('maggi 2')).toMatch(/^ask: Maggi Noodles ₹14 \| Maggi Noodles 4-pack/)
    expect(got('lays 10')).toMatch(/^ask: Lays /)
  })
  test('a misspelling is asked, even with a real size: "lays magik masala 20"', () => {
    expect(got('lays magik masala 20')).toMatch(/^ask: Lays Magic Masala ₹20 \|/)
  })
  test('nothing matches: an empty question (the card offers a one-off line)', () => {
    expect(got('carry bag')).toBe('ask: (none)')
  })
  test('a weight on a packet is never forced (pack sizes: change C13)', () => {
    const r = pickTypedLine('parle g 400 g', opts())
    expect(r.kind).toBe('ask')
  })
})

describe('learning a pick made twice', () => {
  test('after the same pick twice, "maggi 2" goes straight on — and only while that item matches', () => {
    const maggi14 = items.find((i) => i.name === 'Maggi Noodles ₹14')!.id
    let picks: LearnedPicks = {}
    let r = teach(picks, 'maggi', maggi14); picks = r.picks
    expect(r.learnedNow).toBe(false)
    expect(got('maggi 2', picks)).toMatch(/^ask/)
    r = teach(picks, 'maggi', maggi14); picks = r.picks
    expect(r.learnedNow).toBe(true)
    expect(got('maggi 2', picks)).toBe('Maggi Noodles ₹14 × 2 (learned)')
    expect(got('maggi 8 pack', picks)).not.toBe('Maggi Noodles ₹14 × 1 (learned)')
  })
  test('a different pick starts again', () => {
    const a = items.find((i) => i.name === 'Maggi Noodles ₹14')!.id
    const b = items.find((i) => i.name === 'Maggi Noodles 4-pack')!.id
    let p = teach({}, 'maggi', a).picks
    p = teach(p, 'maggi', b).picks
    expect(learnedId(p, 'maggi')).toBeNull()
    expect(byId.get(p.maggi.id)!.name).toBe('Maggi Noodles 4-pack')
  })
})
