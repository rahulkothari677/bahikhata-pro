/**
 * 🔒 GUARD: the computer's Tools page never drops an entry silently
 * (Phase 5 feature check, 15 Oct).
 *
 * An entry whose section had no title on this page was neither shown nor put
 * under "Other" — moving Business Card here with its Account section would
 * have hidden it on the only visible home it has on a computer.
 */
import { describe, test, expect, jest } from '@jest/globals'

jest.mock('sonner', () => ({ toast: { info: jest.fn(), success: jest.fn(), error: jest.fn() } }))

import { NAV_REGISTRY, type NavDestination } from '@/lib/nav-registry'
import { toolsCategories } from '@/components/layout/ToolsHub'

const base = { label: 'x', icon: (() => null) as never, category: 'tools', frequency: 'secondary', surfaces: ['sidebar-tools'] }

describe('Tools page sections', () => {
  test('known sections keep their title; unknown or missing ones go under "Other"', () => {
    const fake = [
      { ...base, id: 'a', subcategory: 'business' },
      { ...base, id: 'b', subcategory: 'account-info' },
      { ...base, id: 'c' },
    ] as unknown as NavDestination[]
    const cats = toolsCategories(fake)
    expect(cats.map((c) => [c.title, c.tools.map((d) => d.id)])).toEqual([['Business', ['a']], ['Other', ['b', 'c']]])
  })

  test('every Tools entry in the registry is drawn', () => {
    const tools = NAV_REGISTRY.filter((d) => d.surfaces?.includes('sidebar-tools'))
    const drawn = new Set(toolsCategories(tools).flatMap((c) => c.tools.map((d) => d.id)))
    expect(tools.filter((d) => !drawn.has(d.id)).map((d) => d.id)).toEqual([])
    expect(drawn.has('business-card') && drawn.has('refer-earn')).toBe(true)
  })
})
