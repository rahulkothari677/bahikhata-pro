/**
 * @jest-environment jsdom
 *
 * Phase 8d (#116 #117) — under GSTR-3B Table 4, what the credit claim held back.
 */
import React from 'react'
import { render, screen, fireEvent } from '@testing-library/react'
import { ItcClaimNotes, endingSoonInfo, type ItcDetail } from '@/components/reports/ItcClaimNotes'

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

describe('#112: credit ending with this return, listed by supplier', () => {
  const soon = [
    { id: 'a', invoiceNo: 'S-9', supplier: 'Shree Traders', gstin: '08AAACS1234K1Z5', billFp: '022026', tax: 600, final: true },
    { id: 'b', invoiceNo: 'K-2', supplier: null, gstin: '08AAAPL5555C1Z9', billFp: '032026', tax: 150, final: true },
  ]
  test('one line with the total; the bills open on tap, with supplier, bill and month', () => {
    render(<ItcClaimNotes detail={{ ...NONE, endingSoon: soon, endingSoonTax: 750 }} />)
    const box = screen.getByTestId('itc-ending-soon')
    expect(box.textContent).toMatch(/₹750(\.00)? of credit ends with this return — 2 bills your suppliers have not filed/)
    expect(screen.queryByText('Shree Traders')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'See bills' }))
    expect(screen.getByText('Shree Traders')).toBeInTheDocument()
    expect(box.textContent).toMatch(/S-9 · Feb 2026/)
    expect(screen.getByText('08AAAPL5555C1Z9')).toBeInTheDocument() // no name → the GSTIN
  })
  test('the rule gives the dates: 30 Nov, the October return, the 11 Nov supplier cut-off', () => {
    const t = endingSoonInfo(soon)
    expect(t).toMatch(/2025-26 bills can be claimed only until 30 November 2026/)
    expect(t).toMatch(/October 2026 GSTR-3B is the last return/)
    expect(t).toMatch(/by 11 November 2026/)
  })
  test('a month ahead it reads "next month", in the check colour', () => {
    render(<ItcClaimNotes detail={{ ...NONE, endingSoon: soon.map((b) => ({ ...b, final: false })), endingSoonTax: 750 }} />)
    expect(screen.getByTestId('itc-ending-soon').textContent).toMatch(/ends next month/)
    expect(screen.getByTestId('itc-ending-soon').className).toMatch(/bg-check-soft/)
  })
})
