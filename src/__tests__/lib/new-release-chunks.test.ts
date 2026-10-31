/**
 * @jest-environment jsdom
 *
 * Phase 7h — a new release does not interrupt a bill (#305).
 *
 * After a release the old version's screen code is gone, so the first tap on a
 * screen not yet opened showed a full page "App update available — Reload". The
 * auto-reload listened on window 'error' / 'unhandledrejection', but React catches
 * a failed screen import itself, so neither ever fired.
 *  The error page reloads once by itself for a missing screen (one shared rule with
 *  the listeners, guarded against loops). An idle download of every screen (7h-8)
 *  was removed on 31 Oct: on a phone's mobile data it slowed every screen.
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
  it('a release never makes the phone download every screen (31 Oct: Khata took ~2 min on mobile data)', () => {
    // 7h-8 fetched all screens' code (~3.7 MB) when idle, after every release; on a phone it queued
    // ahead of the screen tapped. Screens load when opened; a missing one reloads once (below).
    expect(page).not.toMatch(/SCREEN_LOADERS/)
    expect(page).not.toMatch(/requestIdleCallback/)
    expect(page).not.toMatch(/for \(const load of /)
  })
  it('every screen still has its loading outline', () => {
    const screens = Array.from(page.matchAll(/const (\w+) = dynamic\(/g))
    expect(screens.length).toBeGreaterThanOrEqual(15)
  })
  it('the error page reloads once by itself for a missing screen', () => {
    expect(errorPage).toContain('const isChunkError = isChunkLoadError(error)')
    expect(errorPage).toContain('if (isChunkError) reloadOnceForNewVersion()')
  })
})
