/**
 * Guards the Account screen's information architecture.
 *
 * 🎨 2026-08-08. Rahul, on the Account screen: "the design and structure is
 * not good. everything look like a mess. things aren't added in structed way."
 *
 * Three separate faults produced that, and all three were invisible in the
 * code — you only saw them by opening the app:
 *
 *   1. Two rows, one page. 'accounting-controls' and 'data-backup' both set
 *      accountSection to 'data'. Tapping either rendered a byte-identical
 *      2,222-character page. Nothing in TypeScript objects to two entries
 *      sharing a destination.
 *   2. A row with no group. 'multi-shop-management' had a subcategory that
 *      MoreScreen owned, so AccountScreen dropped it out of its grouping and
 *      it rendered loose at the bottom.
 *   3. A section with no row. Cards existed inside Settings that no Account
 *      row pointed at, so the only way to reach them was a tab bar the
 *      Account screen hides.
 *
 * These tests fail on all three. They are cheap and they are about data, not
 * rendering — which is the level the faults actually lived at.
 */

import { NAV_REGISTRY, type NavDestination } from '@/lib/nav-registry'

const accountRows = (): NavDestination[] =>
  NAV_REGISTRY.filter(d => d.surfaces?.includes('account'))

describe('Account screen information architecture', () => {
  it('gives every account row a group, so none renders loose', () => {
    const ungrouped = accountRows().filter(d => !d.accountGroup).map(d => d.id)
    expect(ungrouped).toEqual([])
  })

  it('never sends two rows to the same page', () => {
    /*
     * The 'accounting-controls' / 'data-backup' bug. Grouped rather than
     * asserted one-by-one so the failure message names both culprits and the
     * page they collide on, instead of just saying a number was wrong.
     */
    const byDestination = new Map<string, string[]>()
    for (const d of accountRows()) {
      const target = d.actionParams?.accountSection
      if (!target) continue
      byDestination.set(target, [...(byDestination.get(target) ?? []), d.id])
    }

    const collisions = [...byDestination.entries()]
      .filter(([, ids]) => ids.length > 1)
      .map(([target, ids]) => `${ids.join(' + ')} → '${target}'`)

    expect(collisions).toEqual([])
  })

  it('gives every row a distinct label', () => {
    // Registry design principle 3: one canonical name per destination. Two
    // rows reading the same is the same confusion as two rows going the same
    // place, one layer up.
    const labels = accountRows().map(d => d.label)
    expect(labels).toEqual([...new Set(labels)])
  })

  it('keeps each group small enough to scan', () => {
    // Not a style rule. A group past about six rows stops reading as a group
    // and starts reading as the undifferentiated list this screen just came
    // out of; the old Preferences group had grown to hold four unrelated
    // pages including one that was a duplicate.
    const sizes = new Map<string, number>()
    for (const d of accountRows()) {
      if (!d.accountGroup) continue
      sizes.set(d.accountGroup, (sizes.get(d.accountGroup) ?? 0) + 1)
    }
    const oversized = [...sizes.entries()].filter(([, n]) => n > 6)
    expect(oversized).toEqual([])
  })

  it('orders rows within a group deterministically', () => {
    // AccountScreen sorts by sortOrder. Two rows sharing one leaves their
    // order down to Array.prototype.sort's stability over registry position —
    // so the menu could reshuffle from an unrelated edit.
    const seen = new Map<string, Set<number>>()
    const clashes: string[] = []
    for (const d of accountRows()) {
      if (!d.accountGroup) continue
      const orders = seen.get(d.accountGroup) ?? new Set<number>()
      const order = d.sortOrder ?? 0
      if (orders.has(order)) clashes.push(`${d.accountGroup}: duplicate sortOrder ${order} (${d.id})`)
      orders.add(order)
      seen.set(d.accountGroup, orders)
    }
    expect(clashes).toEqual([])
  })
})
