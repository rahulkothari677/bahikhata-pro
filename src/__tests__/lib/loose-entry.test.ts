/**
 * Phase 7c step 2b — typing a loose amount (lib/loose-entry.ts). Rahul, 23 Oct:
 * "400gm or 1.25kg or 23 pieces". The bill keeps the item's unit; these are the
 * rules that turn what is typed into it.
 */
import { describe, test, expect } from '@jest/globals'
import { typedQuantity, shownUnit, looseLabel, weightButtons, unusualAmount, smallUnitOf, isLooseUnit, nextQtyFor, nextLabel } from '@/lib/loose-entry'

describe('typedQuantity — what goes on the bill, in the item\'s unit', () => {
  test('on a kg item: 400 is 400 g, 1.25 is 1.25 kg, 2 is 2 kg', () => {
    expect(typedQuantity('400', 'auto', 'kg')).toBe(0.4)
    expect(typedQuantity('1.25', 'auto', 'kg')).toBe(1.25)
    expect(typedQuantity('2', 'auto', 'kg')).toBe(2)
    expect(typedQuantity('750', 'auto', 'ltr')).toBe(0.75)
  })
  test('the 400-means-grams rule can be switched off, and a chosen unit always wins', () => {
    expect(typedQuantity('400', 'auto', 'kg', false)).toBe(400)
    expect(typedQuantity('50', 'kg', 'kg')).toBe(50)
    expect(typedQuantity('250', 'g', 'kg')).toBe(0.25)
    expect(typedQuantity('1.5', 'kg', 'kg')).toBe(1.5)
    expect(typedQuantity('49', 'auto', 'kg')).toBe(49) // under 50: kilos
    expect(typedQuantity('400.0', 'auto', 'kg')).toBe(400) // a decimal point means the unit itself
  })
  test('an item kept in grams stays in grams', () => {
    expect(typedQuantity('400', 'auto', 'gm')).toBe(400)
  })
  test('a count item takes whole numbers only: 23 pieces yes, 2.5 packets refused (never rounded)', () => {
    expect(typedQuantity('23', 'auto', 'pcs')).toBe(23)
    expect(typedQuantity('2.5', 'auto', 'pcs')).toBeNull()
  })
  test('nothing typed, zero or junk is nothing', () => {
    expect(typedQuantity('', 'auto', 'kg')).toBeNull()
    expect(typedQuantity('0', 'auto', 'kg')).toBeNull()
    expect(typedQuantity('.', 'auto', 'kg')).toBeNull()
  })
})

describe('what the screen shows', () => {
  test('the unit while typing follows the rule', () => {
    expect(shownUnit('400', 'auto', 'kg')).toBe('g')
    expect(shownUnit('4', 'auto', 'kg')).toBe('kg')
    expect(shownUnit('750', 'auto', 'ltr')).toBe('ml')
    expect(shownUnit('2', 'ltr', 'ltr')).toBe('L')
  })
  test('a loose quantity reads as it is said', () => {
    expect(looseLabel(0.4, 'kg')).toBe('400 g')
    expect(looseLabel(1.25, 'kg')).toBe('1.25 kg')
    expect(looseLabel(0.75, 'ltr')).toBe('750 ml')
    expect(looseLabel(23, 'pcs')).toBe('23')
  })
})

describe('weight buttons on a loose row', () => {
  test('everyday weights; smaller ones for a dear item (₹400 a kg and up)', () => {
    expect(weightButtons('kg', 44)).toEqual([0.25, 0.5, 1, 2])
    expect(weightButtons('kg', 900)).toEqual([0.1, 0.25, 0.5, 1])
    expect(weightButtons('ltr', 170)).toEqual([0.5, 1, 2])
    expect(weightButtons('pcs', 7)).toEqual([])
  })
  test('which units are loose', () => {
    expect([isLooseUnit('kg'), isLooseUnit('ltr'), isLooseUnit('pcs'), isLooseUnit('packet')]).toEqual([true, true, false, false])
    expect([smallUnitOf('kg'), smallUnitOf('ltr'), smallUnitOf('pcs')]).toEqual(['g', 'ml', null])
  })
})

describe('unusual amounts are asked, never blocked', () => {
  test('500 kg typed for 500 g is questioned; a normal amount is not', () => {
    expect(unusualAmount(500, 'kg', 70000)).toBe('Check: 500 kg?')
    expect(unusualAmount(0.5, 'kg', 70)).toBeNull()
    expect(unusualAmount(300, 'pcs', 300)).toBe('Check: 300?')
    expect(unusualAmount(2, 'pcs', 12000)).toBe('Check: ₹12,000?')
  })
})

describe('Qty first: an amount with its unit for the next item (step 2c)', () => {
  const rupees = (r: number) => Math.round((r / 44) * 1000) / 1000
  test('says what is waiting: × 23, 400 g, 1.5 L, ₹50', () => {
    expect([nextLabel({ n: 23, unit: 'count' }), nextLabel({ n: 400, unit: 'g' }), nextLabel({ n: 1.5, unit: 'ltr' }), nextLabel({ n: 50, unit: 'rs' })])
      .toEqual(['× 23', '400 g', '1.5 L', '₹50'])
  })
  test('on a loose good: a count is its own unit (400 = 400 g), a weight converts, rupees buy', () => {
    expect(nextQtyFor({ n: 400, unit: 'count' }, 'kg', true, rupees)).toEqual({ qty: 0.4 })
    expect(nextQtyFor({ n: 1.25, unit: 'kg' }, 'kg', true, rupees)).toEqual({ qty: 1.25 })
    expect(nextQtyFor({ n: 250, unit: 'g' }, 'kg', true, rupees)).toEqual({ qty: 0.25 })
    expect(nextQtyFor({ n: 50, unit: 'rs' }, 'kg', true, rupees)).toEqual({ qty: 1.136 })
  })
  test('a weight in the wrong family is refused, never guessed', () => {
    expect(nextQtyFor({ n: 500, unit: 'ml' }, 'kg', true, rupees)).toEqual({ error: '500 ml does not fit an item sold by kg' })
  })
  test('a packet takes whole counts only; a weight or ₹ on a packet waits for pack sizes (C13)', () => {
    expect(nextQtyFor({ n: 23, unit: 'count' }, 'pcs', true, rupees)).toEqual({ qty: 23 })
    expect(nextQtyFor({ n: 2.5, unit: 'count' }, 'pcs', true, rupees)).toEqual({ error: 'Packets are whole numbers' })
    expect(nextQtyFor({ n: 400, unit: 'g' }, 'pcs', true, rupees)).toEqual({ error: 'Sold in packets — type how many' })
    expect(nextQtyFor({ n: 50, unit: 'rs' }, 'pcs', true, rupees)).toEqual({ error: 'Sold in packets — type how many' })
  })
})
