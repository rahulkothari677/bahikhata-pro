/**
 * Phase 7c step 2d (change C12) — reading a name and an amount from what is
 * typed in the bill's search box (lib/typed-line.ts).
 */
import { describe, test, expect } from '@jest/globals'
import { parseTypedLine, splitTypedList, isTypedList } from '@/lib/typed-line'

const p = (t: string) => { const r = parseTypedLine(t); return { name: r.name, sizes: r.sizes, count: r.count, amount: r.amount, tail: r.tail } }

describe('parseTypedLine', () => {
  test('a name and a bare number: the number waits for the item to decide (400 g of dal, 10 packets, or the ₹10 size)', () => {
    expect(p('toor 400')).toEqual({ name: 'toor', sizes: [], count: null, amount: null, tail: 400 })
    expect(p('parle 10')).toEqual({ name: 'parle', sizes: [], count: null, amount: null, tail: 10 })
  })
  test('a weight with its unit, however it is written', () => {
    expect(p('cheeni 1.25 kilo').amount).toEqual({ n: 1.25, unit: 'kg' })
    expect(p('toor dal 400gm').amount).toEqual({ n: 400, unit: 'g' })
    expect(p('sarson tel 750 ml').amount).toEqual({ n: 750, unit: 'ml' })
    expect(p('1.5 kg peanuts')).toEqual({ name: 'peanuts', sizes: [], count: null, amount: { n: 1.5, unit: 'kg' }, tail: null })
  })
  test('rupees: ₹50, 50 rs, 50 rs ka, rs 50, 50 ka', () => {
    for (const t of ['₹50 gud', '50 rs gud', '50 rs ka gud', 'rs 50 gud', '50 ka gud', 'gud ₹ 50']) {
      expect([t, p(t).name, p(t).amount]).toEqual([t, 'gud', { n: 50, unit: 'rs' }])
    }
  })
  test('a count before the name; "wala" marks a size; a number between names is a size', () => {
    expect(p('3 parle 10')).toEqual({ name: 'parle', sizes: [], count: 3, amount: null, tail: 10 })
    expect(p('parle g 5 wala 23')).toEqual({ name: 'parle g', sizes: [5], count: null, amount: null, tail: 23 })
    expect(p('anda 23')).toEqual({ name: 'anda', sizes: [], count: null, amount: null, tail: 23 })
  })
  test('"g" after a name is part of it (Parle G), a unit only after a number', () => {
    expect(p('parle g').name).toBe('parle g')
    expect(p('maggi').tail).toBeNull()
  })
})

describe('a whole list', () => {
  test('commas, new lines and "aur" split it; list numbering and bullets go', () => {
    expect(splitTypedList('toor 400, cheeni 1.25 kilo\nanda 23 aur 50 rs ka gud')).toEqual(['toor 400', 'cheeni 1.25 kilo', 'anda 23', '50 rs ka gud'])
    expect(splitTypedList('1. toor dal 400 gm\n2) maggi 2\n- parle g 10')).toEqual(['toor dal 400 gm', 'maggi 2', 'parle g 10'])
    expect(isTypedList('toor 400')).toBe(false)
    expect(isTypedList('toor 400, maggi')).toBe(true)
  })
})
