import { NextRequest, NextResponse } from 'next/server'

/**
 * Admin Panel CSRF Middleware
 *
 * 🔒 AUDIT FIX A4: Block mutations where BOTH Origin AND Referer are missing.
 *
 * The previous setup had NO middleware at all — any cross-origin request
 * could perform mutations. Now we block state-changing requests (POST, PUT,
 * PATCH, DELETE) that don't have a valid Origin OR Referer header.
 *
 * This prevents CSRF attacks where an attacker crafts a form submission
 * from a different origin. The browser's same-origin policy ensures that
 * Origin/Referer headers are sent on cross-origin requests, so a missing
 * Origin+Referer on a mutation is suspicious.
 *
 * GET/HEAD/OPTIONS requests are allowed through (they don't change state).
 * NextAuth's own CSRF token handles the login flow separately.
 */

const MUTATION_METHODS = ['POST', 'PUT', 'PATCH', 'DELETE']

export function middleware(req: NextRequest) {
  const { method } = req

  // Only check mutations — GET/HEAD/OPTIONS are safe
  if (!MUTATION_METHODS.includes(method)) {
    return NextResponse.next()
  }

  // Allow NextAuth's internal routes (they have their own CSRF protection)
  const pathname = req.nextUrl.pathname
  if (pathname.startsWith('/api/auth/')) {
    return NextResponse.next()
  }

  const origin = req.headers.get('origin')
  const referer = req.headers.get('referer')
  const host = req.headers.get('host')

  // 🔒 SECURITY: Block if BOTH Origin AND Referer are missing.
  // A legitimate browser request always sends at least one of these on
  // mutations. Missing both = likely CSRF or non-browser client.
  if (!origin && !referer) {
    console.warn(`[admin-csrf] Blocked ${method} to ${pathname}: missing Origin and Referer`)
    return NextResponse.json(
      { error: 'CSRF check failed — missing Origin/Referer header' },
      { status: 403 }
    )
  }

  // If Origin is present, verify it matches the host
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
      // Invalid Origin header — block
      return NextResponse.json(
        { error: 'CSRF check failed — invalid Origin header' },
        { status: 403 }
      )
    }
  }

  // If Referer is present (and Origin was missing), verify it matches the host
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
      // Invalid Referer — block
      return NextResponse.json(
        { error: 'CSRF check failed — invalid Referer header' },
        { status: 403 }
      )
    }
  }

  return NextResponse.next()
}

export const config = {
  // Run middleware on all routes except static assets
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|css|js|ico|txt)$).*)',
  ],
}
