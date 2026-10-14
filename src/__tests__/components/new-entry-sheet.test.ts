/**
 * 🔒 GUARD: the + New sheet (Phase 5a-3).
 *
 * Approved 14 Oct 2026 (ledger model v4, choice 2): a tap on + opens a sheet
 * with every kind of entry; holding + goes straight to New sale. The sheet's
 * entries are nav-registry destinations on the 'new-sheet' surface, opened by
 * the shared handleNavAction — no second list of screens, no new forms.
 */
import { describe, test, expect, jest } from '@jest/globals'
import * as fs from 'fs'
import * as path from 'path'

jest.mock('sonner', () => ({ toast: { info: jest.fn(), success: jest.fn(), error: jest.fn() } }))

import { NAV_REGISTRY, type NavDestination } from '@/lib/nav-registry'
import { translations } from '@/lib/i18n'
import { newSheetEntries } from '@/components/layout/NewEntrySheet'
import { handleNavAction } from '@/lib/handle-nav-action'
import { useAppStore } from '@/store/app-store'
import { stripComments } from '@/test-support/read-source'

const sheet = newSheetEntries(NAV_REGISTRY)
const every = [...sheet.ai, ...sheet.grid, ...(sheet.primary ? [sheet.primary] : [])]

describe('the rows read the registry the way the sheet does (good and bad input)', () => {
  test('only new-sheet entries count, ordered by sheetOrder, split by row', () => {
    const base = { label: 'x', icon: (() => null) as never, category: 'core', frequency: 'primary' }
    const fake = [
      { ...base, id: 'b', surfaces: ['new-sheet'], sheetRow: 'grid', sheetOrder: 2 },
      { ...base, id: 'a', surfaces: ['new-sheet'], sheetRow: 'grid', sheetOrder: 1 },
      { ...base, id: 'p', surfaces: ['new-sheet'], sheetRow: 'primary', sheetOrder: 0 },
      { ...base, id: 'z', surfaces: ['more'], sheetRow: 'grid', sheetOrder: 0 },
    ] as unknown as NavDestination[]
    const r = newSheetEntries(fake)
    expect(r.grid.map((d) => d.id)).toEqual(['a', 'b'])
    expect(r.primary?.id).toBe('p')
    expect(r.ai).toEqual([])
  })
})

describe('the + New sheet', () => {
  test('Scan and Speak on top, eight kinds of entry in the grid, New sale as the big button', () => {
    expect(sheet.ai.map((d) => d.id)).toEqual(['scanner', 'voice-entry'])
    expect(sheet.grid.map((d) => d.id)).toEqual(['new-purchase', 'got-payment', 'gave-payment', 'new-income-expense', 'estimates', 'sale-return', 'add-product', 'add-party'])
    expect(sheet.primary?.id).toBe('new-sale')
  })

  test('every entry opens a screen that already exists, and has its short name in English and Hindi', () => {
    const en = translations.en as unknown as Record<string, string>
    const hi = translations.hi as unknown as Record<string, string>
    for (const d of every) {
      expect(d.view).toBeTruthy()
      expect(en[d.shortLabelKey!]).toBeTruthy()
      expect(hi[d.shortLabelKey!]).toBeTruthy()
    }
  })

  test('"Gave payment" opens Khata on Suppliers and "Got payment" on Customers', () => {
    const gave = every.find((d) => d.id === 'gave-payment')!
    handleNavAction(gave)
    expect(useAppStore.getState().currentView).toBe('parties')
    expect(useAppStore.getState().khataSide).toBe('supplier')
    handleNavAction(every.find((d) => d.id === 'got-payment')!)
    expect(useAppStore.getState().khataSide).toBe('customer')
  })

  test('the + button: a tap opens the sheet, holding goes straight to New sale', () => {
    const code = stripComments(fs.readFileSync(path.resolve(process.cwd(), 'src/components/layout/MobileBottomNav.tsx'), 'utf8'))
    const click = code.slice(code.indexOf('const handlePlusClick'), code.indexOf('const handlePlusClick') + 400)
    expect(click).toMatch(/setNewSheetOpen\(true\)/)
    expect(click).not.toMatch(/setView\('new-sale'\)/)
    const hold = code.slice(code.indexOf('const handlePlusTouchStart'), code.indexOf('const handlePlusTouchEnd'))
    expect(hold).toMatch(/setView\('new-sale'\)/)
  })
})
