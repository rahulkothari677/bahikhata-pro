/**
 * App Lock — a PIN between whoever is holding the phone and the shop's books.
 *
 * 🔒 2026-08-08. Rahul: "security has no real feature."
 *
 * He was right. The Security page offered one working action — emailing itself
 * a password-reset link — and two separate "Coming Soon" notices for this. The
 * app lock had actually been BUILT once, as a toggle that toasted "will require
 * PIN" and enforced nothing; a previous audit removed it on the grounds that a
 * false security promise is worse than no feature. That was the right call, and
 * it left the page with nothing in it.
 *
 * THREAT MODEL. This defends against the person who picks up the counter phone
 * while the owner is in the back: a helper, a customer, a curious child. It does
 * NOT defend against someone with the device unlocked, a laptop and time — the
 * PIN hash lives in localStorage, and anything in localStorage can be read and
 * cleared by whoever controls the browser. Saying so plainly is the point; the
 * previous version's mistake was implying more than it delivered.
 *
 * WHAT IS STORED. A random 16-byte salt and SHA-256(salt + pin), both hex. The
 * PIN itself is never written anywhere. This is not password-grade — SHA-256 is
 * fast and a 4-digit space is 10,000 entries, so an attacker with the hash can
 * recover the PIN in milliseconds. It is stored hashed anyway, because the
 * realistic failure here is someone glancing at devtools or a synced backup,
 * and a hash defeats that while costing nothing.
 *
 * ⛔ THE ONE RULE: this must never be able to lock a shopkeeper out of their own
 * books. Rahul's standing constraint is that user data can never be removed or
 * disabled, at any cost. So:
 *   · every read is wrapped, and any failure returns UNLOCKED. A lock screen
 *     that appears because of a corrupt value would be a self-inflicted outage.
 *   · "Forgot PIN" always works, clears the lock and signs out. The books are
 *     on the server; the password gets them back. Nothing local is deleted.
 *   · the PIN gates the UI only. It is not a key, nothing is encrypted with it,
 *     and losing it costs a shopkeeper one sign-in.
 */

const PIN_KEY = 'bahikhata:app-lock'
const LAST_ACTIVE_KEY = 'bahikhata:app-lock-last-active'

/** How long the app may sit in the background before it asks again. */
export const LOCK_DELAYS = [
  { value: 0, label: 'Immediately' },
  { value: 60_000, label: 'After 1 minute' },
  { value: 300_000, label: 'After 5 minutes' },
  { value: 900_000, label: 'After 15 minutes' },
] as const

export interface AppLockConfig {
  salt: string
  hash: string
  /** Milliseconds of inactivity before locking. */
  delayMs: number
}

const MIN_PIN = 4
const MAX_PIN = 6

/** A PIN is 4–6 digits. Rejects letters, spaces and the empty string. */
export function isValidPin(pin: string): boolean {
  return new RegExp(`^\\d{${MIN_PIN},${MAX_PIN}}$`).test(pin)
}

function toHex(buf: ArrayBuffer): string {
  return Array.from(new Uint8Array(buf))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('')
}

/**
 * Hash a PIN against a salt.
 *
 * Async because Web Crypto is. Callers must not busy-wait on this — it is
 * sub-millisecond, but the lock screen still awaits it rather than blocking.
 */
export async function hashPin(pin: string, salt: string): Promise<string> {
  const data = new TextEncoder().encode(`${salt}:${pin}`)
  return toHex(await crypto.subtle.digest('SHA-256', data))
}

export function newSalt(): string {
  return toHex(crypto.getRandomValues(new Uint8Array(16)).buffer)
}

/**
 * The current lock config, or null when no PIN is set.
 *
 * Returns null on ANY failure — unparseable JSON, a missing field, no
 * localStorage at all (SSR, private mode, a locked-down WebView). Null means
 * unlocked, which is the safe direction: the worst case is a shop that thought
 * it had a lock and doesn't, and the alternative worst case is a shopkeeper
 * staring at a PIN pad that will never accept anything.
 */
export function getLockConfig(): AppLockConfig | null {
  if (typeof window === 'undefined') return null
  try {
    const raw = window.localStorage.getItem(PIN_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as Partial<AppLockConfig>
    if (typeof parsed.salt !== 'string' || typeof parsed.hash !== 'string') return null
    if (!parsed.salt || !parsed.hash) return null
    return {
      salt: parsed.salt,
      hash: parsed.hash,
      delayMs: typeof parsed.delayMs === 'number' && parsed.delayMs >= 0 ? parsed.delayMs : 0,
    }
  } catch {
    return null
  }
}

export function isLockEnabled(): boolean {
  return getLockConfig() !== null
}

/** Set or replace the PIN. Throws on an invalid PIN so callers can't set a lock nobody can open. */
export async function setPin(pin: string, delayMs: number): Promise<void> {
  if (!isValidPin(pin)) throw new Error(`PIN must be ${MIN_PIN}–${MAX_PIN} digits`)
  const salt = newSalt()
  const hash = await hashPin(pin, salt)
  window.localStorage.setItem(PIN_KEY, JSON.stringify({ salt, hash, delayMs }))
  touch()
}

/** Change the auto-lock delay without re-entering the PIN. No-op when no PIN is set. */
export function setLockDelay(delayMs: number): void {
  const cfg = getLockConfig()
  if (!cfg) return
  window.localStorage.setItem(PIN_KEY, JSON.stringify({ ...cfg, delayMs }))
}

/** Remove the lock. Never throws — this is the escape hatch. */
export function clearLock(): void {
  try {
    window.localStorage.removeItem(PIN_KEY)
    window.localStorage.removeItem(LAST_ACTIVE_KEY)
  } catch {
    /* If we cannot even clear it, the gate's fail-open reads will let them in. */
  }
}

export async function verifyPin(pin: string): Promise<boolean> {
  const cfg = getLockConfig()
  if (!cfg) return true
  try {
    return (await hashPin(pin, cfg.salt)) === cfg.hash
  } catch {
    // Web Crypto unavailable (an insecure origin, say). Refusing entry here
    // would strand the shopkeeper, and the gate cannot verify anything, so it
    // has no business holding the door shut.
    return true
  }
}

/** Record that the user is here, so the delay is measured from real activity. */
export function touch(): void {
  try {
    window.localStorage.setItem(LAST_ACTIVE_KEY, String(Date.now()))
  } catch { /* non-fatal: shouldLock() treats a missing stamp as "just now" */ }
}

/**
 * Should the app be showing the lock screen right now?
 *
 * A missing or unreadable timestamp counts as "active just now" rather than
 * "away forever" — the same fail-open rule. The clock can also go backwards
 * (a timezone change, an NTP correction), so a negative elapsed time is
 * treated as zero rather than as a very large positive one.
 */
export function shouldLock(): boolean {
  const cfg = getLockConfig()
  if (!cfg) return false
  if (cfg.delayMs === 0) return true
  try {
    const raw = window.localStorage.getItem(LAST_ACTIVE_KEY)
    if (!raw) return false
    const last = Number(raw)
    if (!Number.isFinite(last)) return false
    return Math.max(0, Date.now() - last) >= cfg.delayMs
  } catch {
    return false
  }
}
