/**
 * 🔒 GUARD: the desktop menu has a word under every icon, and speaks the
 * phone's language (Phase 5a-5, #168).
 *
 * Was: ten bare icons in the narrow menu (the wide one had words but
 * different names: "Dashboard", "Sales", "Parties" where the phone says Home,
 * Bills, Khata), Ask first, and Sales and Purchases as two entries while the
 * screen they open already had a Sales | Purchases switch. Each surface also
 * had its own copy of "which name to show" and "which entry is lit".
 *
 * Now: one order (menuOrder; the bar's tabs first, in the bar's order), one
 * name function (navShortName) and one lit rule (isNavActive) for the bar,
 * the + sheet, More and the menu.
 */
import { describe, test, expect, jest } from '@jest/globals'

jest.mock('sonner', () => ({ toast: { info: jest.fn(), success: jest.fn(), error: jest.fn() } }))

import { NAV_REGISTRY, isNavActive, navShortName, type NavDestination } from '@/lib/nav-registry'
import { translations } from '@/lib/i18n'
import { desktopMenu } from '@/components/layout/Sidebar'
import { headerTitleKey } from '@/components/layout/Header'
import { readCode } from '@/test-support/read-source'

/** The menu must open with the bar's tabs, in the bar's order. Returns what is out of place. */
function menuOrderProblems(menuIds: string[], barIds: string[]): string[] {
  return barIds.filter((id, i) => menuIds[i] !== id)
}

/** Words too long to wrap inside the narrow menu's 60 px at 12 px. */
const RAIL_MAX_WORD = 9
function longWords(names: string[], max = RAIL_MAX_WORD): string[] {
  return names.flatMap((n) => n.split(/\s+/)).filter((w) => [...w].length > max)
}

/** A surface that works out a short name itself instead of calling navShortName. */
function ownNameRule(code: string): boolean {
  return /shortLabelKey\s*\?\?/.test(code) || /labelKey\s*\?\s*t\(/.test(code)
}

describe('the rules (good and bad input)', () => {
  test('menu order: bar tabs first, in the bar\'s order', () => {
    expect(menuOrderProblems(['home', 'bills', 'khata', 'items'], ['home', 'bills', 'khata'])).toEqual([])
    expect(menuOrderProblems(['ask', 'home', 'bills', 'khata'], ['home', 'bills', 'khata'])).toEqual(['home', 'bills', 'khata'])
    expect(menuOrderProblems(['home', 'khata', 'bills'], ['home', 'bills', 'khata'])).toEqual(['bills', 'khata'])
  })
  test('long words are caught', () => {
    expect(longWords(['Items & stock', 'Cashbook'])).toEqual([])
    expect(longWords(['Bank Reconciliation'])).toEqual(['Reconciliation'])
  })
  test('a second copy of the name rule is caught', () => {
    expect(ownNameRule("const name = navShortName(item, t)")).toBe(false)
    expect(ownNameRule("const name = t(d.shortLabelKey ?? d.labelKey ?? '') || d.label")).toBe(true)
    expect(ownNameRule("aria-label={item.labelKey ? t(item.labelKey) : item.label}")).toBe(true)
  })
  test('the lit rule: activeViews when set, else the entry\'s own view', () => {
    const base = { activeViews: undefined, view: 'inventory' } as Pick<NavDestination, 'activeViews' | 'view'>
    expect(isNavActive(base, 'inventory')).toBe(true)
    expect(isNavActive(base, 'sales')).toBe(false)
    expect(isNavActive({ view: 'sales', activeViews: ['sales', 'purchases'] }, 'purchases')).toBe(true)
  })
})

describe('the desktop menu', () => {
  const menu = desktopMenu(NAV_REGISTRY)
  const ids = menu.map((d) => d.id)
  const bar = NAV_REGISTRY.filter((d) => d.surfaces?.includes('bottom-nav'))
    .sort((a, b) => (a.sortOrder || 0) - (b.sortOrder || 0)).map((d) => d.id)
  const en = translations.en as unknown as Record<string, string>
  const hi = translations.hi as unknown as Record<string, string>

  test('Home, Bills, Khata, Items & stock, Cashbook, Reports, Tools, then Scan and Ask', () => {
    expect(ids).toEqual(['dashboard', 'sales', 'parties', 'inventory', 'income-expense', 'reports', 'tools', 'scanner', 'ask'])
  })

  test('opens with the bar\'s tabs in the bar\'s order; every entry has its own place', () => {
    expect(menuOrderProblems(ids, bar)).toEqual([])
    const orders = menu.map((d) => d.menuOrder)
    expect(orders.every((o) => typeof o === 'number')).toBe(true)
    expect(new Set(orders).size).toBe(orders.length)
  })

  test('Purchases is not its own entry: Bills holds both and stays lit on it', () => {
    expect(ids).not.toContain('purchases')
    const bills = menu.find((d) => d.id === 'sales')!
    for (const v of ['sales', 'purchases', 'new-sale', 'new-purchase', 'transaction-detail']) {
      expect({ v, lit: isNavActive(bills, v) }).toEqual({ v, lit: true })
    }
    expect(isNavActive(bills, 'parties')).toBe(false)
  })

  test('Khata stays lit on a party\'s pages; Home only on Home', () => {
    const khata = menu.find((d) => d.id === 'parties')!
    const home = menu.find((d) => d.id === 'dashboard')!
    expect(isNavActive(khata, 'party-profile')).toBe(true)
    expect(isNavActive(home, 'dashboard')).toBe(true)
    expect(isNavActive(home, 'sales')).toBe(false)
  })

  test('every word fits under its icon, in English and Hindi', () => {
    const tEn = (k: string) => en[k] ?? ''
    const tHi = (k: string) => hi[k] ?? ''
    const namesEn = menu.map((d) => navShortName(d, tEn))
    const namesHi = menu.map((d) => navShortName(d, tHi))
    expect(namesEn).toEqual(['Home', 'Bills', 'Khata', 'Items & stock', 'Cashbook', 'Reports', 'Tools', 'Scan a bill', 'Ask your books'])
    expect(longWords(namesEn)).toEqual([])
    expect(longWords(namesHi)).toEqual([])
    // A Hindi name that is still the English one was never translated.
    expect(menu.filter((d, i) => namesHi[i] === namesEn[i]).map((d) => d.id)).toEqual([])
  })

  test('every surface takes its names from navShortName, none keeps its own copy', () => {
    for (const file of ['Sidebar', 'MobileBottomNav', 'MoreScreen', 'NewEntrySheet']) {
      const code = readCode(`src/components/layout/${file}.tsx`)
      expect({ file, ownRule: ownNameRule(code), usesShared: /navShortName\(/.test(code) })
        .toEqual({ file, ownRule: false, usesShared: true })
    }
  })

  test('every screen the app draws under the header has a title of its own, in English and Hindi', () => {
    // 5a-5: Tools and a party's bills had none and fell back to "Dashboard".
    const drawn = (code: string) => [...code.matchAll(/\{currentView === '([a-z-]+)' && [(<]/g)].map((m) => m[1])
    expect(drawn("{currentView === 'tools' && <ToolsHub />}{currentView === 'pricing' && (")).toEqual(['tools', 'pricing'])
    const views = drawn(readCode('src/app/page.tsx')).filter((v) => v !== 'dashboard')
    expect(views.length).toBeGreaterThan(15)
    const missing = views.filter((v) => {
      const key = headerTitleKey(v)
      return !key || !en[key] || !hi[key]
    })
    expect(missing).toEqual([])
    // The header and the menu agree on the screens both name.
    for (const d of menu.filter((x) => x.view && x.view !== 'dashboard' && x.id !== 'ask')) {
      for (const lang of [en, hi]) {
        const tl = (k: string) => lang[k] ?? ''
        expect({ id: d.id, title: tl(headerTitleKey(d.view!) ?? '') }).toEqual({ id: d.id, title: navShortName(d, tl) })
      }
    }
  })

  test('the menu lights entries with isNavActive, not its own list of special cases', () => {
    const code = readCode('src/components/layout/Sidebar.tsx')
    expect(code).toMatch(/isNavActive\(item, currentView\)/)
    expect(code).not.toMatch(/currentView === 'party-profile' && itemId/)
  })
})
