/**
 * appUrlFrom — the canonical absolute URL for links we send to users.
 *
 * 🔒 Added 2026-08-03 after a live probe returned:
 *
 *     "shareUrl": "NEXTAUTH_URL/?ref=RAHUL997"
 *
 * Two separate faults met here.
 *
 * 1. NEXTAUTH_URL's value in the deployment environment is the literal string
 *    "NEXTAUTH_URL" — the variable name typed into the value box. `||` only
 *    rejects an EMPTY value, so a wrong-but-present one sailed through.
 *
 * 2. The fallback was a HARDCODED 'https://ekbook-pro.vercel.app', which
 *    returns 404 — it is not the deployment, and on Vercel an unclaimed
 *    *.vercel.app name can be registered by anyone. auth/reset-request used
 *    that same fallback, and a reset link carries a TOKEN. A link built on a
 *    domain we do not own is a credential sent to a stranger's server.
 *
 * The fix removes the guesswork: prefer the request's own origin, because the
 * app is by definition reachable at the address the request arrived on. Env
 * vars are consulted only as a fallback and only when they parse as absolute
 * http(s) URLs. There is no hardcoded foreign domain left to leak to.
 *
 * This also decouples the code from the product's name. The project is
 * deployed at bahikhata-pro.vercel.app while the product is called EkBook, and
 * a custom domain may replace both. Nothing here needs editing when that
 * happens — links follow whatever host actually served the request.
 */

/** True only for an absolute http(s) URL. */
function isUsableUrl(value: string | undefined | null): value is string {
  if (!value) return false
  try {
    const u = new URL(value)
    return u.protocol === 'http:' || u.protocol === 'https:'
  } catch {
    return false
  }
}

/**
 * Resolve the base URL for user-facing links, without a trailing slash.
 *
 * Order:
 *   1. The request's Origin header — set by browsers, always the real host.
 *   2. The request's host + protocol — covers non-browser clients, which send
 *      no Origin. On Vercel, x-forwarded-proto/host are set by the platform.
 *   3. NEXT_PUBLIC_APP_URL, then NEXTAUTH_URL — only if they parse as URLs.
 *
 * Returns null when nothing usable is available, so the caller decides what to
 * do rather than receiving a plausible-looking wrong answer. A link is not the
 * kind of thing to guess at.
 */
export function appUrlFrom(req?: Request | null): string | null {
  const strip = (s: string) => s.replace(/\/+$/, '')

  if (req) {
    const origin = req.headers.get('origin')
    if (isUsableUrl(origin)) return strip(origin)

    const host = req.headers.get('x-forwarded-host') || req.headers.get('host')
    if (host) {
      const proto = req.headers.get('x-forwarded-proto')
        || (host.startsWith('localhost') || host.startsWith('127.0.0.1') ? 'http' : 'https')
      const built = `${proto}://${host}`
      if (isUsableUrl(built)) return strip(built)
    }
  }

  for (const candidate of [process.env.NEXT_PUBLIC_APP_URL, process.env.NEXTAUTH_URL]) {
    if (isUsableUrl(candidate)) return strip(candidate)
    if (candidate) {
      console.warn(`[app-url] ignoring non-URL value: ${JSON.stringify(candidate).slice(0, 60)}`)
    }
  }

  return null
}
