/**
 * 🔒 V26 GUARDRAIL: Navigation-registry lint.
 *
 * The V25/V26 audits found the same disease repeatedly: a destination added to
 * one surface (usually MoreScreen) became mobile-only by accident, or a view
 * became creatable-but-unreachable (Estimates), because nothing enforced that
 * every registry entry is discoverable on BOTH platforms.
 *
 * This test makes that class of bug fail CI:
 *   1. Every entry declares a non-empty `surfaces` array (an entry without one
 *      renders NOWHERE — every consumer does `d.surfaces?.includes(...)`).
 *   2. Ids are unique (duplicate ids = duplicate/conflicting nav rows).
 *   3. DESKTOP REACHABILITY: any entry visible on a mobile-only surface
 *      ('more' / 'bottom-nav') must ALSO appear on at least one
 *      desktop-reachable surface — sidebar-main, sidebar-tools, reports-hub,
 *      account, or global-search — unless it is explicitly declared
 *      `platforms: ['mobile']` (which makes the exception reviewable in diff).
 *   4. Navigate-style entries actually point at a view.
 *   5. Every labelKey/descKey exists in the English translation table (a
 *      missing key renders the raw key string to users).
 *
 * If this test fails on your new feature: add the missing surface (usually
 * 'global-search' at minimum) or declare `platforms: ['mobile']` deliberately.
 */

import { NAV_REGISTRY } from '@/lib/nav-registry'
import { translations } from '@/lib/i18n'

const DESKTOP_SURFACES = ['sidebar-main', 'sidebar-tools', 'reports-hub', 'account', 'global-search'] as const
const MOBILE_ONLY_SURFACES = ['more', 'bottom-nav'] as const

describe('V26 nav-registry lint (parity guardrail)', () => {
  test('every entry declares a non-empty surfaces array', () => {
    const missing = NAV_REGISTRY.filter(d => !d.surfaces || d.surfaces.length === 0).map(d => d.id)
    expect(missing).toEqual([])
  })

  test('ids are unique', () => {
    const seen = new Set<string>()
    const dupes: string[] = []
    for (const d of NAV_REGISTRY) {
      if (seen.has(d.id)) dupes.push(d.id)
      seen.add(d.id)
    }
    expect(dupes).toEqual([])
  })

  test('every mobile-surface entry is also desktop-reachable (or explicitly mobile-only)', () => {
    const gaps = NAV_REGISTRY.filter(d => {
      const surfaces = d.surfaces || []
      const onMobileSurface = surfaces.some(s => (MOBILE_ONLY_SURFACES as readonly string[]).includes(s))
      if (!onMobileSurface) return false
      const explicitlyMobileOnly =
        Array.isArray(d.platforms) && d.platforms.length === 1 && d.platforms[0] === 'mobile'
      if (explicitlyMobileOnly) return false
      return !surfaces.some(s => (DESKTOP_SURFACES as readonly string[]).includes(s))
    }).map(d => d.id)
    expect(gaps).toEqual([])
  })

  test('navigate-style entries point at a view', () => {
    const NAVIGATE_KINDS = ['navigate', 'navigate-scroll', 'toast-navigate']
    const broken = NAV_REGISTRY.filter(d => {
      const kind = d.actionKind || (d.view ? 'navigate' : 'custom')
      return NAVIGATE_KINDS.includes(kind) && !d.view
    }).map(d => d.id)
    expect(broken).toEqual([])
  })

  test('labelKey/descKey resolve in the English translation table', () => {
    const en = translations.en as Record<string, string>
    const missing: string[] = []
    for (const d of NAV_REGISTRY) {
      if (d.labelKey && !(d.labelKey in en)) missing.push(`${d.id}: ${d.labelKey}`)
      if (d.descKey && !(d.descKey in en)) missing.push(`${d.id}: ${d.descKey}`)
    }
    expect(missing).toEqual([])
  })
})
