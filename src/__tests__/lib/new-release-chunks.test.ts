/**
 * @jest-environment jsdom
 *
 * Phase 7h — a new release does not interrupt a bill (#305).
 *
 * After a release the old version's screen code is gone, so the first tap on a
 * screen not yet opened showed a full page "App update available — Reload". The
 * auto-reload listened on window 'error' / 'unhandledrejection', but React catches
 * a failed screen import itself, so neither ever fired.
 *  1. Every screen's code is fetched once the app is idle (one loader per screen,
 *     used by dynamic() and the prefetch list), unless the phone saves data.
 *  2. Should a screen still be missing, the error page reloads once by itself
 *     (one shared rule with the listeners, guarded against loops).
 */
import { isChunkLoadError, reloadOnceForNewVersion } from '@/lib/crash-tracker'
import { readCode } from '@/test-support/read-source'

describe('what counts as a missing screen', () => {
  it('a chunk error by name or message', () => {
    expect(isChunkLoadError({ name: 'ChunkLoadError' })).toBe(true)
    expect(isChunkLoadError({ message: 'Loading chunk 812 failed.' })).toBe(true)
    expect(isChunkLoadError({ message: 'Loading CSS chunk 3 failed.' })).toBe(true)
    expect(isChunkLoadError({ message: 'Cannot read properties of undefined' })).toBe(false)
    expect(isChunkLoadError(null)).toBe(false)
  })
})

describe('reload once, never loop', () => {
  beforeEach(() => { jest.useFakeTimers(); sessionStorage.clear() })
  afterEach(() => jest.useRealTimers())
  it('the first missing screen starts a reload; a second in the same session does not', () => {
    expect(reloadOnceForNewVersion()).toBe(true)
    expect(reloadOnceForNewVersion()).toBe(false)
  })
})

describe('the app uses it', () => {
  const page = readCode('app/page.tsx')
  const errorPage = readCode('app/error.tsx')
  it('every dynamic screen has one named loader, and every loader is prefetched', () => {
    const screens = Array.from(page.matchAll(/const (\w+) = dynamic\((\w+),/g))
    expect(screens.length).toBeGreaterThanOrEqual(15)
    const list = page.match(/const SCREEN_LOADERS = \[([^\]]*)\]/)
    expect(list).not.toBeNull()
    const listed = list![1].split(',').map((x) => x.trim())
    for (const [, name, loader] of screens) {
      expect(loader).toBe(`load${name}`)
      expect(listed).toContain(loader)
    }
    expect(page).not.toMatch(/= dynamic\(\(\) => import\(/)
  })
  it('the prefetch waits for idle and respects data saving', () => {
    expect(page).toMatch(/connection\?\.saveData\) return/)
    expect(page).toMatch(/for \(const load of SCREEN_LOADERS\) load\(\)\.catch/)
    expect(page).toMatch(/requestIdleCallback/)
  })
  it('the error page reloads once by itself for a missing screen', () => {
    expect(errorPage).toContain('const isChunkError = isChunkLoadError(error)')
    expect(errorPage).toContain('if (isChunkError) reloadOnceForNewVersion()')
  })
})
