/**
 * @jest-environment jsdom
 *
 * Phase 7c step 2b (change C11) — the keypad bar. Rahul, 23–24 Oct: any weight
 * the customer asks for (400 g, 1.25 kg, 23 pieces), "₹50 of sugar", a pencil
 * on every product, a price never above the printed MRP, and the same pad full
 * screen when the shop prefers it. What is typed lands on the bill as it is
 * typed; a price only on "Set price".
 */
import React from 'react'
import { render, screen, fireEvent, within } from '@testing-library/react'
import { KeypadBar, QtyPad, type KeypadBarProps } from '@/components/ledger/KeypadBar'
import type { NextQty } from '@/lib/loose-entry'

const sugar = { id: 'sugar', name: 'Sugar (loose)', unit: 'kg', gstRate: 0 }
const eggs = { id: 'eggs', name: 'Eggs', unit: 'pcs', gstRate: 0 }
const parle = [
  { id: 'pg5', name: 'Parle-G ₹5', sizeLabel: '₹5', unit: 'pcs', gstRate: 5, mrp: 5 },
  { id: 'pg10', name: 'Parle-G ₹10', sizeLabel: '₹10', unit: 'pcs', gstRate: 5, mrp: 10 },
]
const PRICE: Record<string, number> = { sugar: 44, eggs: 7, pg5: 5, pg10: 10 }

function draw(over: Partial<KeypadBarProps> & Pick<KeypadBarProps, 'row'>) {
  const log: string[] = []
  const props: KeypadBarProps = {
    qtyOf: () => 0,
    priceOf: (p) => PRICE[p.id],
    paysAt: (_p, price) => price,
    setQty: (p, q) => log.push(`qty ${p.id} ${q}`),
    setPrice: (p, price) => log.push(`price ${p.id} ${price}`),
    qtyForRupees: (p, rupees) => Math.round((rupees / PRICE[p.id]) * 1000) / 1000,
    priceProblem: (p, price) => (p.mrp && price > p.mrp ? `Above the printed MRP ₹${p.mrp} — not allowed` : null),
    allowPrice: true,
    gramsRule: true,
    checkAmounts: true,
    big: false,
    onClose: () => log.push('closed'),
    ...over,
  }
  render(<KeypadBar {...props} />)
  return log
}
const keys = (...k: string[]) => k.forEach((x) => fireEvent.click(screen.getByRole('button', { name: x === '⌫' ? 'Delete' : x })))
const tab = (name: string) => fireEvent.click(within(screen.getByRole('group', { name: 'What to type' })).getByRole('button', { name }))

describe('a loose good', () => {
  const row = { key: 'sugar', title: 'Sugar', loose: true, items: [sugar] }

  test('400 goes on as 400 g (0.4 kg) as it is typed; 1.25 as 1.25 kg', () => {
    const log = draw({ row })
    keys('4', '0', '0')
    expect(log).toEqual(['qty sugar 4', 'qty sugar 40', 'qty sugar 0.4'])
    expect(screen.getByText('400 g')).toBeInTheDocument()
    keys('⌫', '⌫', '⌫', '1', '.', '2', '5')
    expect(log[log.length - 1]).toBe('qty sugar 1.25')
  })

  test('the g | kg chips and quick weights set the unit', () => {
    const log = draw({ row })
    fireEvent.click(screen.getByRole('button', { name: '750 g' }))
    expect(log).toEqual(['qty sugar 0.75'])
    keys('2')
    fireEvent.click(screen.getByRole('button', { name: 'kg' }))
    expect(log[log.length - 1]).toBe('qty sugar 2')
  })

  test('₹ amount: "₹50 of sugar" puts on what ₹50 buys', () => {
    const log = draw({ row })
    tab('₹ amount')
    keys('5', '0')
    expect(log[log.length - 1]).toBe('qty sugar 1.136')
    expect(screen.getByText('= 1.136 kg')).toBeInTheDocument()
  })

  test('500 kg is asked about, never blocked', () => {
    const log = draw({ row, gramsRule: false })
    keys('5', '0', '0')
    expect(log[log.length - 1]).toBe('qty sugar 500')
    expect(screen.getByRole('status').textContent).toBe('Check: 500 kg?')
  })

  test('a counted loose good takes whole pieces: 23 eggs; no ₹ tab, no decimal key', () => {
    const log = draw({ row: { key: 'eggs', title: 'Eggs', loose: true, items: [eggs] } })
    keys('2', '3')
    expect(log[log.length - 1]).toBe('qty eggs 23')
    expect(screen.queryByRole('button', { name: '₹ amount' })).toBeNull()
    expect(screen.getByRole('button', { name: '.' })).toBeDisabled()
  })
})

describe('a packed product (✎)', () => {
  const row = { key: 'f:pg', title: 'Parle-G', loose: false, items: parle }

  test('any count of the chosen size; packets are whole numbers', () => {
    const log = draw({ row })
    fireEvent.click(screen.getByRole('button', { name: '₹10' }))
    keys('2', '3')
    expect(log).toEqual(['qty pg10 2', 'qty pg10 23'])
    expect(screen.getByRole('button', { name: '.' })).toBeDisabled()
  })

  test('a price goes on only with "Set price", never above the printed MRP', () => {
    const log = draw({ row })
    tab('Price')
    keys('4')
    fireEvent.click(screen.getByRole('button', { name: 'Set price' }))
    expect(log).toEqual(['price pg5 4'])
    keys('6')
    expect(screen.getByText('Above the printed MRP ₹5 — not allowed')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Set price' })).toBeDisabled()
  })
})

describe('Big number pad (⚙)', () => {
  test('the same pad opens full screen', () => {
    const log = draw({ row: { key: 'sugar', title: 'Sugar', loose: true, items: [sugar] }, big: true })
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    keys('2', '5', '0')
    expect(log[log.length - 1]).toBe('qty sugar 0.25')
    fireEvent.click(screen.getByRole('button', { name: 'Done' }))
    expect(log[log.length - 1]).toBe('closed')
  })
})

describe('Qty first (step 2c)', () => {
  function drawQty(over: Partial<React.ComponentProps<typeof QtyPad>> = {}) {
    const sets: (NextQty | null)[] = []
    let closed = false
    render(<QtyPad next={null} setNext={(n) => sets.push(n)} onClose={() => { closed = true }} error="" big={false} {...over} />)
    return { sets, closed: () => closed }
  }
  test('an amount and its unit wait for the next tap: × 23, then 400 g', () => {
    const { sets } = drawQty()
    keys('2', '3')
    expect(sets[sets.length - 1]).toEqual({ n: 23, unit: 'count' })
    expect(screen.getByRole('button', { name: '.' })).toBeDisabled() // a count has no point
    fireEvent.click(within(screen.getByRole('group', { name: 'Unit' })).getByRole('button', { name: 'g' }))
    keys('⌫', '⌫', '4', '0', '0')
    expect(sets[sets.length - 1]).toEqual({ n: 400, unit: 'g' })
  })
  test('₹ and Clear', () => {
    const { sets } = drawQty({ next: { n: 50, unit: 'rs' } })
    expect(screen.getByText('₹50')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Clear' }))
    expect(sets[sets.length - 1]).toBeNull()
  })
  test('says why the last tap could not take it', () => {
    drawQty({ next: { n: 2.5, unit: 'kg' }, error: 'Sold in packets — type how many: 2.5 kg on Parle-G ₹10' })
    expect(screen.getByRole('status').textContent).toBe('Sold in packets — type how many: 2.5 kg on Parle-G ₹10')
  })
  test('on a computer the number keys type into the pad and Enter is Done', () => {
    const { sets, closed } = drawQty()
    fireEvent.keyDown(window, { key: '1' })
    fireEvent.keyDown(window, { key: '2' })
    expect(sets[sets.length - 1]).toEqual({ n: 12, unit: 'count' })
    fireEvent.keyDown(window, { key: 'Enter' })
    expect(closed()).toBe(true)
  })
})
