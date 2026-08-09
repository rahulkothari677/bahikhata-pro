/**
 * @jest-environment jsdom
 *
 * The notice-risk card must actually be on the GSTR-3B screen.
 *
 * WHY THIS FILE EXISTS. The FilingReadiness card was once mounted only inside
 * the `if (isLoading) return (...)` branch of this exact component. Typecheck,
 * lint, 3,000+ unit tests and the production build were all green, the API
 * returned correct data — and the card was invisible. Both branches are valid
 * JSX, so nothing but rendering the real component can catch it.
 *
 * NoticeRisk is mounted in the same file, one slot below, so it is exposed to
 * the same failure. These tests drive the real Gstr3bReport and assert the
 * card's content is on screen. Deleting the mount fails this file.
 *
 * They also pin the WORDING that carries the meaning. "Rule 88C" alone tells a
 * shopkeeper nothing; "your next GSTR-1 will be blocked" is the sentence that
 * makes them act, and a refactor that quietly drops it removes the point of
 * the feature while leaving the card on screen.
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
jest.mock('@/store/app-store', () => ({
  useAppStore: (sel: (s: unknown) => unknown) => sel({ setView: jest.fn() }),
}))

import { Gstr3bReport } from '@/components/reports/Gstr3bReport'

const GSTR3B = {
  period: { monthLabel: 'August 2026' },
  totalOutputTax: 162.5,
  totalItc: 0,
  netTaxPayable: 100,
  invoiceCount: 2,
  outward: {},
  snapshot: null,
}

const READY = { ready: true, blockers: 0, warnings: 0, checks: [] }
const AGREED = { matched: true, reconcilingItems: [], unexplained: 0 }

/** Both thresholds crossed — an intimation is automatic. */
const RISK_NOTICE = {
  month: '2026-08',
  overall: 'notice',
  anyNotice: true,
  rules: [{
    rule: '88C',
    level: 'notice',
    excess: 3_100_000,
    excessPercent: 31,
    base: 10_000_000,
    crossedPercent: true,
    crossedAbsolute: true,
    headline: 'Your GSTR-1 declares ₹31,00,000 more tax than your GSTR-3B pays.',
    consequence: 'You would receive a DRC-01B intimation. You then have 7 days to pay the difference or explain it in Part B — and until you do, the portal will NOT let you file your next GSTR-1.',
    action: 'Either pay the difference in this GSTR-3B before filing, or check whether an invoice in GSTR-1 is wrong.',
  }],
  inputs: { hasGstr2b: true },
  avoided: null,
}

const RISK_CLEAR = {
  month: '2026-08',
  overall: 'clear',
  anyNotice: false,
  rules: [
    { rule: '88C', level: 'clear', excess: 0, excessPercent: 0, base: 162.5, crossedPercent: false, crossedAbsolute: false, headline: 'Your GSTR-1 and GSTR-3B declare the same tax.', consequence: null, action: null },
    { rule: '88D', level: 'clear', excess: 0, excessPercent: 0, base: 0, crossedPercent: false, crossedAbsolute: false, headline: 'Your input credit claim is within what GSTR-2B allows.', consequence: null, action: null },
  ],
  inputs: { hasGstr2b: true },
  avoided: null,
}

function ok(body: unknown) {
  return Promise.resolve({ ok: true, status: 200, json: async () => body })
}

function route(risk: unknown) {
  return (url: string) => {
    if (url.includes('/api/notice-risk')) return ok(risk)
    if (url.includes('/api/gst-readiness')) return ok(READY)
    if (url.includes('/api/gst-reconciliation')) return ok(AGREED)
    return ok(GSTR3B)
  }
}

function renderReport() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={qc}>
      <Gstr3bReport />
    </QueryClientProvider>,
  )
}

beforeEach(() => mockOfflineFetch.mockReset())

describe('GSTR-3B screen surfaces the notice risk', () => {
  it('warns before filing when both Rule 88C thresholds are crossed', async () => {
    mockOfflineFetch.mockImplementation(route(RISK_NOTICE))
    renderReport()

    // The figures arrive, so we are past the loading branch...
    await waitFor(() => expect(screen.getByText('August 2026')).toBeInTheDocument())

    // ...and the card must be here. This is the assertion that would have
    // caught the FilingReadiness bug.
    expect(await screen.findByText(/Filing this would trigger an automatic notice/)).toBeInTheDocument()
    expect(screen.getByText(/Rule 88C · DRC-01B/)).toBeInTheDocument()
  })

  it('states the consequence that actually changes behaviour', async () => {
    mockOfflineFetch.mockImplementation(route(RISK_NOTICE))
    renderReport()

    // Not the tax — the block. A shopkeeper weighing "shall I sort this now or
    // later" decides on this sentence.
    expect(await screen.findByText(/will NOT let you file your next GSTR-1/)).toBeInTheDocument()
    expect(screen.getByText(/7 days/)).toBeInTheDocument()
  })

  it('shows WHICH of the two limits was crossed, not just that one was', async () => {
    mockOfflineFetch.mockImplementation(route(RISK_NOTICE))
    renderReport()

    expect(await screen.findByText(/over 20%/)).toBeInTheDocument()
    expect(screen.getByText(/over ₹25 lakh/)).toBeInTheDocument()
  })

  it('tells the shopkeeper what to do about it', async () => {
    mockOfflineFetch.mockImplementation(route(RISK_NOTICE))
    renderReport()

    expect(await screen.findByText(/What to do:/)).toBeInTheDocument()
  })

  it('says something on a clean month rather than rendering nothing', async () => {
    // A card that disappears when all is well is indistinguishable from a card
    // that failed to load, and the shopkeeper learns nothing was checked.
    mockOfflineFetch.mockImplementation(route(RISK_CLEAR))
    renderReport()

    expect(await screen.findByText(/No automatic notice from this filing/)).toBeInTheDocument()
    expect(screen.getByText(/Rule 88C/)).toBeInTheDocument()
  })

  it('does not claim Rule 88D was checked when no GSTR-2B was imported', async () => {
    // Treating a missing 2B as "zero credit available" would accuse an ordinary
    // shop of over-claiming its whole ITC. Say it was not checked instead.
    mockOfflineFetch.mockImplementation(route({
      ...RISK_CLEAR,
      rules: [RISK_CLEAR.rules[0]],
      inputs: { hasGstr2b: false },
    }))
    renderReport()

    expect(await screen.findByText(/Rule 88D not checked/)).toBeInTheDocument()
  })
})
