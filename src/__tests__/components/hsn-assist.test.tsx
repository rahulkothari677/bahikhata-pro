/**
 * @jest-environment jsdom
 *
 * Phase 8b (#129) — the item form's HSN help, as drawn: the rate first on each
 * button, one tap hands back the code and the choice, a wrong shape offers its fix.
 */
import React from 'react'
import { render, screen, fireEvent, within } from '@testing-library/react'
import { HsnSuggestCard, HsnCodeLine } from '@/components/inventory/HsnAssist'
import { suggestHsnForName, hsnChoices, type HsnChoice } from '@/lib/hsn-by-name'

beforeAll(() => {
  window.matchMedia = window.matchMedia || ((q: string) => ({ matches: false, media: q, addEventListener: () => {}, removeEventListener: () => {} }) as unknown as MediaQueryList)
})

const NOV1 = new Date('2026-11-01T06:30:00Z')

test('"Aata": HSN 1101 with two buttons, rate first; a tap returns the code and the choice', () => {
  const picked: [string, HsnChoice][] = []
  render(<HsnSuggestCard suggestion={suggestHsnForName('Aashirvaad Aata 5kg', NOV1)!} onPick={(h, c) => picked.push([h, c])} />)
  const card = screen.getByTestId('hsn-suggest')
  expect(card).toHaveTextContent('HSN 1101 for “atta”')
  const buttons = within(card).getAllByRole('button').filter((b) => !b.getAttribute('aria-label')?.startsWith('About'))
  expect(buttons.map((b) => b.textContent)).toEqual(['No GSTSold loose', '5% GSTPre-packaged & labelled'])
  fireEvent.click(buttons[1])
  expect(picked).toHaveLength(1)
  expect(picked[0][0]).toBe('1101')
  expect(picked[0][1]).toMatchObject({ gstRate: 5, treatment: 'taxable' })
})

test('a 5-digit code: the problem in words and "Use 1101", which hands back the fix', () => {
  const fixed: string[] = []
  render(<HsnCodeLine code="11012" problem="HSN is 4, 6 or 8 digits — this has 5" fix="1101" choices={[]} fits={null} gst gstRate={0} treatment="taxable" onFix={(c) => fixed.push(c)} onPick={() => {}} />)
  expect(screen.getByTestId('hsn-problem')).toHaveTextContent('HSN is 4, 6 or 8 digits — this has 5')
  fireEvent.click(screen.getByRole('button', { name: 'Use 1101' }))
  expect(fixed).toEqual(['1101'])
})

test('right code, wrong rate (18% on atta): the rates that fit, as buttons', () => {
  render(<HsnCodeLine code="1101" choices={hsnChoices('1101', NOV1)} fits={false} gst gstRate={18} treatment="taxable" onFix={() => {}} onPick={() => {}} />)
  expect(screen.getByTestId('hsn-mismatch')).toHaveTextContent('HSN 1101: No GST or 5% GST')
})

test('when the rate fits, one quiet line names the row it follows', () => {
  render(<HsnCodeLine code="1101" choices={hsnChoices('1101', NOV1)} fits gst gstRate={5} treatment="taxable" onFix={() => {}} onPick={() => {}} />)
  expect(screen.getByTestId('hsn-fits')).toHaveTextContent('Pre-packaged & labelled · 5% GST')
})

test('a shop that is not registered sees the shape check but no rate help', () => {
  const { container } = render(<HsnCodeLine code="1101" choices={hsnChoices('1101', NOV1)} fits={false} gst={false} gstRate={18} treatment="taxable" onFix={() => {}} onPick={() => {}} />)
  expect(container).toBeEmptyDOMElement()
})
