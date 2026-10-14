/**
 * 🔒 GUARD: More is one flat page, and each thing has one home (Phase 5a-4).
 *
 * Was: eleven collapsed folders; Inventory three taps deep (#196); new
 * entries, Parties and every single report listed in More as well as in their
 * own places. Approved 14 Oct 2026 (ledger model v4 §7): three open groups —
 * Shop books, Tools, Grow — then Shop & settings and Help.
 */
import { describe, test, expect, jest } from '@jest/globals'

jest.mock('sonner', () => ({ toast: { info: jest.fn(), success: jest.fn(), error: jest.fn() } }))

import { NAV_REGISTRY, type NavDestination } from '@/lib/nav-registry'
import { translations } from '@/lib/i18n'
import { moreGroups } from '@/components/layout/MoreScreen'

/** Ids that sit on More AND on one of the homes More must not duplicate. */
function duplicatedHomes(registry: NavDestination[]): string[] {
  const homes = ['bottom-nav', 'account'] as const
  return registry
    .filter((d) => d.surfaces?.includes('more') && homes.some((h) => d.surfaces?.includes(h)))
    .map((d) => d.id)
}

describe('the rules (good and bad input)', () => {
  const base = { label: 'x', icon: (() => null) as never, category: 'core', frequency: 'secondary' }
  test('groups come out in Shop books, Tools, Grow order, sorted by moreOrder, empty groups dropped', () => {
    const fake = [
      { ...base, id: 't2', surfaces: ['more'], moreGroup: 'tools', moreOrder: 2 },
      { ...base, id: 't1', surfaces: ['more'], moreGroup: 'tools', moreOrder: 1 },
      { ...base, id: 'b1', surfaces: ['more'], moreGroup: 'books', moreOrder: 1 },
      { ...base, id: 'x', surfaces: ['sidebar-main'], moreGroup: 'grow', moreOrder: 1 },
    ] as unknown as NavDestination[]
    const g = moreGroups(fake)
    expect(g.map((x) => x.id)).toEqual(['books', 'tools'])
    expect(g[1].items.map((d) => d.id)).toEqual(['t1', 't2'])
  })
  test('an entry on More and on the bottom bar or Account is caught', () => {
    const fake = [
      { ...base, id: 'both', surfaces: ['more', 'bottom-nav'] },
      { ...base, id: 'acct', surfaces: ['more', 'account'] },
      { ...base, id: 'fine', surfaces: ['more', 'global-search'] },
    ] as unknown as NavDestination[]
    expect(duplicatedHomes(fake)).toEqual(['both', 'acct'])
  })
})

describe('the More page', () => {
  const g = moreGroups(NAV_REGISTRY)
  const ids = (id: string) => g.find((x) => x.id === id)?.items.map((d) => d.id)

  test('Shop books: Items & stock, Cashbook, Bank & UPI, Reports (Purchase Return until Bills has returns, 5d)', () => {
    expect(ids('books')).toEqual(['inventory', 'income-expense', 'bank-reconciliation', 'reports', 'purchase-return'])
  })

  test('Tools and Grow', () => {
    expect(ids('tools')).toEqual(['scanner', 'voice-entry', 'barcode-scanner', 'document-vault', 'day-end-summary', 'whatsapp-reminders', 'smart-insights', 'ask', 'ai-usage', 'ai-comparison'])
    expect(ids('grow')).toEqual(['business-card', 'refer-earn'])
  })

  test('things with their own home are not repeated in More', () => {
    expect(duplicatedHomes(NAV_REGISTRY)).toEqual([])
    const onMore = new Set(NAV_REGISTRY.filter((d) => d.surfaces?.includes('more')).map((d) => d.id))
    for (const id of ['new-sale', 'new-purchase', 'estimates', 'parties', 'pl', 'gstr-1', 'stock-report', 'staff-access', 'multi-shop-management']) {
      expect({ id, onMore: onMore.has(id) }).toEqual({ id, onMore: false })
    }
  })

  test('every tile name wraps inside a tile: no single word longer than 11 characters', () => {
    // 14 Oct, local copy at 375 px: "Bank Reconciliation" ran past its 106 px
    // tile — a 14-letter word cannot wrap. Tiles show the short name.
    const en = translations.en as unknown as Record<string, string>
    const names = g.flatMap((x) => x.items).map((d) => en[d.shortLabelKey ?? d.labelKey ?? ''] || d.label)
    const tooLong = names.filter((n) => n.split(/\s+/).some((w) => w.length > 11))
    expect(tooLong).toEqual([])
  })

  test('every More entry belongs to a group the page draws (nothing silently dropped)', () => {
    const drawn = new Set(g.flatMap((x) => x.items.map((d) => d.id)))
    const declared = NAV_REGISTRY.filter((d) => d.surfaces?.includes('more')).map((d) => d.id)
    expect(declared.filter((id) => !drawn.has(id))).toEqual([])
  })
})
