/**
 * @jest-environment node
 *
 * Home's quick tiles: five for a shop without GST, and Scan Bill is not one
 * of them.
 *
 * WHY (Rahul, 13 Aug 2026): "remove scan bill from the small cards (where ask,
 * add product and other things are). i just want 5 cards." Scanning stays on
 * the Today card directly above the row; a shortcut that repeats something
 * one tap away costs attention and buys nothing.
 *
 * Phase 5b-2 (14 Oct, ledger model v4 §7, approved): the set became Reports,
 * Cashbook, Items & stock, Reminders, Close day — still five — plus GST for
 * a regular GST shop. Ask moved to the front of the search box (and More);
 * Add product / Add party are in the + sheet. The tiles now come from the
 * nav registry ('home-tiles' surface, tileOrder), so this guard reads the
 * registry through the same function the row uses, not the page's source.
 */
import { jest } from '@jest/globals'

jest.mock('sonner', () => ({ toast: { info: jest.fn(), success: jest.fn(), error: jest.fn() } }))

import { NAV_REGISTRY, filterByPermissions, type NavDestination } from '@/lib/nav-registry'
import { translations } from '@/lib/i18n'
import type { GstStatus } from '@/lib/shop-tax'
import { homeTiles } from '@/components/dashboard/TodayCard'

const tilesFor = (gst: GstStatus) => homeTiles(filterByPermissions(
  NAV_REGISTRY.filter((d) => d.surfaces?.includes('home-tiles')),
  { canAccess: () => true, isFlagEnabled: () => true, isOwner: true, isFounder: false, platform: 'mobile', gstStatus: gst },
)).map((d) => d.id)

describe('the rule (good and bad input)', () => {
  const base = { label: 'x', icon: (() => null) as never, category: 'core', frequency: 'secondary' }
  it('keeps only home-tiles entries, in tileOrder', () => {
    const fake = [
      { ...base, id: 'b', surfaces: ['home-tiles'], tileOrder: 2 },
      { ...base, id: 'a', surfaces: ['home-tiles'], tileOrder: 1 },
      { ...base, id: 'x', surfaces: ['more'], tileOrder: 0 },
    ] as unknown as NavDestination[]
    expect(homeTiles(fake).map((d) => d.id)).toEqual(['a', 'b'])
  })
})

describe('five cards for a shop without GST', () => {
  it('is the approved set, in order', () => {
    expect(tilesFor('unregistered')).toEqual(['reports', 'income-expense', 'inventory', 'whatsapp-reminders', 'day-end-summary'])
  })
  it('a composition shop sees the same five (no GST returns of the regular kind)', () => {
    expect(tilesFor('composition')).toHaveLength(5)
  })
  it('a regular GST shop gets GST as a sixth', () => {
    expect(tilesFor('regular')).toEqual(['reports', 'income-expense', 'inventory', 'whatsapp-reminders', 'day-end-summary', 'gst-summary'])
  })
  it('does not offer Scan Bill (it is on the Today card)', () => {
    for (const g of ['unregistered', 'regular'] as const) expect(tilesFor(g)).not.toContain('scanner')
  })
  it('every tile has its own place and a name that wraps inside an 84 px tile', () => {
    const tiles = NAV_REGISTRY.filter((d) => d.surfaces?.includes('home-tiles'))
    const orders = tiles.map((d) => d.tileOrder)
    expect(orders.every((o) => typeof o === 'number')).toBe(true)
    expect(new Set(orders).size).toBe(orders.length)
    const en = translations.en as unknown as Record<string, string>
    const names = tiles.map((d) => en[d.shortLabelKey ?? d.labelKey ?? ''] || d.label)
    expect(names.filter((n) => n.split(/\s+/).some((w) => w.length > 11))).toEqual([])
  })
})
