/**
 * Next.js middleware — runs on every request before the route handler.
 *
 * 1. CSRF protection: verify Origin/Referer on POST/PUT/DELETE/PATCH
 * 2. Security headers: set on every response
 * 3. 🔒 V9 2.6: Nonce-based CSP — generates a per-request nonce so inline
 *    scripts can be validated. Uses `'unsafe-inline'` as a fallback for
 *    browsers that don't support CSP Level 3 nonces.
 *
 * Skip: static files, Next.js internals (_next/*), auth callbacks
 */

import { NextRequest, NextResponse } from 'next/server'

// 🔒 AUDIT FIX H6+L1 (v2 audit): Exact host matching only.
// 🔒 V19-012 FIX: Read additional hosts from env var (for custom domains).
const ALLOWED_HOSTS = new Set([
  'bahikhata-pro.vercel.app',
  'localhost:3000',
  '127.0.0.1:3000',
  ...(process.env.ALLOWED_HOSTS?.split(',').map(h => h.trim()).filter(Boolean) || []),
])

export function middleware(req: NextRequest) {
  const { method } = req
  const url = req.nextUrl

  const res = NextResponse.next()

  // 🔒 V9 2.6 (revised): CSP without nonce — 'unsafe-inline' is kept because:
  // 1. Next.js injects inline scripts for hydration (can't be nonced reliably)
  // 2. Third-party scripts (PostHog, Sentry, Vercel Analytics) load dynamically
  // 3. The nonce approach caused CSP violations that blocked these scripts
  // 'unsafe-eval' was already removed (Phase 6) — that's the bigger win.
  // Moving to full nonce-based CSP requires migrating ALL script loading
  // to Next.js Script component with strategy — a larger refactor.
  res.headers.set(
    'Content-Security-Policy',
    [
      "default-src 'self'",
      // 🔒 V26 Phase 8 INF-1: Added PostHog hosts to script-src (was: only
      // 'self' 'unsafe-inline' vercel.live — PostHog SDK was blocked by CSP,
      // making ALL analytics 100% dead in production). unsafe-inline permits
      // inline code but NOT external hosts — the missing PostHog hosts were
      // the issue. Also added worker-src for PostHog session recording blob worker.
      "script-src 'self' 'unsafe-inline' https://vercel.live https://*.posthog.com https://us-assets.i.posthog.com",
      "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
      "font-src 'self' https://fonts.gstatic.com data:",
      "img-src 'self' data: blob: https: https://*.cloudinary.com https://res.cloudinary.com",
      "media-src 'self' blob:",
      "connect-src 'self' https://*.sentry.io https://*.posthog.com https://vitals.vercel-insights.com https://api.groq.com https://generativelanguage.googleapis.com https://api.openai.com",
      "worker-src 'self' blob:",
      "frame-ancestors 'none'",
      "base-uri 'self'",
      "form-action 'self'",
      "object-src 'none'",
    ].join('; ')
  )

  res.headers.set('X-Content-Type-Options', 'nosniff')
  res.headers.set('X-Frame-Options', 'DENY')
  res.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin')
  res.headers.set(
    'Permissions-Policy',
    'camera=(self), microphone=(self), geolocation=()',
  )
  if (url.protocol === 'https:') {
    res.headers.set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains')
  }

  const isMutation = ['POST', 'PUT', 'DELETE', 'PATCH'].includes(method.toUpperCase())
  if (!isMutation) return res

  if (url.pathname.startsWith('/api/auth/')) return res

  const origin = req.headers.get('origin')
  const referer = req.headers.get('referer')

  if (!origin && !referer) {
    return NextResponse.json(
      { error: 'Missing Origin/Referer header — request blocked' },
      { status: 403 },
    )
  }

  if (origin) {
    try {
      const originUrl = new URL(origin)
      if (!isAllowedHost(originUrl.host)) {
        return NextResponse.json(
          { error: 'Cross-origin request blocked' },
          { status: 403 },
        )
      }
    } catch {
      return NextResponse.json(
        { error: 'Invalid Origin header' },
        { status: 403 },
      )
    }
    return res
  }

  if (referer) {
    try {
      const refererUrl = new URL(referer)
      if (!isAllowedHost(refererUrl.host)) {
        return NextResponse.json(
          { error: 'Cross-origin request blocked' },
          { status: 403 },
        )
      }
    } catch {
      return NextResponse.json(
        { error: 'Invalid Referer header' },
        { status: 403 },
      )
    }
  }

  return res
}

function isAllowedHost(host: string): boolean {
  return ALLOWED_HOSTS.has(host)
}

// Matcher: all routes except static files
export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|manifest|woff|woff2|ttf|eot)$).*)',
  ],
}
