/**
 * Every settings card must be reachable from somewhere.
 *
 * 🐛 2026-08-08. Splitting the Settings monolith into per-page section lists
 * introduced a failure mode the old code could not have: a card can now be
 * gated on a key that NOTHING asks for. It compiles, it type-checks, no test
 * fails — the card simply never renders again.
 *
 * It happened immediately. Removing the ungated "About EkBook" card (which
 * was appearing at the foot of every settings tab, one of the reported bugs)
 * orphaned the two buttons inside it, and Replay Tour and Replay Theme Picker
 * silently left the app. Rahul asked whether any features had been removed;
 * the honest answer was yes, and nothing had caught it.
 *
 * This reads the two files as text rather than importing them — Settings.tsx
 * is a client component with a large dependency tree, and the question here
 * is purely "does every declared key appear in a consumer", which the source
 * answers directly.
 */

import { readFileSync } from 'fs'
import { join } from 'path'

const root = process.cwd()
/*
 * Newlines normalised on read. These files are CRLF on this machine, and a
 * marker written as '\n}' finds nothing in '\r\n}' — the scan then runs past
 * its intended block and swallows unrelated string literals. That is not a
 * hypothetical: the first version of this test reported 'dashboard' and
 * 'original' as section keys.
 */
const read = (rel: string) => readFileSync(join(root, rel), 'utf8').replace(/\r\n/g, '\n')
const settingsSrc = read('src/components/settings/Settings.tsx')
const accountSrc = read('src/components/layout/AccountScreen.tsx')

/** The `SettingsSection` union members. */
function declaredSections(): string[] {
  const start = settingsSrc.indexOf('export type SettingsSection =')
  expect(start).toBeGreaterThan(-1)
  const end = settingsSrc.indexOf('\n\n', start)
  const block = settingsSrc.slice(start, end)
  return [...block.matchAll(/\|\s*'([a-z-]+)'/g)].map(m => m[1])
}

/** Keys named by the legacy tab map plus the Account screen's page map. */
function requestedSections(): Set<string> {
  const keys = new Set<string>()
  for (const [src, marker, stop] of [
    [settingsSrc, 'const TAB_SECTIONS', '\n}'],
    [accountSrc, 'const sectionCards', '\n  }'],
  ] as const) {
    const start = src.indexOf(marker)
    expect(start).toBeGreaterThan(-1)
    const block = src.slice(start, src.indexOf(stop, start))
    // Only the array values, not the record keys before the colon.
    for (const line of block.split('\n')) {
      const rhs = line.slice(line.indexOf(':') + 1)
      for (const m of rhs.matchAll(/'([a-z-]+)'/g)) keys.add(m[1])
    }
  }
  return keys
}

describe('Settings sections', () => {
  it('declares no card that no page asks for', () => {
    const requested = requestedSections()
    const orphans = declaredSections().filter(s => !requested.has(s))
    expect(orphans).toEqual([])
  })

  it('asks for no card that does not exist', () => {
    // The mirror image: a typo in a page's section list would render nothing
    // and look identical to an empty page.
    const declared = new Set(declaredSections())
    const ghosts = [...requestedSections()].filter(s => !declared.has(s))
    expect(ghosts).toEqual([])
  })

  it('still has the replay actions that went missing once', () => {
    // Named explicitly. The generic checks above would pass if someone deleted
    // the card AND its key together, which is exactly how these two were lost.
    expect(settingsSrc).toContain('Replay Tour')
    expect(settingsSrc).toContain('Replay Theme Picker')
    expect(requestedSections().has('about-card')).toBe(true)
  })
})
