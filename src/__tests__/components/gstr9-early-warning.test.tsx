/**
 * @jest-environment jsdom
 *
 * 9c-1 (#124): before 30 November after the year, the GSTR-9 screen warns that
 * filing it ends that year's corrections, credit claims and credit notes early
 * (s.37(3), s.16(4), s.34(2) — "or the annual return, if earlier"). After the
 * date there is nothing left to lose, and the warning goes.
 */
import React from 'react'
import { render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { readCode } from '@/test-support/read-source'
import { amendmentDeadline } from '@/lib/gstr1-amendments'
import { gstr9Due } from '@/lib/gst-due-dates'

const mockOfflineFetch = jest.fn()
jest.mock('@/lib/offline-fetch', () => ({ offlineFetch: (...a: unknown[]) => mockOfflineFetch(...a) }))

import { Gstr9Report, lastFinishedFy } from '@/components/reports/Gstr9Report'

const tax = { taxableValue: 0, cgst: 0, sgst: 0, igst: 0 }
const report = (earlyFiling: unknown) => ({
  coverage: { complete: true, missing: [] },
  checks: [],
  table4: { b2b: tax, b2c: tax, creditNotesI: tax, debitNotesJ: tax, rcmInward: tax, subTotalH: tax, subTotalM: tax, totalN: tax },
  table5: { exemptedD: 0, nilRatedE: 0, nonGstF: 0, subTotalG: 0, totalTurnoverN: 0 },
  table6: { splitUnavailable: true, totalItcPer3bA: { cgst: 0, sgst: 0, igst: 0 } },
  filing: { turnover: 0, isMandatory: false, dueDate: '31 December 2026', earlyFiling },
})
const ok = (body: unknown) => Promise.resolve({ ok: true, status: 200, json: async () => body })
const renderScreen = () => render(
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    <Gstr9Report />
  </QueryClientProvider>,
)

beforeEach(() => mockOfflineFetch.mockReset())

it('before 30 November: warns what filing early ends', async () => {
  mockOfflineFetch.mockReturnValue(ok(report({ closesOn: '30 Nov 2026', daysLeft: 18 })))
  renderScreen()
  const n = await screen.findByTestId('gstr9-early-warning')
  expect(n).toHaveTextContent(/Filing before 30 Nov 2026 closes \d{4}-\d{2} early/)
  expect(n).toHaveTextContent(/No corrections, credit claims or credit notes/)
})

it('after it: no warning', async () => {
  mockOfflineFetch.mockReturnValue(ok(report(null)))
  renderScreen()
  expect(await screen.findByText(/All 12 months are filed/)).toBeInTheDocument()
  expect(screen.queryByTestId('gstr9-early-warning')).not.toBeInTheDocument()
})

describe('the dates come from the one rule', () => {
  it('FY 2025-26: corrections, credit and credit notes end 30 Nov 2026; GSTR-9 due 31 Dec 2026', () => {
    const d = amendmentDeadline('032026', new Date(2026, 10, 12))
    expect([d.novemberCutoff.getFullYear(), d.novemberCutoff.getMonth(), d.novemberCutoff.getDate()]).toEqual([2026, 10, 30])
    expect(d.daysLeft).toBe(18)
    const due = gstr9Due(2025)
    expect([due.getFullYear(), due.getMonth(), due.getDate()]).toEqual([2026, 11, 31])
  })

  it('the screen opens on the last finished year — the one a GSTR-9 is filed for', () => {
    expect(lastFinishedFy(new Date(2026, 10, 12))).toBe('2025-26')   // 12 Nov 2026
    expect(lastFinishedFy(new Date(2027, 2, 31))).toBe('2025-26')    // 31 Mar 2027: 2026-27 not over yet
    expect(lastFinishedFy(new Date(2027, 3, 1))).toBe('2026-27')     // 1 Apr 2027
  })

  it('the GSTR-9 route asks amendmentDeadline for the year’s last month, and gstr9Due for the date', () => {
    const code = readCode('app/api/gstr-9/route.ts')
    expect(code).toContain('amendmentDeadline(`03${fyStart + 1}`)')
    // and warns only once the year has ended
    expect(code).toContain('const yearEnded = new Date() >= new Date(fyStart + 1, 3, 1)')
    expect(code).toContain('earlyFiling: cutoff.expired || !yearEnded ? null : {')
    expect(code).toContain('gstr9Due(fyStart)')
    expect(code).not.toMatch(/31 December \$\{/)
  })
})
