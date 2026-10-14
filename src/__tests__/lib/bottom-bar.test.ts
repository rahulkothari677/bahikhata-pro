/**
 * 🔒 GUARD: the bottom bar is Home · Bills · + · Khata · More (Phase 5a-2).
 *
 * Approved 14 Oct 2026 (ledger model v4, choice 1: Bills in the bar, not
 * Items). Bills is the Sales ledger and also lights on Purchases; Khata is
 * Parties and stays lit on a party's pages. The bar reads all of this from the
 * nav registry, so the registry is what is checked — plus the one line in the
 * bar that decides which tab is lit.
 */
import { describe, test, expect } from '@jest/globals'
import * as fs from 'fs'
import * as path from 'path'
import { NAV_REGISTRY, type NavDestination } from '@/lib/nav-registry'
import { translations } from '@/lib/i18n'
import { stripComments } from '@/test-support/read-source'

/** The bar's tabs in the order the bar draws them (sortOrder), as the bar names them. */
function barTabs(registry: NavDestination[]) {
  return registry
    .filter((d) => d.surfaces?.includes('bottom-nav'))
    .sort((a, b) => (a.sortOrder || 0) - (b.sortOrder || 0))
    .map((d) => ({ id: d.id, nameKey: d.shortLabelKey ?? d.labelKey, lit: d.barActiveViews ?? [d.view] }))
}

describe('the rule reads the bar the way the bar does (good and bad input)', () => {
  const base = { label: 'x', icon: (() => null) as never, actionKind: 'navigate', category: 'core', frequency: 'primary' } as const
  test('order follows sortOrder and only bottom-nav entries count', () => {
    const fake = [
      { ...base, id: 'b', view: 'sales', surfaces: ['bottom-nav'], sortOrder: 3, shortLabelKey: 'nav.bills' },
      { ...base, id: 'a', view: 'dashboard', surfaces: ['bottom-nav'], sortOrder: 1 },
      { ...base, id: 'z', view: 'purchases', surfaces: ['sidebar-main'], sortOrder: 2 },
    ] as unknown as NavDestination[]
    expect(barTabs(fake).map((t) => t.id)).toEqual(['a', 'b'])
    expect(barTabs(fake)[1].nameKey).toBe('nav.bills')
  })
})

describe('the bottom bar', () => {
  const tabs = barTabs(NAV_REGISTRY)

  test('is Home, Bills, Khata (with + and More drawn by the bar itself)', () => {
    expect(tabs.map((t) => t.id)).toEqual(['dashboard', 'sales', 'parties'])
    expect(tabs.map((t) => t.nameKey)).toEqual(['nav.home', 'nav.bills', 'nav.khata'])
  })

  test('Purchases is not its own tab: it lives inside Bills, which stays lit on it', () => {
    expect(NAV_REGISTRY.find((d) => d.id === 'purchases')?.surfaces).not.toContain('bottom-nav')
    expect(tabs.find((t) => t.id === 'sales')?.lit).toEqual(expect.arrayContaining(['sales', 'purchases']))
  })

  test('Khata stays lit on a party\'s pages', () => {
    expect(tabs.find((t) => t.id === 'parties')?.lit).toEqual(expect.arrayContaining(['parties', 'party-profile']))
  })

  test('every tab name exists in English and in Hindi', () => {
    const en = translations.en as unknown as Record<string, string>
    const hi = translations.hi as unknown as Record<string, string>
    for (const t of tabs) {
      expect(en[t.nameKey!]).toBeTruthy()
      expect(hi[t.nameKey!]).toBeTruthy()
    }
    expect([en['nav.home'], en['nav.bills'], en['nav.khata']]).toEqual(['Home', 'Bills', 'Khata'])
  })

  test('the bar lights a tab from barActiveViews, not from the view name alone', () => {
    const code = stripComments(fs.readFileSync(path.resolve(process.cwd(), 'src/components/layout/MobileBottomNav.tsx'), 'utf8'))
    expect(code).toMatch(/barActiveViews/)
    expect(code).not.toMatch(/const isActive = currentView === tabView/)
  })
})
