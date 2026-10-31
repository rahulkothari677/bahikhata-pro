/**
 * Phase 8b (#129): HSN and rate from the item's name — suggestions only, every
 * pairing proven against the notification's own row.
 */
import { HSN_BY_SHOP_WORD, hsnChoices, suggestHsnForName, choiceFits, checkHsnFormat, hsnDigitsFor } from '@/lib/hsn-by-name'
import { SHOP_WORD_GROUPS } from '@/lib/shop-words'

const NOV1 = new Date('2026-11-01T06:30:00Z') // noon IST, 1 Nov 2026
const OCT31 = new Date('2026-10-31T06:30:00Z')
const squash = (s: string) => s.toLowerCase().replace(/\s+/g, '')

describe('every pairing is the statute, not memory', () => {
  test.each(HSN_BY_SHOP_WORD.map((p) => [p.word, p.hsn, p.statute]))('%s → %s: its row says "%s"', (word, hsn, statute) => {
    const rows = hsnChoices(hsn, NOV1, statute)
    expect(rows.length).toBeGreaterThan(0)
    // Every row kept names the thing (the filter falls back to all rows only when none do — that is the failure).
    expect(rows.every((c) => squash(c.description).includes(squash(statute)))).toBe(true)
    // …and the word is a shop word search already knows, so search and HSN read names alike.
    expect(SHOP_WORD_GROUPS.some((g) => g[0] === word)).toBe(true)
  })

  test('each shop word is paired once', () => {
    const words = HSN_BY_SHOP_WORD.map((p) => p.word)
    expect(new Set(words).size).toBe(words.length)
  })
})

describe('what the item form is offered', () => {
  test('"Aashirvaad Aata 5kg" → 1101, loose exempt or packed 5%', () => {
    const s = suggestHsnForName('Aashirvaad Aata 5kg', NOV1)!
    expect(s.hsn).toBe('1101')
    expect(s.choices.map((c) => [c.label, c.treatment, c.gstRate])).toEqual([
      ['Sold loose', 'exempt', 0],
      ['Pre-packaged & labelled', 'taxable', 5],
    ])
    expect(s.choices[0].answers).toEqual({ 'pre-packaged-and-labelled': 'exempt' })
    expect(s.choices[1].source).toMatch(/^09\/2025-Central Tax \(Rate\) · from 22 September 2025$/)
  })

  test('Hindi script is read like search reads it: चीनी is sugar', () => {
    expect(suggestHsnForName('चीनी 1 kg', NOV1)?.hsn).toBe('1701')
  })

  test('one heading, two things: bread is exempt, biscuits are 5% (both 1905)', () => {
    const bread = suggestHsnForName('Britannia bread', NOV1)!
    expect(bread.choices.every((c) => c.treatment === 'exempt')).toBe(true)
    const biscuit = suggestHsnForName('Parle biscuits', NOV1)!
    expect(biscuit.choices.map((c) => c.gstRate)).toEqual([5])
  })

  test('isabgol: exempt from 1 Nov 2026 citing 03/2026; before that, the 1211 rows', () => {
    const after = suggestHsnForName('Sat isabgol 100g', NOV1)!
    expect(after.choices).toHaveLength(1)
    expect(after.choices[0]).toMatchObject({ label: 'No GST', treatment: 'exempt', gstRate: 0 })
    expect(after.choices[0].source).toMatch(/^03\/2026-Central Tax \(Rate\).* · from 1 November 2026$/)
    const before = suggestHsnForName('Sat isabgol 100g', OCT31)!
    expect(before.choices.some((c) => c.treatment === 'taxable' && c.gstRate === 5)).toBe(true)
  })

  test('fresh potato gets its exemption row, never the chapter-07 "jaribooti" 5% (#120)', () => {
    const s = suggestHsnForName('Aloo', NOV1)!
    expect(s.hsn).toBe('0701')
    expect(s.choices.map((c) => [c.label, c.treatment])).toEqual([['Fresh or chilled', 'exempt']])
  })

  test('salt is exempt outright: one button, no question', () => {
    const s = suggestHsnForName('Tata namak', NOV1)!
    expect(s.choices.map((c) => [c.label, c.treatment])).toEqual([['No GST', 'exempt']])
  })

  test('two rates under one heading: soap offers both, by the row’s own name', () => {
    const s = suggestHsnForName('Lux soap', NOV1)!
    expect(s.choices.map((c) => c.gstRate).sort((a, b) => a - b)).toEqual([5, 18])
    expect(s.choices.find((c) => c.gstRate === 5)!.label).toMatch(/^Toilet Soap/)
  })

  test('a name with no shop word suggests nothing (never a guess)', () => {
    expect(suggestHsnForName('Fevicol 50g', NOV1)).toBeNull()
    expect(suggestHsnForName('', NOV1)).toBeNull()
  })
})

describe('a code typed by hand gets the same choices', () => {
  test('1101 typed: the same two choices, without a name', () => {
    expect(hsnChoices('1101', NOV1).map((c) => c.gstRate)).toEqual([0, 5])
  })
  test('a chapter-wide row is never a button (#120, #334): 6907 tiles get their own 18% row, never "idols of clay"', () => {
    const tiles = hsnChoices('6907', NOV1)
    expect(tiles.map((c) => [c.treatment, c.gstRate])).toEqual([['taxable', 18]])
    expect(tiles[0].description).toMatch(/tiles/)
  })
  test('several exempt rows under one heading are told apart by name (1905)', () => {
    const labels = hsnChoices('1905', NOV1).filter((c) => c.treatment === 'exempt').map((c) => c.label)
    expect(labels).toEqual(['Pappad', 'Khakhra'])
  })
  test('fewer than 4 digits offers nothing', () => {
    expect(hsnChoices('11', NOV1)).toEqual([])
  })
})

describe('choiceFits: the wrong rate for a code is caught', () => {
  const atta = hsnChoices('1101', NOV1)
  test.each([
    [5, 'taxable', true],
    [0, 'exempt', true],
    [18, 'taxable', false], // the CA's #1 error: right code, wrong rate
    [0, 'taxable', false],  // 0% "taxable" is neither choice
    [5, 'exempt', false],
  ])('rate %s %s → %s', (rate, treatment, fits) => {
    expect(choiceFits(atta, rate as number, treatment as string)).toBe(fits)
  })
  test('a code the tables do not know is not judged', () => {
    expect(choiceFits([], 18, 'taxable')).toBeNull()
  })
})

describe('#129: the HSN is checked as it is typed', () => {
  test.each([
    ['', undefined, undefined, ''],
    ['1101', undefined, undefined, '1101'],
    ['0910 30', undefined, undefined, '091030'],
    ['7108-00-00', undefined, undefined, '71080000'],
    ['110', 'HSN needs at least 4 digits — this has 3', undefined, '110'],
    ['11012', 'HSN is 4, 6 or 8 digits — this has 5', '1101', '11012'],
    ['1101234', 'HSN is 4, 6 or 8 digits — this has 7', '110123', '1101234'],
    ['110123456', 'HSN is 4, 6 or 8 digits — this has 9', '11012345', '110123456'],
    ['ABC1', 'HSN is digits only', undefined, 'ABC1'],
  ])('"%s"', (input, problem, fix, code) => {
    const r = checkHsnFormat(input)
    expect(r.problem).toBe(problem)
    expect(r.fix).toBe(fix)
    expect(r.code).toBe(code)
  })

  test('78/2020-CT: above ₹5 crore last year, 4 digits are not enough; at or below, they are', () => {
    expect(hsnDigitsFor(null)).toBe(4)               // not declared
    expect(hsnDigitsFor(5_00_00_000)).toBe(4)        // "above", so exactly ₹5 crore is still 4
    expect(hsnDigitsFor(5_00_00_001)).toBe(6)
    expect(checkHsnFormat('1101', 6).problem).toBe('Turnover above ₹5 crore: HSN needs 6 digits')
    expect(checkHsnFormat('110100', 6).problem).toBeUndefined()
    expect(checkHsnFormat('1101', 4).problem).toBeUndefined()
  })
})
