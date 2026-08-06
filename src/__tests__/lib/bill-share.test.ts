/**
 * Bill share links.
 *
 * ⚠️ The token IS the security model — the page it opens has no login, because
 * the person opening it is a customer with no account. These tests hold shut
 * the two things that would break that: a guessable token, and a link that
 * cannot be withdrawn.
 */

import {
  mintShareToken,
  isWellFormedToken,
  shareLinkStatus,
  isShareLinkUsable,
  shareLinkUrl,
  defaultExpiry,
  DEAD_LINK_MESSAGE,
} from '@/lib/bill-share'

describe('the token', () => {
  it('is 32 URL-safe characters', () => {
    const t = mintShareToken()
    expect(t).toHaveLength(32)
    // base64url only: '+' and '/' from standard base64 would need escaping in
    // a URL, a WhatsApp message and a QR code.
    expect(/^[A-Za-z0-9_-]{32}$/.test(t)).toBe(true)
  })

  it('never repeats', () => {
    // Not a proof of entropy, but it would catch a token derived from
    // something constant — a timestamp truncated to the second, say.
    const seen = new Set(Array.from({ length: 2000 }, () => mintShareToken()))
    expect(seen.size).toBe(2000)
  })

  it('is not derived from anything the recipient already knows', () => {
    // A token computed from the transaction id or invoice number would let one
    // customer compute another customer's link. Minting takes no arguments at
    // all, which is the structural guarantee.
    expect(mintShareToken.length).toBe(0)
  })

  it('rejects malformed tokens before they reach the database', () => {
    expect(isWellFormedToken('short')).toBe(false)
    expect(isWellFormedToken('a'.repeat(31))).toBe(false)
    expect(isWellFormedToken('a'.repeat(33))).toBe(false)
    // Path traversal and SQL-ish input never get a round trip.
    expect(isWellFormedToken('../../etc/passwd')).toBe(false)
    expect(isWellFormedToken("' OR 1=1--")).toBe(false)
    expect(isWellFormedToken(null)).toBe(false)
    expect(isWellFormedToken(123)).toBe(false)
    expect(isWellFormedToken(mintShareToken())).toBe(true)
  })
})

describe('whether a link still works', () => {
  const base = { token: 'x'.repeat(32), expiresAt: null, revokedAt: null }

  it('works when fresh', () => {
    expect(shareLinkStatus(base)).toBe('active')
    expect(isShareLinkUsable(base)).toBe(true)
  })

  it('stops working once revoked', () => {
    const link = { ...base, revokedAt: new Date('2026-08-01') }
    expect(shareLinkStatus(link)).toBe('revoked')
    expect(isShareLinkUsable(link)).toBe(false)
  })

  it('stops working once expired', () => {
    const link = { ...base, expiresAt: new Date('2026-01-01') }
    expect(shareLinkStatus(link, new Date('2026-08-05'))).toBe('expired')
    expect(isShareLinkUsable(link, new Date('2026-08-05'))).toBe(false)
  })

  it('still works right up to the expiry moment', () => {
    const at = new Date('2026-08-05T12:00:00Z')
    const link = { ...base, expiresAt: at }
    expect(isShareLinkUsable(link, new Date(at.getTime() - 1))).toBe(true)
    expect(isShareLinkUsable(link, at)).toBe(false)
  })

  it('reports revoked rather than expired when it is both', () => {
    // The shop deliberately killed this one; that is the more useful fact.
    const link = { ...base, expiresAt: new Date('2026-01-01'), revokedAt: new Date('2026-02-01') }
    expect(shareLinkStatus(link, new Date('2026-08-05'))).toBe('revoked')
  })
})

describe('what a dead link says', () => {
  it('names neither the shop nor the bill', () => {
    // Saying "withdrawn by Sharma Kirana" to anyone holding a dead token leaks
    // that the shop and the bill exist. The shopkeeper sees the real status in
    // their own app.
    expect(DEAD_LINK_MESSAGE).not.toMatch(/expired|revoked|withdrawn/i)
    expect(DEAD_LINK_MESSAGE.toLowerCase()).toContain('no longer available')
  })
})

describe('the URL', () => {
  it('puts the token on a short path', () => {
    expect(shareLinkUrl('abc', 'https://ekbook.app')).toBe('https://ekbook.app/b/abc')
  })

  it('does not double the slash', () => {
    expect(shareLinkUrl('abc', 'https://ekbook.app/')).toBe('https://ekbook.app/b/abc')
  })

  it('carries no personal data', () => {
    // The path is the token and nothing else — no name, phone or invoice
    // number, which would otherwise sit in server logs and browser history.
    const url = shareLinkUrl(mintShareToken(), 'https://ekbook.app')
    expect(url.split('/b/')[1]).toMatch(/^[A-Za-z0-9_-]{32}$/)
  })
})

describe('default expiry', () => {
  it('is 90 days out, not forever', () => {
    const from = new Date('2026-08-05T00:00:00Z')
    const exp = defaultExpiry(from)
    expect(Math.round((exp.getTime() - from.getTime()) / 86400000)).toBe(90)
  })

  it('does not mutate the date it was given', () => {
    const from = new Date('2026-08-05T00:00:00Z')
    defaultExpiry(from)
    expect(from.toISOString()).toBe('2026-08-05T00:00:00.000Z')
  })
})
