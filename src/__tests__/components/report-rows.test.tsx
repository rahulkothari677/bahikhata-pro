/**
 * @jest-environment jsdom
 *
 * 🔒 GUARD: report rows on a phone (#241) and a stock report without
 * controls that do not belong to it (#199), Phase 5f-3.
 */
import React from 'react'
import { describe, test, expect } from '@jest/globals'
import { render, screen, cleanup } from '@testing-library/react'
import { ReportRows } from '@/components/reports/ReportRows'
import { readCode } from '@/test-support/read-source'

describe('ReportRows', () => {
  test('a row: the name, one line, the one number; the rest inside the row', () => {
    render(<ReportRows rows={[{ key: 'a', title: 'INV-0003', sub: '02/10 · Anita', value: '₹25.71', details: [{ label: 'Revenue', value: '₹485.71' }, { label: 'Cost', value: '₹460' }] }]} total={{ label: 'Total profit', value: '₹269.21' }} />)
    expect(screen.getByText('INV-0003')).toBeTruthy()
    expect(screen.getByText('₹25.71')).toBeTruthy()
    expect(screen.getByText('Revenue')).toBeTruthy()
    expect(screen.getByText('₹269.21')).toBeTruthy()
    // A native <details>: it opens with a tap or the keyboard, no state to get wrong.
    expect(document.querySelector('details summary')).toBeTruthy()
    cleanup()
  })
  test('no rows: the report\'s own empty words, never an empty box', () => {
    render(<ReportRows rows={[]} empty="No sales in this period" />)
    expect(screen.getByText('No sales in this period')).toBeTruthy()
    cleanup()
  })
})

describe('#241: the six reports that swiped sideways have phone rows; the table shows from sm up', () => {
  const cases: [string, string][] = [
    ['src/components/reports/BillWiseProfit.tsx', 'bills.map'],
    ['src/components/reports/ItemWiseProfit.tsx', 'items.map'],
    ['src/components/reports/DebtAgingReport.tsx', 'agedParties.map'],
    ['src/components/reports/InventoryAgingReport.tsx', 'agedProducts'],
  ]
  test.each(cases)('%s', (file, rowsFrom) => {
    const code = readCode(file)
    expect(code).toMatch(/<ReportRows\s+className="sm:hidden"/)
    expect(code).toContain(rowsFrom)
    expect(code).toMatch(/className="hidden sm:block overflow-auto/)
  })
  test('Stock Report and Party Statement (Reports.tsx)', () => {
    const code = readCode('src/components/reports/Reports.tsx')
    const stock = code.slice(code.indexOf('function StockReport('), code.indexOf('function PartyReport('))
    const party = code.slice(code.indexOf('function PartyReport('), code.indexOf('function ReportStatCard('))
    for (const part of [stock, party]) {
      expect(part).toMatch(/<ReportRows\s+className="sm:hidden"/)
      expect(part).toMatch(/className="hidden sm:block overflow-auto/)
    }
    // Party balances in words, never a bare + or −.
    expect(party).toMatch(/' · they owe you' : p\.balance < 0 \? ' · you owe them'/)
  })
})

describe('#199: a snapshot report has no period, and no export that is not its own', () => {
  const code = readCode('src/components/reports/Reports.tsx')
  test('stock and the ageing reports are snapshots', () => {
    expect(code).toMatch(/SNAPSHOT_REPORTS: ReadonlySet<string> = new Set\(\['stock', 'inventory-aging', 'debt-aging'\]\)/)
    expect(code).toMatch(/\{!isSnapshot && <DateRangePicker/)
    expect(code).toMatch(/isSnapshot \? t\('ins\.as_of_today'\) : 'Report Period:'/)
  })
  test('GSTR-1 export only on the GST reports; Tally only for a period', () => {
    expect(code).toMatch(/features\?\.gstrExport && \(reportType === 'gst' \|\| reportType === 'hsn'\)/)
    expect(code).toMatch(/\{!isSnapshot && \(\s*<Button[^>]*onClick=\{handleTallyExport\}/)
  })
  test('toolbar buttons say what they do on a phone too (no bare icons)', () => {
    // Anchored on code (readCode strips comments); the slice must hold all four buttons, or the check proves nothing.
    const start = code.indexOf('onClick={handleCSVExport}'), end = code.indexOf('onClick={handleTallyExport}')
    expect(start).toBeGreaterThan(0)
    expect(end).toBeGreaterThan(start)
    const toolbar = code.slice(start, end + 400)
    expect(toolbar).toMatch(/handlePrint/)
    expect(toolbar).not.toMatch(/hidden sm:inline/)
  })
})
