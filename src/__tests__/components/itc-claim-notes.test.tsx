/**
 * @jest-environment jsdom
 *
 * Phase 8d (#116 #117) — under GSTR-3B Table 4, what the credit claim held back.
 */
import React from 'react'
import { render, screen } from '@testing-library/react'
import { ItcClaimNotes, type ItcDetail } from '@/components/reports/ItcClaimNotes'

beforeAll(() => {
  window.matchMedia = window.matchMedia || ((q: string) => ({ matches: false, media: q, addEventListener: () => {}, removeEventListener: () => {} }) as unknown as MediaQueryList)
})

const NONE: ItcDetail = { shortBy: 0, shortCount: 0, lateCount: 0, lateTax: 0, deferredCount: 0, deferredTax: 0, stillWaitingCount: 0, stillWaitingTax: 0, lapsedCount: 0, lapsedTax: 0 }

test('nothing held back says nothing; no 2B (null) says nothing', () => {
  expect(render(<ItcClaimNotes detail={NONE} />).container).toBeEmptyDOMElement()
  expect(render(<ItcClaimNotes detail={null} />).container).toBeEmptyDOMElement()
})

test('each held-back amount, in shop words, with counts', () => {
  render(<ItcClaimNotes detail={{ ...NONE, shortBy: 2000, shortCount: 1, lateCount: 2, lateTax: 900, deferredCount: 1, deferredTax: 300, stillWaitingCount: 2, stillWaitingTax: 200, lapsedCount: 1, lapsedTax: 450 }} />)
  const t = screen.getByTestId('itc-claim-notes').textContent!
  expect(t).toMatch(/₹900(\.00)? claimed now from 2 bills of earlier months/)
  expect(t).toMatch(/₹2,000(\.00)? not claimed — suppliers filed less than your bills \(1 bill\)/)
  expect(t).toMatch(/₹500(\.00)? waiting for suppliers to file \(3 bills\)/)
  expect(t).toMatch(/₹450(\.00)? can no longer be claimed — past 30 November \(1 bill\)/)
})

test('the rule is behind ⓘ, not on the line', () => {
  render(<ItcClaimNotes detail={{ ...NONE, shortBy: 2000, shortCount: 1 }} />)
  expect(screen.getByTestId('itc-claim-notes').textContent).not.toMatch(/Rule 36|88D/)
  expect(screen.getAllByRole('button').length).toBe(1)
})
