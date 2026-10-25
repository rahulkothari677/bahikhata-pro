/**
 * @jest-environment jsdom
 *
 * Phase 7g-3 — estimates have a home with a status (#185).
 *
 * The home already existed (the Estimates chip in Bills, "See estimates" on the
 * saved-estimate message, Estimate in the + menu). What was missing was where
 * each quote stands: open (follow up) or converted (already a sale). Read from
 * the stored conversion (convertedToTransactionId), one rule for every screen.
 */
import { render, screen } from '@testing-library/react'
import { estimateStatus } from '@/lib/estimate-status'
import { EstimateStatusBadge } from '@/components/ledger/EstimateStatusBadge'
import { readCode } from '@/test-support/read-source'

describe('where an estimate stands', () => {
  test('open until converted; converted once the sale exists', () => {
    expect(estimateStatus({ type: 'estimate', convertedToTransactionId: null })).toBe('open')
    expect(estimateStatus({ type: 'estimate' })).toBe('open')
    expect(estimateStatus({ type: 'estimate', convertedToTransactionId: 'cm-sale-1' })).toBe('converted')
  })
  test('only an estimate has one', () => {
    for (const type of ['sale', 'purchase', 'credit-note', 'debit-note', 'income', 'expense']) {
      expect(estimateStatus({ type, convertedToTransactionId: 'x' })).toBeNull()
    }
  })
  test('the badge says it in a word', () => {
    const { rerender } = render(<EstimateStatusBadge status="open" />)
    expect(screen.getByText('Open')).toBeTruthy()
    rerender(<EstimateStatusBadge status="converted" />)
    expect(screen.getByText('Converted')).toBeTruthy()
  })
})

describe('every screen reads the one rule', () => {
  const ledger = readCode('components/ledger/Ledger.tsx')
  const detail = readCode('components/ledger/TransactionDetail.tsx')

  test('both Bills layouts show the status', () => {
    expect(ledger.split('<EstimateStatusBadge status={estimateStatus(txn)!} />').length - 1).toBe(2)
  })
  test('the bill screen decides Convert / Converted by it', () => {
    expect(detail).toContain("estimateStatus(txn) === 'converted' ?")
    expect(detail).toContain("estimateStatus(txn) === 'open' && (")
    expect(detail).not.toMatch(/txn\.type === 'estimate' && txn\.convertedToTransactionId/)
  })
  test('the home is still there: the Estimates chip and the way to it after saving', () => {
    expect(ledger).toContain("useArrivalRequest('sales', 'show-estimates', () => setChip('est'))")
    expect(readCode('components/ledger/TransactionEntry.tsx')).toContain("label: 'See estimates'")
  })
})
