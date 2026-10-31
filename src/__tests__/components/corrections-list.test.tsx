/**
 * @jest-environment jsdom
 *
 * #103 (Phase 8c) — corrections to filed returns wait for the shopkeeper's
 * switch. Replaces needs-amending-is-visible.test.tsx, whose card said the
 * corrections were already "included … you do not need to do anything else";
 * its other intents (the original number, the change in words, no blame,
 * silence when there is nothing) are kept here.
 */
import React from 'react'
import { render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { CorrectionsList, periodName, type CorrectionRow } from '@/components/reports/CorrectionsList'

beforeAll(() => {
  window.matchMedia = window.matchMedia || ((q: string) => ({ matches: false, media: q, addEventListener: () => {}, removeEventListener: () => {} }) as unknown as MediaQueryList)
})

const ROW: CorrectionRow = {
  key: 'b2b:INV-0003', section: 'b2b', number: 'INV-0003', firstFp: '082026', lastFp: '082026',
  filedVal: 525, nowVal: 1050, changes: ['Value changed from ₹525 to ₹1050'], fingerprint: 'abc12345',
  included: false, lapsed: false, canInclude: true, problem: null, deadline: 'You have 395 days — until 30 November 2027.', daysLeft: 395,
}
const show = (rows: CorrectionRow[] | undefined, filed = false) => render(
  <QueryClientProvider client={new QueryClient()}>
    <CorrectionsList month="2026-10" monthName="October" rows={rows} filed={filed} />
  </QueryClientProvider>,
)

test('a correction is OFF until switched on — the defect #103 fixes', () => {
  show([ROW])
  expect(screen.getByRole('switch', { name: "Include INV-0003 in October's GSTR-1" })).toHaveAttribute('aria-checked', 'false')
  expect(screen.getByText("0 of 1 going into October's GSTR-1")).toBeInTheDocument()
})

test('it shows the original number, Filed → Now, and never says it is already included', () => {
  show([ROW])
  const card = screen.getByTestId('corrections')
  expect(card).toHaveTextContent('INV-0003')
  expect(card).toHaveTextContent('filed in Aug 2026')
  expect(card.textContent).toMatch(/Filed ₹525(\.00)? → Now ₹1,050(\.00)?/)
  expect(card.textContent).not.toMatch(/do not need to do anything|already included/i)
  expect(card.textContent).not.toMatch(/wrong|mistake|error|incorrect/i)
})

test('other changes are said in words; the value change is the figures themselves', () => {
  show([{ ...ROW, changes: ['Value changed from ₹525 to ₹1050', 'Date changed from 10-08-2026 to 12-08-2026'] }])
  expect(screen.getByText('Date changed from 10-08-2026 to 12-08-2026')).toBeInTheDocument()
  expect(screen.queryByText('Value changed from ₹525 to ₹1050')).toBeNull()
})

test('a cancelled bill reads "Filed ₹525 → Cancelled"', () => {
  show([{ ...ROW, nowVal: 0, changes: ['This was cancelled after the return was filed'] }])
  expect(screen.getByTestId('correction-row').textContent).toMatch(/Filed ₹525(\.00)? → Cancelled/)
})

test('switched on, then the bill changed again: off, and it says why', () => {
  show([{ ...ROW, lapsed: true }])
  expect(screen.getByText('Changed again since you switched it on — switch on again to include')).toBeInTheDocument()
  expect(screen.getByRole('switch')).toHaveAttribute('aria-checked', 'false')
})

test('one the app cannot write shows the reason, and no switch', () => {
  show([{ ...ROW, canInclude: false, problem: 'This now belongs with sales to other customers — Ask your CA.' }])
  expect(screen.getByText(/Ask your CA/)).toBeInTheDocument()
  expect(screen.queryByRole('switch')).toBeNull()
})

test('this month already filed: the switch cannot be turned on', () => {
  show([ROW], true)
  expect(screen.getByRole('switch')).toBeDisabled()
  expect(screen.getByText('October is filed')).toBeInTheDocument()
})

test('nothing to correct says nothing at all', () => {
  const { container } = show([])
  expect(container).toBeEmptyDOMElement()
  const again = show(undefined)
  expect(again.container).toBeEmptyDOMElement()
})

test('period names read as shop words', () => {
  expect(periodName('082026')).toBe('Aug 2026')
  expect(periodName('012027')).toBe('Jan 2027')
})
