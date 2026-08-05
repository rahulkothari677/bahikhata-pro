/**
 * @jest-environment jsdom
 *
 * The shopkeeper must be able to reach the bank-statement delete.
 *
 * WHY (audit 2026-08-05, Phase 10). The API half of this fix was verified
 * against production and works. That is not the same as the feature working:
 * an endpoint nobody can click is not a fix, and this screen previously offered
 * upload, match and unmatch with no way back, so a wrong CSV was permanent.
 *
 * Two failure modes are specific to how this is built, and both are SILENT —
 * the code compiles, the tests that only read the API pass, and the button
 * simply does nothing:
 *
 *  1. `useConfirmDialog` returns a `dialog` element that the component must
 *     RENDER. Forget it and confirmDialog()'s promise never resolves: the user
 *     clicks Remove, no dialog appears, nothing happens, no error.
 *  2. The card header was one big <button> for expand/collapse. A delete button
 *     nested inside it is invalid HTML and the click toggles the card instead.
 *
 * So this drives the real component: click Remove, confirm in the real dialog,
 * and assert the DELETE actually went to the API.
 */
import React from 'react'
import { render, screen, waitFor, fireEvent, act } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

const mockOfflineFetch = jest.fn()
jest.mock('@/lib/offline-fetch', () => ({ offlineFetch: (...a: unknown[]) => mockOfflineFetch(...a) }))
jest.mock('@/lib/haptic', () => ({ haptic: { success: jest.fn(), error: jest.fn() } }))
jest.mock('sonner', () => ({ toast: { success: jest.fn(), error: jest.fn() } }))

const mockUseStaffPermissions = jest.fn()
jest.mock('@/hooks/use-staff-permissions', () => ({
  useStaffPermissions: () => mockUseStaffPermissions(),
}))

import { BankReconciliation } from '@/components/reports/BankReconciliation'

const STATEMENT = {
  id: 'bs_1',
  bankName: 'HDFC',
  accountNumber: '****1234',
  importedAt: '2026-08-01T00:00:00.000Z',
  txnCount: 12,
  matchedCount: 5,
  totalCredits: 50000,
  totalDebits: 20000,
  transactions: [],
}

const jsonOk = (body: unknown) => ({ ok: true, json: async () => body })

function renderScreen() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={qc}>
      <BankReconciliation />
    </QueryClientProvider>,
  )
}

/** Click through React's act() so state updates flush before the assertion. */
const click = async (el: HTMLElement) => {
  await act(async () => {
    fireEvent.click(el)
  })
}

const removeButton = () => screen.findByLabelText(/remove the HDFC import/i)
const deleteCalls = () =>
  mockOfflineFetch.mock.calls.filter(([, init]) => (init as RequestInit | undefined)?.method === 'DELETE')

beforeEach(() => {
  jest.clearAllMocks()
  mockUseStaffPermissions.mockReturnValue({ isOwner: true, isCA: false, canAccess: () => true, permissions: {} })
  mockOfflineFetch.mockImplementation(async (_url: string, init?: RequestInit) => {
    if (init?.method === 'DELETE') {
      return jsonOk({
        success: true,
        message: 'Removed the HDFC statement and its 12 row(s). Your sales, purchases and payments are unchanged.',
        rowsRemoved: 12,
      })
    }
    return jsonOk({ bankStatements: [STATEMENT], summary: {} })
  })
})

describe('a wrongly imported statement can be removed from the screen', () => {
  it('shows a remove control for the import', async () => {
    renderScreen()
    expect(await removeButton()).toBeInTheDocument()
  })

  it('clicking it opens a confirmation — the dialog element is actually rendered', async () => {
    // Regression: `const { dialog } = useConfirmDialog()` destructured but never
    // placed in the JSX. Nothing renders, the promise never settles, the button
    // is dead and nothing reports it.
    renderScreen()
    await click(await removeButton())
    expect(await screen.findByText(/Remove this bank statement\?/i)).toBeInTheDocument()
  })

  it('the confirmation promises the ledger is untouched', async () => {
    // A delete button next to bank figures reads as "this removes my money".
    renderScreen()
    await click(await removeButton())
    expect(await screen.findByText(/NOT affected/i)).toBeInTheDocument()
  })

  it('confirming sends DELETE to the statement endpoint', async () => {
    renderScreen()
    await click(await removeButton())
    await click(await screen.findByRole('button', { name: /remove import/i }))
    await waitFor(() => {
      expect(mockOfflineFetch).toHaveBeenCalledWith(
        '/api/bank-recon/statement/bs_1',
        expect.objectContaining({ method: 'DELETE' }),
      )
    })
  })

  it('cancelling deletes nothing', async () => {
    renderScreen()
    await click(await removeButton())
    await click(await screen.findByRole('button', { name: /^cancel$/i }))
    expect(deleteCalls()).toHaveLength(0)
  })
})

describe('the delete button does not hijack the expand control', () => {
  it('clicking remove opens the confirmation rather than toggling the card', async () => {
    // Regression: the header used to be a single <button>. Nesting the delete
    // inside it is invalid HTML, and the click lands on the outer toggle.
    renderScreen()
    await click(await removeButton())
    expect(await screen.findByText(/Remove this bank statement\?/i)).toBeInTheDocument()
  })
})

describe('read-only roles are not offered a button they cannot use', () => {
  it('hides the control from a CA', async () => {
    // The API refuses CAs (assertCanWrite). Showing a button whose only
    // possible outcome is a rejection is worse than not showing it.
    mockUseStaffPermissions.mockReturnValue({ isOwner: false, isCA: true, canAccess: () => true, permissions: {} })
    renderScreen()
    expect(await screen.findByText('HDFC')).toBeInTheDocument()
    expect(screen.queryByLabelText(/remove the HDFC import/i)).not.toBeInTheDocument()
  })
})
