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
const ALLOWED_HOSTS = new Set([
  'bahikhata-pro.vercel.app',
  'localhost:3000',
  '127.0.0.1:3000',
])

export function middleware(req: NextRequest) {
  const { method } = req
  const url = req.nextUrl

  // 🔒 V9 2.6: Generate a per-request nonce for CSP.
  // Next.js automatically applies this nonce to its own inline scripts
  // (hydration, etc.) when it detects the x-nonce request header.
  const nonce = Buffer.from(crypto.randomUUID().replaceAll('-', '')).toString('base64')

  // Set the nonce on the request headers so Next.js can read it
  const requestHeaders = new Headers(req.headers)
  requestHeaders.set('x-nonce', nonce)

  const res = NextResponse.next({
    request: { headers: requestHeaders },
  })

  // 🔒 V9 2.6: Nonce-based CSP.
  // - 'nonce-xxx': allows scripts with this specific nonce (Next.js inline scripts)
  // - 'unsafe-inline': IGNORED by modern browsers when nonce is present, but
  //   serves as a fallback for older browsers that don't support CSP Level 3
  // - 'strict-dynamic': allows scripts loaded by nonced scripts to also execute
  //   (so PostHog/Sentry loaded by the bundle can dynamically inject scripts)
  // - https://vercel.live: Vercel's live preview toolbar
  res.headers.set(
    'Content-Security-Policy',
    [
      "default-src 'self'",
      `script-src 'self' 'nonce-${nonce}' 'unsafe-inline' 'strict-dynamic' https://vercel.live`,
      "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
      "font-src 'self' https://fonts.gstatic.com data:",
      "img-src 'self' data: blob: https: https://*.cloudinary.com https://res.cloudinary.com",
      "media-src 'self' blob:",
      "connect-src 'self' https://*.sentry.io https://*.posthog.com https://vitals.vercel-insights.com https://api.groq.com https://generativelanguage.googleapis.com https://api.openai.com",
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
  // HSTS — only on HTTPS
  if (url.protocol === 'https:') {
    res.headers.set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains')
  }

  // Only check CSRF on mutating methods
  const isMutation = ['POST', 'PUT', 'DELETE', 'PATCH'].includes(method.toUpperCase())
  if (!isMutation) return res

  // Skip auth callback routes (NextAuth handles its own CSRF)
  if (url.pathname.startsWith('/api/auth/')) return res

  const origin = req.headers.get('origin')
  const referer = req.headers.get('referer')

  // Both missing = suspicious
  if (!origin && !referer) {
    return NextResponse.json(
      { error: 'Missing Origin/Referer header — request blocked' },
      { status: 403 },
    )
  }

  // Check Origin (preferred)
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

  // Fall back to Referer
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

// 🔒 AUDIT FIX H6: Exact host match only — no wildcards.
function isAllowedHost(host: string): boolean {
  return ALLOWED_HOSTS.has(host)
}

// 🔒 V9 2.6: Expanded matcher to include ALL routes (was: API only).
// Needed so the nonce CSP is set on page responses too, not just API.
// Excludes static files, images, and Next.js internals.
export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|manifest|woff|woff2|ttf|eot)$).*)',
  ],
}
