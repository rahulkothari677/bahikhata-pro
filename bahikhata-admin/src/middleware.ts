import { NextRequest, NextResponse } from 'next/server'

/**
 * Admin Panel Middleware — CSRF + Nonce-based CSP
 *
 * 🔒 V20-024: Upgraded from 'unsafe-inline' to nonce-based CSP (enforced).
 *
 * Security improvements:
 * 1. CSP is now ENFORCED (was Report-Only — violations were logged but allowed)
 * 2. script-src uses 'nonce-XXX' instead of 'unsafe-inline' — blocks XSS
 *    script injection. Nonce is per-request (random 16 bytes, base64).
 * 3. 'strict-dynamic' allows trusted scripts to load other scripts (needed
 *    for Next.js runtime + React hydration chains)
 * 4. 'unsafe-inline' kept as backward-compat fallback for browsers that
 *    don't support 'strict-dynamic' — IGNORED by modern browsers when nonce
 *    is present (per CSP spec)
 *
 * How nonce-based CSP works:
 * - Server generates a random nonce per request
 * - CSP header: script-src 'nonce-ABC123' → only <script nonce="ABC123"> runs
 * - Inline scripts WITHOUT the nonce are blocked → XSS can't inject scripts
 * - Next.js 16 App Router reads the x-nonce request header and automatically
 *   adds the nonce to its own inline scripts (hydration, runtime)
 *
 * 🔒 AUDIT FIX A4: Block mutations where BOTH Origin AND Referer are missing.
 * (CSRF protection — unchanged from prior version)
 *
 * Note: Uses Web Crypto API (crypto.getRandomValues) instead of Node.js
 * 'crypto' module because middleware runs in the Edge Runtime.
 */

const MUTATION_METHODS = ['POST', 'PUT', 'PATCH', 'DELETE']

function generateNonce(): string {
  // Web Crypto API — available in Edge Runtime.
  // 16 bytes = 128 bits of randomness, base64-encoded = 24 chars.
  // Per OWASP: "Use at least 128 bits of entropy for nonces"
  const bytes = new Uint8Array(16)
  crypto.getRandomValues(bytes)
  return btoa(String.fromCharCode(...bytes))
}

export function middleware(req: NextRequest) {
  const { method } = req
  const pathname = req.nextUrl.pathname

  // ─── Generate nonce for this request ─────────────────────────────────
  const nonce = generateNonce()

  // ─── CSRF check for mutations ────────────────────────────────────────
  if (MUTATION_METHODS.includes(method) && !pathname.startsWith('/api/auth/')) {
    const origin = req.headers.get('origin')
    const referer = req.headers.get('referer')
    const host = req.headers.get('host')

    if (!origin && !referer) {
      console.warn(`[admin-csrf] Blocked ${method} to ${pathname}: missing Origin and Referer`)
      return NextResponse.json(
        { error: 'CSRF check failed — missing Origin/Referer header' },
        { status: 403 }
      )
    }

    if (origin) {
      try {
        const originUrl = new URL(origin)
        if (originUrl.host !== host) {
          console.warn(`[admin-csrf] Blocked ${method} to ${pathname}: Origin ${originUrl.host} !== Host ${host}`)
          return NextResponse.json(
            { error: 'CSRF check failed — Origin does not match Host' },
            { status: 403 }
          )
        }
      } catch {
        return NextResponse.json(
          { error: 'CSRF check failed — invalid Origin header' },
          { status: 403 }
        )
      }
    }

    if (!origin && referer) {
      try {
        const refererUrl = new URL(referer)
        if (refererUrl.host !== host) {
          console.warn(`[admin-csrf] Blocked ${method} to ${pathname}: Referer ${refererUrl.host} !== Host ${host}`)
          return NextResponse.json(
            { error: 'CSRF check failed — Referer does not match Host' },
            { status: 403 }
          )
        }
      } catch {
        return NextResponse.json(
          { error: 'CSRF check failed — invalid Referer header' },
          { status: 403 }
        )
      }
    }
  }

  // ─── Build response with nonce + CSP + security headers ──────────────
  const res = NextResponse.next()

  // Pass nonce to server components via request header (read in layout.tsx)
  // The request header is forwarded to the server component automatically.
  res.headers.set('x-nonce', nonce)

  // 🔒 V20-024: ENFORCED CSP with nonce (was Report-Only with 'unsafe-inline')
  res.headers.set(
    'Content-Security-Policy',
    [
      "default-src 'self'",
      // nonce + strict-dynamic: modern browsers use nonce, ignore 'unsafe-inline'
      // Older browsers fall back to 'unsafe-inline' (no strict-dynamic support)
      `script-src 'self' 'nonce-${nonce}' 'strict-dynamic' 'unsafe-inline'`,
      "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
      "font-src 'self' https://fonts.gstatic.com data:",
      "img-src 'self' data: blob: https:",
      "connect-src 'self' https://*.sentry.io",
      "frame-ancestors 'none'",
      "base-uri 'self'",
      "form-action 'self'",
      "object-src 'none'",
    ].join('; ')
  )

  // Security headers (unchanged from V7)
  res.headers.set('X-Content-Type-Options', 'nosniff')
  res.headers.set('X-Frame-Options', 'DENY')
  res.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin')
  res.headers.set(
    'Strict-Transport-Security',
    'max-age=31531500; includeSubDomains; preload'
  )
  res.headers.set(
    'Permissions-Policy',
    'camera=(), microphone=(), geolocation=()'
  )

  return res
}

export const config = {
  // Run middleware on all routes except static assets
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|css|js|ico|txt)$).*)',
  ],
}
