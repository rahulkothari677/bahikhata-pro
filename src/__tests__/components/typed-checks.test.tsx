/**
 * @jest-environment jsdom
 *
 * Phase 7c step 2d (change C12) — the cards for typed lines the bill was not
 * sure of. A choice goes on the bill with the amount said; ✕ drops the card;
 * a line nothing matched offers "Add it as a new item". No popup, ever.
 */
import React from 'react'
import { render, screen, fireEvent } from '@testing-library/react'
import { TypedChecks, type TypedCheck } from '@/components/ledger/TypedChecks'

const dal: TypedCheck = {
  id: 1, said: 'dal 400', key: 'dal', more: 4,
  choices: [{ product: { id: 'toor', name: 'Toor Dal (loose)' }, qty: 0.4 }, { product: { id: 'moong', name: 'Moong Dal (loose)' }, qty: 0.4 }],
}
const bag: TypedCheck = { id: 2, said: 'carry bag', key: 'carry bag', more: 0, choices: [] }

test('a card per line: the words, the choices with what each puts on the bill, and how many more', () => {
  const log: string[] = []
  render(<TypedChecks checks={[dal, bag]} describe={(p, q) => `${q * 1000} g`}
    onPick={(c, ch) => log.push(`pick ${c.id} ${ch.product.id} ${ch.qty}`)} onDrop={(id) => log.push(`drop ${id}`)} onNewItem={(c) => log.push(`new ${c.said}`)} />)
  expect(screen.getByText('2 to check · Save waits for them')).toBeInTheDocument()
  expect(screen.getByText(/4 more: type more of the name/)).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'Moong Dal (loose) · 400 g' }))
  fireEvent.click(screen.getByRole('button', { name: 'Remove “dal 400”' }))
  fireEvent.click(screen.getByRole('button', { name: '+ Add it as a new item' }))
  expect(log).toEqual(['pick 1 moong 0.4', 'drop 1', 'new carry bag'])
  expect(screen.getByText(/not in your items/)).toBeInTheDocument()
})

test('nothing to check, nothing shown', () => {
  const { container } = render(<TypedChecks checks={[]} describe={() => ''} onPick={() => {}} onDrop={() => {}} onNewItem={() => {}} />)
  expect(container.innerHTML).toBe('')
})
