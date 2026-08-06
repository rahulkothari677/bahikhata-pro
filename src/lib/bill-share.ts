/**
 * Shareable bill links: minting the token, and deciding whether one is usable.
 *
 * 📄 Phase 4 of docs/DOCUMENT-ENGINE-PLAN.md.
 *
 * ⚠️ THE TOKEN IS THE ENTIRE SECURITY MODEL. There is no login on the page it
 * opens, because the person opening it is a customer with no account — that is
 * the point of the feature. So everything rests on the token being impossible
 * to guess and possible to withdraw.
 *
 * 24 random bytes from `crypto.randomBytes`, base64url-encoded to 32
 * characters. That is 192 bits of entropy: an attacker enumerating a billion
 * tokens a second for the lifetime of the universe would not find one. What
 * would have been guessable, and what this deliberately is not:
 *
 *   - a sequential id — walk 1, 2, 3 and read every bill in the database
 *   - anything derived from the transaction id or the invoice number — both
 *     are known to the recipient, so a customer could compute other people's
 *   - `Math.random()` — not a CSPRNG; its output is predictable from previous
 *     values, which is exactly the attack here
 */

import { randomBytes } from 'crypto'

/** Bytes of entropy per token. 24 → 32 base64url characters, 192 bits. */
const TOKEN_BYTES = 24

/**
 * A fresh, unguessable token.
 *
 * base64url, so it survives being pasted into a URL, a WhatsApp message and a
 * QR code without escaping — `+` and `/` from standard base64 do not.
 */
export function mintShareToken(): string {
  return randomBytes(TOKEN_BYTES).toString('base64url')
}

/** Tokens are fixed-length base64url. Anything else is not worth a DB round trip. */
export function isWellFormedToken(token: unknown): token is string {
  return typeof token === 'string' && /^[A-Za-z0-9_-]{32}$/.test(token)
}

export interface ShareLinkState {
  token: string
  expiresAt: Date | null
  revokedAt: Date | null
}

export type ShareLinkStatus = 'active' | 'expired' | 'revoked'

export function shareLinkStatus(link: ShareLinkState, now: Date = new Date()): ShareLinkStatus {
  // Revocation wins over expiry: a link the shop deliberately killed should say
  // so, even if it had also aged out.
  if (link.revokedAt) return 'revoked'
  if (link.expiresAt && link.expiresAt.getTime() <= now.getTime()) return 'expired'
  return 'active'
}

export function isShareLinkUsable(link: ShareLinkState, now: Date = new Date()): boolean {
  return shareLinkStatus(link, now) === 'active'
}

/**
 * What the customer is told when a link no longer works.
 *
 * Deliberately the SAME message for expired and revoked, and it names neither
 * the shop nor the bill. A page that says "this bill was withdrawn by Sharma
 * Kirana" to anyone holding a dead token leaks that the shop and the bill
 * existed. The shopkeeper sees the real status in their own app.
 */
export const DEAD_LINK_MESSAGE = 'This bill link is no longer available. Please ask the shop to send it again.'

/** The public URL for a token. */
export function shareLinkUrl(token: string, origin: string): string {
  return `${origin.replace(/\/$/, '')}/b/${token}`
}

/**
 * How long a new link lasts by default.
 *
 * 90 days: long enough that a customer who pays late still has the bill, short
 * enough that a link pasted into a group chat does not stay live for years. The
 * shop can set its own, and can revoke at any time.
 */
export const DEFAULT_LINK_DAYS = 90

export function defaultExpiry(from: Date = new Date()): Date {
  const d = new Date(from)
  d.setDate(d.getDate() + DEFAULT_LINK_DAYS)
  return d
}
