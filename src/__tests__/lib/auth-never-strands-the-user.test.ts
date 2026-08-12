/**
 * 🔒 Reported from a real phone, with a screenshot: the Android app had
 * navigated the entire webview to
 *
 *     https://bahikhata-pro.vercel.app/api/auth/error
 *
 * and died there with net::ERR_NAME_NOT_RESOLVED. No app, no back, nothing.
 *
 * TWO FAULTS CHAINED, and the screenshot proves the first one:
 *
 * 1. THE STATUS BAR SHOWED 5G. So `navigator.onLine` was true while nothing
 *    could actually be resolved. Our offline fallback only trusted a cached
 *    session when it believed the device was offline, so it concluded the
 *    shopkeeper was genuinely logged out and showed the login screen to
 *    someone who had been logged in for weeks.
 *
 * 2. `pages` set `signIn` but never `error`, so NextAuth used its own default
 *    error page — server-rendered, at /api/auth/error. It is a FULL PAGE
 *    navigation out of the app shell, and it cannot be fetched without a
 *    network. The one moment it appears is a failed sign-in, which on a bad
 *    connection is precisely when it cannot load.
 *
 * This is the first bug found on a real device rather than at 375px in a
 * desktop browser (#58), and neither half was reachable from where I test.
 */

import { describe, test, expect } from '@jest/globals'
import { readFileSync } from 'fs'
import { join } from 'path'

const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf8')

describe('NextAuth never sends the user to a page outside the app', () => {
  const src = read('src/lib/auth.ts')

  function pagesBlock(): string {
    const start = src.indexOf('pages: {')
    const end = src.indexOf('}', src.indexOf('error:', start))
    expect(start).toBeGreaterThan(-1)
    return src.slice(start, end)
  }

  test('an error page is configured, so /api/auth/error is never used', () => {
    /*
     * Delete `error: '/'` and NextAuth silently reverts to its own page. There
     * is no error, no warning and no failing request — which is exactly why
     * this shipped: it only shows itself on a phone with a dead connection.
     */
    expect(pagesBlock()).toMatch(/error:\s*'\/'/)
  })

  test('and it points into the app, not at an /api/ route', () => {
    const block = pagesBlock()
    expect(block).not.toMatch(/error:\s*'\/api\//)
    expect(block).toMatch(/signIn:\s*'\/'/)
  })
})

describe('being unreachable is not the same as being logged out', () => {
  const src = read('src/hooks/use-offline-session.ts')

  test('the hook asks the server, instead of trusting navigator.onLine', () => {
    /*
     * NextAuth reports `unauthenticated` both when the server says you are
     * logged out and when the request never completed. Only an actual request
     * tells them apart — navigator.onLine cannot, because it only means the
     * device has a network interface.
     */
    expect(src).toContain("fetch('/api/auth/session'")
    expect(src).toMatch(/reachable === false/)
  })

  test('it does not decide while the probe is still running', () => {
    // Showing the login screen and withdrawing it a moment later is how
    // someone starts typing a password they never needed to type.
    expect(src).toMatch(/reachable === null/)
  })
})
