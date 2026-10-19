/**
 * 🔒 GUARD: the Bills screen (Phase 5d-2, ledger model v4).
 *
 * - A total never comes from the rows loaded so far (#184): every figure on
 *   the screen is the server's for the whole period; the list holds no money
 *   sums of its own.
 * - Bills fall under their IST day — a bill at 23:30 IST belongs to that day,
 *   the same key the totals route groups by.
 * - The Unpaid chip means "still due after later settlements" (DUE_SQL),
 *   picked by the server, and does not change the period's totals.
 * - A purchase with no supplier reads "Cash purchase" (#202).
 */
import { describe, test, expect, jest } from '@jest/globals'
import { billDayKey, billDayLabel, groupByDay } from '@/lib/bill-days'
import { billWhereSql, parseBillFilters } from '@/lib/bill-filters'
import { readCode } from '@/test-support/read-source'

const words = { today: 'Today', yesterday: 'Yesterday' }

describe('bills by IST day', () => {
  test('23:30 IST on 1 Oct is the 1st; 00:30 IST on 2 Oct is the 2nd', () => {
    expect(billDayKey('2026-10-01T18:00:00.000Z')).toBe('2026-10-01T00:00:00.000Z')
    expect(billDayKey('2026-10-01T19:00:00.000Z')).toBe('2026-10-02T00:00:00.000Z')
  })
  test('labels: today, yesterday, then the date (with the year when it is another year)', () => {
    const now = new Date('2026-10-19T06:00:00.000Z')
    expect(billDayLabel('2026-10-19T00:00:00.000Z', now, words)).toBe('Today')
    expect(billDayLabel('2026-10-18T00:00:00.000Z', now, words)).toBe('Yesterday')
    expect(billDayLabel('2026-10-01T00:00:00.000Z', now, words)).toMatch(/Thu.*1.*Oct/)
    expect(billDayLabel('2025-12-31T00:00:00.000Z', now, words)).toMatch(/2025/)
  })
  test('groups keep the list order and split only where the day changes', () => {
    const rows = [{ id: 'a', date: '2026-10-02T05:00:00Z' }, { id: 'b', date: '2026-10-01T19:00:00Z' }, { id: 'c', date: '2026-10-01T10:00:00Z' }]
    expect(groupByDay(rows).map((g) => [g.key.slice(0, 10), g.rows.map((r) => r.id)])).toEqual([['2026-10-02', ['a', 'b']], ['2026-10-01', ['c']]])
  })
})

describe('the Unpaid chip', () => {
  test('status=unpaid adds the "still due after settlements" rule to the SQL, nothing else does', () => {
    const f = parseBillFilters(new URLSearchParams('type=sale&status=unpaid'))
    expect(f.unpaid).toBe(true)
    expect(billWhereSql('u1', f).sql).toContain('t."totalAmount" - t."paidAmount" - COALESCE(a.alloc, 0)')
    expect(billWhereSql('u1', { ...f, unpaid: false }).sql).not.toContain('a.alloc')
  })
  test('the list picks unpaid ids in SQL with the same keyset order; the totals ignore the chip', () => {
    const list = readCode('src/app/api/transactions/route.ts')
    expect(list).toMatch(/if \(filters\.unpaid\)/)
    expect(list).toMatch(/ORDER BY t\."date" DESC, t\."id" DESC/)
    expect(readCode('src/app/api/transactions/summary/route.ts')).toMatch(/unpaid: false/)
  })
})

describe('the screen', () => {
  const ledger = readCode('src/components/ledger/Ledger.tsx')
  test('totals come from the server for the whole period; no money is summed from loaded rows', () => {
    expect(ledger).toMatch(/useBillTotals\(isSale \? 'sale' : 'purchase'/)
    expect(ledger).not.toMatch(/\.reduce\(/)
    expect(ledger).not.toMatch(/First \$\{filtered\.length\} · scroll for more/)
  })
  test('a saved estimate says where it went: "See estimates" opens Bills on the Estimates chip (#185)', () => {
    const entry = readCode('src/components/ledger/TransactionEntry.tsx')
    expect(entry).toMatch(/action: \{ label: 'See estimates', onClick: \(\) => \{ useAppStore\.getState\(\)\.requestOnArrival\('sales', 'show-estimates'\)/)
    // Shown once the screen has moved on, so the save's own navigation cannot overtake a tap.
    const moved = entry.lastIndexOf('if (previousView && !ENTRY_FORMS.includes(previousView))')
    const shown = entry.indexOf('estimateToast?.()')
    expect({ afterMove: shown > moved, insideSave: shown < entry.indexOf('const handleCancel = ()') }).toEqual({ afterMove: true, insideSave: true })
    expect(entry).toMatch(/const ENTRY_FORMS: string\[\] = \['new-sale', 'new-purchase', 'new-estimate'\]/)
    expect(ledger).toMatch(/useArrivalRequest\('sales', 'show-estimates', \(\) => setChip\('est'\)\)/)
  })
  test('the totals strip names its period ("All time" when none is chosen)', () => {
    expect(ledger).toMatch(/dateRange \? getPresetLabel\(datePreset\) : t\('bills\.all_time'\)/)
  })
  test('an empty chip says "none of these", before the first-run "no sales yet" state', () => {
    const chipEmpty = ledger.indexOf("filtered.length === 0 && chip !== 'all'")
    const firstRun = ledger.indexOf(') : filtered.length === 0 ? (')
    expect({ chipEmpty: chipEmpty > 0, before: chipEmpty < firstRun }).toEqual({ chipEmpty: true, before: true })
  })
  test('every Bills word exists in English and Hindi', () => {
    const { translations } = jest.requireActual('@/lib/i18n') as typeof import('@/lib/i18n')
    const en = translations.en as unknown as Record<string, string>, hi = translations.hi as unknown as Record<string, string>
    const keys = Object.keys(en).filter((k) => k.startsWith('bills.'))
    expect(keys.length).toBeGreaterThanOrEqual(18)
    expect(keys.filter((k) => !hi[k])).toEqual([])
    for (const c of ['unpaid', 'est', 'ret']) expect(en[`bills.none.${c}`]).toBeTruthy()
  })
  test('All lists bills and returns (estimates have their own chip); a supplier-less purchase is a cash purchase', () => {
    expect(ledger).toMatch(/chip === 'est' \? \['estimate'\] : chip === 'ret' \? \[note\] : chip === 'unpaid' \? \[bill\] : \[bill, note\]/)
    expect(ledger).toMatch(/isSale \? 'Walk-in Customer' : t\('bills\.cash_purchase'\)/)
  })
})
