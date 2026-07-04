/**
 * Next.js middleware — runs on every request before the route handler.
 *
 * 1. CSRF protection: verify Origin/Referer on POST/PUT/DELETE/PATCH
 * 2. Security headers: set on every response
 *
 * Skip: static files, Next.js internals (_next/*), auth callbacks
 */

import { NextRequest, NextResponse } from 'next/server'

// 🔒 AUDIT FIX H6+L1 (v2 audit): Exact host matching only.
// Was: `host.endsWith('.vercel.app')` allowed ANY *.vercel.app origin
// (e.g. evil.vercel.app would pass CSRF). Now: only exact matches in the set.
// Also fixed the typo: 'bahakhata' → 'bahikhata'
const ALLOWED_HOSTS = new Set([
  'bahikhata-pro.vercel.app',  // 🔒 L1: was 'bahakhata-pro' (missing 'i')
  'localhost:3000',
  '127.0.0.1:3000',
])

export function middleware(req: NextRequest) {
  const { method } = req
  const url = req.nextUrl

  // Apply security headers to all responses
  const res = NextResponse.next()
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
// Was: `host.endsWith('.vercel.app')` allowed any *.vercel.app origin.
// Now: only exact matches in ALLOWED_HOSTS pass.
function isAllowedHost(host: string): boolean {
  return ALLOWED_HOSTS.has(host)
}

export const config = {
  // Run middleware on API routes only (skip static files, pages, etc.)
  matcher: ['/api/:path*'],
}
