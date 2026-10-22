/**
 * Phase 7a (#296) — one item search that understands a shop.
 * Measured before: on a 341-item shop, after three letters the wanted item was
 * on screen for 55% of items; "atta" listed Kurkure Chilli Chatka; "aata" and
 * "cheeni" found nothing.
 */
import { describe, test, expect } from '@jest/globals'
import { itemSearch, itemMatches, shownOf } from '@/lib/item-search'

let n = 0
const item = (name: string, category: string | null, salePrice: number, extra: Record<string, string> = {}) =>
  ({ id: `p${++n}`, name, category, salePrice, ...extra })

const CATALOG = [
  item('Parle-G ₹5', 'Biscuits', 5), item('Parle-G ₹10', 'Biscuits', 10), item('Parle-G ₹20', 'Biscuits', 20), item('Parle-G ₹50', 'Biscuits', 50),
  item('Parle Monaco ₹10', 'Biscuits', 10), item('Britannia Good Day ₹10', 'Biscuits', 10), item('Oreo ₹30', 'Biscuits', 30),
  item('Aashirvaad Atta 1 kg', 'Atta & flour', 55), item('Aashirvaad Atta 5 kg', 'Atta & flour', 255), item('Fortune Chakki Atta 5kg', 'Atta & flour', 240),
  item('Kurkure Chilli Chatka ₹10', 'Snacks', 10), item('Lays Magic Masala ₹20', 'Snacks', 20),
  item('Sugar (loose)', 'Sugar, salt & loose', 44), item('Tata Salt 1kg', 'Sugar, salt & loose', 28),
  item('MDH Haldi Powder 100 g', 'Spices', 42), item('Everest Haldi Powder 100 gm', 'Spices', 44), item('MDH Garam Masala 50g', 'Spices', 38),
  item('Fortune Sunflower Oil 1 L', 'Oil & ghee', 155), item('Amul Taaza 500 ml', 'Dairy', 28),
  item('Tata Tea Premium 250 g', 'Tea & coffee', 120), item('Surf Excel Easy Wash 1 kg', 'Cleaning', 145, { barcode: '8901030865278' }),
  item('Toor Dal (loose)', 'Pulses', 140, { sku: 'TD-01' }), item('Eggs 1 egg', 'Dairy', 7, { hsn: '0407' }),
]
const names = (q: string, opts?: Parameters<typeof itemSearch>[2]) => itemSearch(CATALOG, q, opts).items.map((i) => i.name)

describe('every typed word starts a word of the item, in any order', () => {
  test('"atta" finds the attas and never Kurkure Chilli Chatka', () => {
    const r = names('atta')
    expect(r).toEqual(expect.arrayContaining(['Aashirvaad Atta 1 kg', 'Aashirvaad Atta 5 kg', 'Fortune Chakki Atta 5kg']))
    expect(r).not.toContain('Kurkure Chilli Chatka ₹10')
  })
  test('any order: "atta aash" and "aash atta" find Aashirvaad', () => {
    expect(names('atta aash').slice(0, 2)).toEqual(['Aashirvaad Atta 1 kg', 'Aashirvaad Atta 5 kg'])
    expect(names('aash atta').slice(0, 2)).toEqual(['Aashirvaad Atta 1 kg', 'Aashirvaad Atta 5 kg'])
  })
  test('every word must match: "atta fortune 5" is one item', () => {
    expect(names('atta fortune 5')).toEqual(['Fortune Chakki Atta 5kg'])
  })
})

describe('the way shopkeepers spell', () => {
  test('aata = atta; ashirwad = aashirvaad; prefixes while typing still work', () => {
    expect(names('aata')).toEqual(expect.arrayContaining(['Aashirvaad Atta 5 kg']))
    expect(names('ashirwad')).toEqual(['Aashirvaad Atta 1 kg', 'Aashirvaad Atta 5 kg'])
    expect(names('aash')).toEqual(['Aashirvaad Atta 1 kg', 'Aashirvaad Atta 5 kg'])
    expect(names('pa')).toEqual(expect.arrayContaining(['Parle-G ₹10']))
  })
  test('shop words: cheeni → Sugar, namak → Salt, chai → Tea, doodh → milk only if named so', () => {
    // The named item first; items whose GROUP says sugar/salt ("Sugar, salt & loose") follow, ranked below.
    expect(names('cheeni')[0]).toBe('Sugar (loose)')
    expect(names('chini')[0]).toBe('Sugar (loose)')
    expect(names('namak')[0]).toBe('Tata Salt 1kg')
    expect(names('chai')).toEqual(['Tata Tea Premium 250 g'])
    expect(names('haldi').sort()).toEqual(['Everest Haldi Powder 100 gm', 'MDH Haldi Powder 100 g'])
    // Folded, "good" and "gud" (jaggery) are the same letters — "good" must never mean jaggery.
    const withGud = [...CATALOG, item('Gud (jaggery) 1 kg', 'Sugar, salt & loose', 70)]
    expect(itemSearch(withGud, 'good').items.map((i) => i.name)).toEqual(['Britannia Good Day ₹10'])
    expect(itemSearch(withGud, 'gud').items[0].name).toBe('Gud (jaggery) 1 kg')
  })
  test('Hindi script: चीनी finds Sugar, नमक finds Salt', () => {
    expect(names('चीनी')[0]).toBe('Sugar (loose)')
    expect(names('नमक')[0]).toBe('Tata Salt 1kg')
  })
  test('a word typed as one piece: "parleg" finds Parle-G', () => {
    expect(names('parleg')).toEqual(expect.arrayContaining(['Parle-G ₹10', 'Parle-G ₹5']))
    expect(names('parleg')).not.toContain('Parle Monaco ₹10')
  })
})

describe('numbers, units, prices and codes', () => {
  test('"parle 10" is the ₹10 pack first; "10" alone finds the ₹10 items', () => {
    expect(names('parle 10')[0]).toBe('Parle-G ₹10')
    expect(names('10')).toEqual(expect.arrayContaining(['Parle-G ₹10', 'Parle Monaco ₹10', 'Kurkure Chilli Chatka ₹10']))
    expect(names('₹10')).toEqual(names('10'))
    expect(names('rs 10')).toEqual(names('10'))
  })
  test('units written any way: "haldi 100g" finds both 100 g and 100 gm', () => {
    expect(names('haldi 100g').sort()).toEqual(['Everest Haldi Powder 100 gm', 'MDH Haldi Powder 100 g'])
    expect(names('tata salt 1 kg')).toEqual(['Tata Salt 1kg'])
    expect(names('masala 50 gms')).toEqual(['MDH Garam Masala 50g'])
  })
  test('a barcode or code finds its item first; an HSN still finds its items', () => {
    expect(names('8901030865278')).toEqual(['Surf Excel Easy Wash 1 kg'])
    expect(names('td-01')).toEqual(['Toor Dal (loose)'])
    expect(names('0407')).toEqual(['Eggs 1 egg'])
  })
})

describe('the group (category) counts, below the name', () => {
  test('"biscuit" finds every biscuit; a name match still ranks above a group-only match', () => {
    const r = names('biscuit')
    expect(r).toHaveLength(7)
    const mixed = [...CATALOG, item('Biscuit Tin (empty)', 'Household', 60)]
    expect(itemSearch(mixed, 'biscuit').items[0].name).toBe('Biscuit Tin (empty)')
  })
})

describe('ranking, boost and close matches', () => {
  test('a whole word beats the start of a longer one: "haldi" is MDH Haldi before Haldiram\'s', () => {
    const shop = [item("Haldiram's Aloo Bhujia 200 g", 'Snacks', 52), item('MDH Haldi Powder 100 g', 'Spices', 42)]
    expect(itemSearch(shop, 'haldi').items.map((i) => i.name)).toEqual(['MDH Haldi Powder 100 g', "Haldiram's Aloo Bhujia 200 g"])
  })
  test("the shop's often-sold item comes first among equals", () => {
    const boosted = CATALOG.find((i) => i.name === 'Parle-G ₹20')!
    expect(names('parle-g', { boost: new Map([[boosted.id, 1]]) })[0]).toBe('Parle-G ₹20')
  })
  test('nothing found → one-letter-off close matches, marked as close', () => {
    const r = itemSearch(CATALOG, 'parel')
    expect(r.close).toBe(true)
    expect(r.items.map((i) => i.name)).toEqual(expect.arrayContaining(['Parle-G ₹10']))
    expect(itemSearch(CATALOG, 'parle').close).toBe(false)
    expect(itemSearch(CATALOG, 'zzzz')).toEqual({ items: [], total: 0, close: false })
    // A shop word spelt right finds nothing in a shop without it — never a look-alike.
    const noSugar = CATALOG.filter((i) => !/sugar|salt/i.test(`${i.name} ${i.category}`))
    expect(itemSearch(noSugar, 'cheeni')).toEqual({ items: [], total: 0, close: false })
    // A close match keeps the first two letters: "chinic" is not "Clinic Plus".
    expect(itemSearch([item('Clinic Plus Shampoo 80 ml', 'Personal care', 60)], 'chinic').total).toBe(0)
    expect(itemSearch([item('Clinic Plus Shampoo 80 ml', 'Personal care', 60)], 'clinik').total).toBe(1)
    // ...and "salt" is not "Salted" chips.
    expect(itemSearch([item('Lays Classic Salted ₹10', 'Snacks', 10)], 'namak').total).toBe(0)
  })
  test('every match is returned with its total; callers say "8 of 52"', () => {
    const r = itemSearch(CATALOG, 'biscuit')
    expect(r.total).toBe(r.items.length)
    expect(shownOf(8, 52)).toBe('8 of 52')
    expect(shownOf(8, 8)).toBeNull()
  })
  test('an empty query returns everything, in the order given', () => {
    expect(itemSearch(CATALOG, '  ').items).toEqual(CATALOG)
  })
  test('itemMatches is the same rule, without close matches', () => {
    const atta = CATALOG.find((i) => i.name.startsWith('Aashirvaad'))!
    const chatka = CATALOG.find((i) => i.name.startsWith('Kurkure'))!
    expect(itemMatches(atta, 'aata')).toBe(true)
    expect(itemMatches(chatka, 'atta')).toBe(false)
    expect(itemMatches(atta, 'aashirvat')).toBe(false)
  })
})

describe('fast enough for 10,000 items on a phone', () => {
  test('10,000 items answer in well under 50 ms once indexed', () => {
    const big = Array.from({ length: 10_000 }, (_, i) => item(`Brand${i % 400} Item${i} ${(i % 9) + 1}00 g`, `Group${i % 30}`, (i % 300) + 5))
    itemSearch(big, 'brand12 item') // first search builds the index
    // Best of three rounds: the whole suite runs in parallel, and a busy machine is not a slow search.
    const rounds = [0, 1, 2].map(() => {
      const t0 = performance.now()
      for (const q of ['brand12 item', 'item99', '500 g', 'gro']) itemSearch(big, q)
      return (performance.now() - t0) / 4
    })
    expect(Math.min(...rounds)).toBeLessThan(50)
  })
})
