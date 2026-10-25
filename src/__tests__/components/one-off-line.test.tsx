/**
 * @jest-environment jsdom
 *
 * Phase 7c step 2e (change C11, "Not in list") — billing an item once: a name,
 * a price, how many; not saved to the items. The button says what it adds.
 */
import React from 'react'
import { render, screen, fireEvent } from '@testing-library/react'
import { OneOffLine } from '@/components/ledger/OneOffLine'

// jsdom has no matchMedia; NumberField asks it whether a mouse is present.
beforeAll(() => {
  window.matchMedia = window.matchMedia || ((q: string) => ({ matches: false, media: q, addEventListener: () => {}, removeEventListener: () => {} }) as unknown as MediaQueryList)
})

test('name from what was typed, a price and how many; Add says the total', () => {
  const added: unknown[] = []
  render(<OneOffLine open initialName="carry bag" onClose={() => {}} onAdd={(l) => added.push(l)} />)
  expect(screen.getByRole('textbox', { name: 'Item name' })).toHaveValue('carry bag')
  expect(screen.getByRole('button', { name: 'Type the price' })).toBeDisabled()
  fireEvent.change(screen.getByLabelText('Price'), { target: { value: '5' } })
  fireEvent.click(screen.getByRole('button', { name: 'One more' }))
  fireEvent.click(screen.getByRole('button', { name: 'Add 2 × ₹5 = ₹10' }))
  expect(added).toEqual([{ name: 'carry bag', price: 5, qty: 2 }])
})
