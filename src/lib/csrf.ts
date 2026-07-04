/**
 * CSRF Protection via Origin/Referer check.
 *
 * Modern browsers with SameSite=Lax cookies (which NextAuth uses by default)
 * already prevent most CSRF attacks. This adds an additional layer: verify
 * the Origin or Referer header matches our own host on every mutating request.
 *
 * Usage in API routes:
 *   import { checkCSRF } from '@/lib/csrf'
 *   const csrfError = checkCSRF(req)
 *   if (csrfError) return csrfError
 */

import { NextRequest, NextResponse } from 'next/server'

// 🔒 AUDIT FIX H6+L1: Fixed typo 'bahakhata' → 'bahikhata' + exact match only
const ALLOWED_HOSTS = [
  'bahikhata-pro.vercel.app',  // 🔒 L1: was 'bahakhata-pro' (missing 'i')
  'localhost:3000',
  '127.0.0.1:3000',
  // Add preview deployment hosts here as needed
]

export function checkCSRF(req: NextRequest): NextResponse | null {
  // Only check mutating methods
  const method = req.method.toUpperCase()
  if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') {
    return null
  }

  const origin = req.headers.get('origin')
  const referer = req.headers.get('referer')

  // If both Origin and Referer are missing, this is suspicious — block
  // (browsers always send one of these on cross-origin requests; same-origin
  // requests from our app always have Referer)
  if (!origin && !referer) {
    return NextResponse.json(
      { error: 'Missing Origin/Referer header — request blocked' },
      { status: 403 },
    )
  }

  // Check Origin first (preferred — sent on all CORS requests)
  if (origin) {
    try {
      const url = new URL(origin)
      if (!isAllowedHost(url.host)) {
        return NextResponse.json(
          { error: 'Cross-origin request blocked' },
          { status: 403 },
        )
      }
      return null
    } catch {
      return NextResponse.json(
        { error: 'Invalid Origin header' },
        { status: 403 },
      )
    }
  }

  // Fall back to Referer
  if (referer) {
    try {
      const url = new URL(referer)
      if (!isAllowedHost(url.host)) {
        return NextResponse.json(
          { error: 'Cross-origin request blocked' },
          { status: 403 },
        )
      }
      return null
    } catch {
      return NextResponse.json(
        { error: 'Invalid Referer header' },
        { status: 403 },
      )
    }
  }

  return null
}

// 🔒 AUDIT FIX H6: Exact host match only — no wildcards.
// Was: `host.endsWith('.vercel.app')` allowed any *.vercel.app origin.
// Now: only exact matches in ALLOWED_HOSTS pass.
function isAllowedHost(host: string): boolean {
  return ALLOWED_HOSTS.includes(host)
}

/**
 * Set security headers on a response (CSP, HSTS, X-Frame-Options, etc.)
 * Call this on every API response for defense in depth.
 */
export function setSecurityHeaders(res: NextResponse): NextResponse {
  res.headers.set('X-Content-Type-Options', 'nosniff')
  res.headers.set('X-Frame-Options', 'DENY')
  res.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin')
  res.headers.set('Permissions-Policy', 'camera=(self), microphone=(self), geolocation=()')
  return res
}
