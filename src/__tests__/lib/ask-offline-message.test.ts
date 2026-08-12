/**
 * 🔒 B3 — the app must not blame the shopkeeper for its own bad connection.
 *
 * WHAT ACTUALLY HAPPENED OFFLINE, before this. `/api/ask` is a POST, and it
 * was not in offline-fetch's REQUIRES_ONLINE list — so it fell through to
 * handleMutation, which QUEUED THE QUESTION AS A PENDING WRITE and returned a
 * synthetic 202. Ask rendered that as the answer, so asking "kitna udhaar
 * hai" with no signal replied:
 *
 *     "Saved offline. Will sync when internet returns."
 *
 * Nothing had been saved — it was a question. And the question really was in
 * the write queue, waiting to be replayed at a server that would compute an
 * answer nobody was listening for.
 */

import { describe, test, expect } from '@jest/globals'
import { readFileSync } from 'fs'
import { join } from 'path'
import { askFailureMessage } from '@/lib/ask-offline-message'

describe('offline and unreachable are different sentences', () => {
  test('offline says so, and says the books are safe', () => {
    const r = askFailureMessage(false)
    expect(r.offline).toBe(true)
    expect(r.message).toMatch(/offline/i)
    // The shopkeeper has just watched a question vanish. The ledger is the one
    // thing they cannot afford to doubt.
    expect(r.message).toMatch(/nothing is lost/i)
  })

  test('online-but-failed does NOT claim they are offline', () => {
    /*
     * Telling someone with a working connection that they are offline sends
     * them to restart a router that is fine, and hides a real server fault.
     */
    const r = askFailureMessage(true)
    expect(r.offline).toBe(false)
    expect(r.message.toLowerCase()).not.toMatch(/\boffline\b/)
    expect(r.message).toMatch(/try again/i)
  })

  test('neither message ever claims anything was saved', () => {
    /*
     * THE EXACT STRING THAT SHIPPED. A question is not a write, and promising
     * to "sync" it is promising to replay it.
     */
    for (const online of [true, false]) {
      const m = askFailureMessage(online).message.toLowerCase()
      expect(m).not.toMatch(/saved/)
      expect(m).not.toMatch(/will sync/)
      expect(m).not.toMatch(/queued/)
    }
  })

  test('neither message blames the question', () => {
    // "I can't answer that" is a different failure, and saying it here tells
    // the shopkeeper their question was wrong when the network was.
    for (const online of [true, false]) {
      expect(askFailureMessage(online).message.toLowerCase()).not.toMatch(/can.?t answer/)
    }
  })
})

describe('a question is never queued as a write', () => {
  const src = readFileSync(join(process.cwd(), 'src/lib/offline-fetch.ts'), 'utf8')

  /*
   * Read the actual array, not a fixed slice of the file.
   *
   * My first version took the 900 characters after "REQUIRES_ONLINE" — and
   * the comment I wrote INSIDE the array pushed '/api/ask' past that window,
   * so the guard would have been measuring the comment. A guard that depends
   * on how long the surrounding prose is, is not a guard.
   */
  function requiresOnlineArray(): string {
    const start = src.indexOf('const REQUIRES_ONLINE = [')
    const end = src.indexOf(']', start)
    expect(start).toBeGreaterThan(-1)
    expect(end).toBeGreaterThan(start)
    return src.slice(start, end)
  }

  test('/api/ask is in REQUIRES_ONLINE', () => {
    /*
     * The class guard. Remove the line and offline asking silently goes back
     * to being queued — with no error anywhere, because a 202 is a success.
     * That is why this failure mode survived: nothing threw.
     */
    const list = requiresOnlineArray()
    expect(list).toContain("'/api/ask'")
  })

  test('the endpoints that compute server-side are all listed together', () => {
    // scan-bill and voice-parse are here for exactly the same reason: the work
    // happens on the server, so there is nothing to queue and nothing to replay.
    const list = requiresOnlineArray()
    expect(list).toContain("'/api/scan-bill'")
    expect(list).toContain("'/api/voice-parse'")
  })
})
