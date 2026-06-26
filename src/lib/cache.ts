import { NextResponse } from 'next/server'

/**
 * Add cache headers to a NextResponse.
 *
 * Cache-Control: private, no-store  → never cache (mutations, auth)
 * Cache-Control: public, max-age=N  → cache for N seconds (static data)
 * Cache-Control: private, max-age=N, stale-while-revalidate=M
 *   → cache for N seconds, then serve stale while revalidating for M more
 *   (best for data that changes occasionally but should feel instant)
 *
 * 'private' = browser cache only, not CDN (user-specific data)
 * 'public'  = CDN can cache too (only for truly shared data)
 *
 * For authenticated user data, ALWAYS use 'private' — never 'public'.
 */

interface CacheOpts {
  /** Max age in seconds (fresh) */
  maxAge?: number
  /** Stale-while-revalidate window in seconds */
  swr?: number
  /** 'private' (browser only) or 'public' (CDN + browser) — default private */
  scope?: 'private' | 'public'
}

const DEFAULT_BROWSER_CACHE = 30       // 30s fresh
const DEFAULT_SWR = 300                // 5 min stale-while-revalidate

export function withCache<T>(data: T, opts: CacheOpts = {}): NextResponse {
  const maxAge = opts.maxAge ?? DEFAULT_BROWSER_CACHE
  const swr = opts.swr ?? DEFAULT_SWR
  const scope = opts.scope ?? 'private'

  return NextResponse.json(data, {
    headers: {
      'Cache-Control': `${scope}, max-age=${maxAge}, stale-while-revalidate=${swr}`,
    },
  })
}

/** Never cache — for mutations, auth, sensitive data */
export function noStore<T>(data: T, init?: ResponseInit): NextResponse {
  return NextResponse.json(data, {
    ...init,
    headers: {
      ...(init?.headers || {}),
      'Cache-Control': 'no-store, max-age=0',
    },
  })
}
