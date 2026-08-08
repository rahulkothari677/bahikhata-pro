/**
 * @jest-environment jsdom
 *
 * The "can I file?" card must be on the GSTR-3B screen once the figures load.
 *
 * WHY (2026-08-08). Four separate warning banners were removed from this screen
 * and replaced by one FilingReadiness card. The card was mounted only inside the
 * `if (isLoading) return (...)` early-return branch, so it appeared for a moment
 * while the 3B figures loaded and then vanished for good.
 *
 * Everything else passed. Typecheck, lint, 3,034 unit tests and the production
 * build were all green; /api/gst-readiness returned a correct blocker in
 * production. The screen simply showed nothing, and because the old banners had
 * been deleted in the same commit, the shopkeeper was left with NO warning at
 * all that 34 sales were missing an HSN code — strictly worse than the stack of
 * boxes it replaced.
 *
 * The bug class is "rendered in one branch of an early-return component". No
 * test that reads the API can see it and no type can catch it, because both
 * branches are valid JSX. Only rendering the real component in each state can.
 *
 * So this drives the real Gstr3bReport in BOTH states and asserts the readiness
 * content is on screen. Reverting either mount point fails this file.
 */
import React from 'react'
import { render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

const mockOfflineFetch = jest.fn()
jest.mock('@/lib/offline-fetch', () => ({
  offlineFetch: (...a: unknown[]) => mockOfflineFetch(...a),
  isQueuedResponse: () => false,
}))
jest.mock('@/lib/haptic', () => ({ haptic: { success: jest.fn(), error: jest.fn() } }))
jest.mock('sonner', () => ({ toast: { success: jest.fn(), error: jest.fn() } }))

const mockSetView = jest.fn()
jest.mock('@/store/app-store', () => ({
  useAppStore: (sel: (s: unknown) => unknown) => sel({ setView: mockSetView }),
}))

import { Gstr3bReport } from '@/components/reports/Gstr3bReport'

/** A month with one real blocker, the shape production returns. */
const READINESS_WITH_BLOCKER = {
  ready: false,
  blockers: 1,
  warnings: 1,
  checks: [
    {
      id: 'hsn-missing',
      severity: 'blocker',
      title: '34 sales are missing an HSN code',
      detail: 'Add the code on Sugar, Rice, Oil and others.',
      amount: 10058.9,
      action: { label: 'Open Inventory', view: 'inventory' },
    },
    {
      id: 'itc-unverified',
      severity: 'warn',
      title: 'Input credit has not been checked against GSTR-2B',
      detail: 'Import this month’s GSTR-2B.',
      action: { label: 'Import GSTR-2B', view: 'reports' },
    },
    {
      id: 'itc-blocked',
      severity: 'info',
      title: 'Some GST cannot be claimed back',
      detail: 'You marked 1 purchase as not eligible.',
      amount: 180,
    },
  ],
}

const GSTR3B = {
  period: { monthLabel: 'August 2026' },
  totalOutputTax: 54655.21,
  totalItc: 180,
  netTaxPayable: 54439.21,
  invoiceCount: 30,
  outward: {},
  snapshot: null,
}

function ok(body: unknown) {
  return Promise.resolve({ ok: true, status: 200, json: async () => body })
}

function renderReport() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={qc}>
      <Gstr3bReport />
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  mockOfflineFetch.mockReset()
  mockSetView.mockReset()
})

describe('GSTR-3B screen surfaces filing readiness', () => {
  it('shows the blocker once the 3B figures have loaded', async () => {
    mockOfflineFetch.mockImplementation((url: string) =>
      url.includes('/api/gst-readiness') ? ok(READINESS_WITH_BLOCKER) : ok(GSTR3B),
    )

    renderReport()

    // The figures arrive, so the component leaves its loading branch...
    await waitFor(() => expect(screen.getByText('August 2026')).toBeInTheDocument())

    // ...and the readiness card must still be here. This is the assertion that
    // failed in production while every other check passed.
    expect(await screen.findByText('34 sales are missing an HSN code')).toBeInTheDocument()
    expect(screen.getByText(/Fix 1 thing before filing/)).toBeInTheDocument()
  })

  it('shows readiness while the 3B figures are still loading', async () => {
    // Readiness resolves; the 3B request never does, holding the loading branch.
    mockOfflineFetch.mockImplementation((url: string) =>
      url.includes('/api/gst-readiness') ? ok(READINESS_WITH_BLOCKER) : new Promise(() => {}),
    )

    renderReport()

    expect(await screen.findByText('34 sales are missing an HSN code')).toBeInTheDocument()
  })

  it('gives the shopkeeper a way to act on a blocker', async () => {
    mockOfflineFetch.mockImplementation((url: string) =>
      url.includes('/api/gst-readiness') ? ok(READINESS_WITH_BLOCKER) : ok(GSTR3B),
    )

    renderReport()

    const door = await screen.findByRole('button', { name: /Open Inventory/ })
    door.click()
    await waitFor(() => expect(mockSetView).toHaveBeenCalledWith('inventory'))
  })

  it('separates a warning from information, so a correct figure is not alarming', async () => {
    mockOfflineFetch.mockImplementation((url: string) =>
      url.includes('/api/gst-readiness') ? ok(READINESS_WITH_BLOCKER) : ok(GSTR3B),
    )

    renderReport()

    // Blocked credit under Section 17(5) is the law working, not a problem, and
    // must not be presented with the same weight as a missing HSN code.
    const info = await screen.findByText('Some GST cannot be claimed back')
    const blocker = screen.getByText('34 sales are missing an HSN code')
    expect(info.className).toMatch(/text-muted-foreground/)
    expect(blocker.className).not.toMatch(/text-muted-foreground/)
  })

  it('stays quiet when the month is clean', async () => {
    mockOfflineFetch.mockImplementation((url: string) =>
      url.includes('/api/gst-readiness')
        ? ok({ ready: true, blockers: 0, warnings: 0, checks: [{ id: 'hsn-missing', severity: 'ok', title: 'Every sale has an HSN code', detail: '' }] })
        : ok(GSTR3B),
    )

    renderReport()

    await waitFor(() => expect(screen.getByText('August 2026')).toBeInTheDocument())
    expect(await screen.findByText('Ready to file')).toBeInTheDocument()
    // One line, not a list of green ticks.
    expect(screen.queryByText('Every sale has an HSN code')).not.toBeInTheDocument()
  })
})
