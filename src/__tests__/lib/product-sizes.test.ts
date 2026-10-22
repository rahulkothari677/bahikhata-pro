/**
 * Phase 7b (#293) — reading a brand's sizes, ordering them, suggesting groups.
 */
import { describe, test, expect } from '@jest/globals'
import { parseSize, sizeRank, bySize, suggestFamilies } from '@/lib/product-sizes'

describe('the size at the end of a name', () => {
  test.each([
    ['Aashirvaad Atta 5 kg', 'Aashirvaad Atta', '5 kg'],
    ['Fortune Chakki Atta 5kg', 'Fortune Chakki Atta', '5 kg'],
    ['Parle-G ₹10', 'Parle-G', '₹10'],
    ['Parle-G ₹ 5', 'Parle-G', '₹5'],
    ['Parle-G Rs 20', 'Parle-G', '₹20'],
    ['MDH Haldi Powder 100 gm', 'MDH Haldi Powder', '100 g'],
    ['Fortune Sunflower Oil 15 L tin', 'Fortune Sunflower Oil', '15 L tin'],
    ['Amul Taaza 500 ml', 'Amul Taaza', '500 ml'],
    ['Pepsi 1.5 L', 'Pepsi', '1.5 L'],
    ['Lifebuoy Soap Pack of 4', 'Lifebuoy Soap', 'Pack of 4'],
    ['Maggi Masala Noodles 4 pack', 'Maggi Masala Noodles', '4 pack'],
    ['Philips LED Bulb 9 W', 'Philips LED Bulb', '9 W'],
    ['Classmate Notebook 172 pages', 'Classmate Notebook', '172 pages'],
    ['Cotton Shirt Classic XL', 'Cotton Shirt Classic', 'XL'],
  ])('%s → %s + %s', (name, base, label) => {
    expect(parseSize(name)).toMatchObject({ base, label })
  })
  test('no size, no guess', () => {
    expect(parseSize('Sugar (loose)')).toBeNull()
    expect(parseSize('Toor Dal')).toBeNull()
    expect(parseSize('₹10')).toBeNull() // nothing left as the brand
    expect(parseSize('')).toBeNull()
  })
})

describe('sizes run small to large, never as text', () => {
  test('1 kg after 100 g; ₹50 after ₹5; 1.5 L after 750 ml; XL after M', () => {
    const order = (labels: string[]) => labels.map((l) => ({ name: l, sizeLabel: l, sizeRank: sizeRank(l) })).sort(bySize).map((x) => x.sizeLabel)
    expect(order(['1 kg', '100 g', '50 g', '500 g', '10 kg'])).toEqual(['50 g', '100 g', '500 g', '1 kg', '10 kg'])
    expect(order(['₹50', '₹5', '₹20', '₹10'])).toEqual(['₹5', '₹10', '₹20', '₹50'])
    expect(order(['1.5 L', '750 ml', '2 L', '250 ml'])).toEqual(['250 ml', '750 ml', '1.5 L', '2 L'])
    expect(order(['XL', 'S', 'M', 'L'])).toEqual(['S', 'M', 'L', 'XL'])
  })
  test('a brand sold by price packs and by weight: packs first, then weights; unreadable sizes last', () => {
    const items = ['600 g', '₹10', 'Family pack', '200 g'].map((l) => ({ name: l, sizeLabel: l, sizeRank: sizeRank(l) }))
    expect(items.sort(bySize).map((x) => x.sizeLabel)).toEqual(['₹10', '200 g', '600 g', 'Family pack'])
    // By kind first, not by the bare number: a ₹200 pack still comes before 100 g.
    const mixed = ['100 g', '₹200'].map((l) => ({ name: l, sizeLabel: l, sizeRank: sizeRank(l) }))
    expect(mixed.sort(bySize).map((x) => x.sizeLabel)).toEqual(['₹200', '100 g'])
  })
})

describe('suggesting which items are sizes of one brand', () => {
  let n = 0
  const it = (name: string, familyId: string | null = null) => ({ id: `p${++n}`, name, familyId })
  const shop = [
    it('Parle-G ₹20'), it('Parle-G ₹5'), it('Parle-G ₹50'), it('Parle-G ₹10'),
    it('Aashirvaad Atta 10 kg'), it('Aashirvaad Atta 1 kg'), it('Aashirvaad Atta 5 kg'),
    it('MDH Haldi Powder 100 g'), it('Everest Haldi Powder 100 g'),
    it('Tata Tea Gold 250 g'), it('Tata Tea Premium 250 g'),
    it('Sugar (loose)'),
    it('Oreo ₹10'), it('Oreo ₹10'), // the same size twice: a duplicate, not a family
    it('Lays Magic Masala ₹10', 'fam1'), it('Lays Magic Masala ₹20'), // one already grouped
  ]
  const s = suggestFamilies(shop)
  test('brands with two or more different sizes, sizes in order, biggest groups first', () => {
    expect(s.map((g) => g.name)).toEqual(['Parle-G', 'Aashirvaad Atta'])
    expect(s[0].members.map((m) => m.sizeLabel)).toEqual(['₹5', '₹10', '₹20', '₹50'])
    expect(s[1].members.map((m) => m.sizeLabel)).toEqual(['1 kg', '5 kg', '10 kg'])
  })
  test('different brands of one thing are never one family (MDH vs Everest; Tata Gold vs Premium)', () => {
    expect(s.find((g) => /haldi|tata/i.test(g.name))).toBeUndefined()
  })
  test('duplicates and already-grouped items are left out', () => {
    expect(s.find((g) => g.name === 'Oreo')).toBeUndefined()
    expect(s.find((g) => /lays/i.test(g.name))).toBeUndefined()
  })
  test('the brand is written the way most of its items write it', () => {
    const mixed = suggestFamilies([it('Good Day ₹10'), it('Good Day ₹20'), it('good day ₹30')])
    expect(mixed[0].name).toBe('Good Day')
  })
})
