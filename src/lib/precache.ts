/**
 * Pre-cache warmup — fires off background GET requests to all key API
 * endpoints right after login, so the IndexedDB cache is populated and
 * the user can go offline at any time.
 *
 * These requests run through offlineFetch which caches every successful
 * GET response. They fire in the background (don't block the UI) and
 * silently fail if the network is unavailable.
 */

import { offlineFetch } from './offline-fetch'

const PRECACHE_URLS = [
  '/api/dashboard?from=__MONTH_START__&to=__NOW__',
  '/api/products',
  '/api/parties',
  '/api/transactions?limit=200',
  '/api/settings',
  '/api/insights',
]

export async function precacheData(): Promise<void> {
  const now = new Date()
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1)

  const urls = PRECACHE_URLS.map((u) =>
    u
      .replace('__MONTH_START__', monthStart.toISOString())
      .replace('__NOW__', now.toISOString()),
  )

  // Fire all requests in parallel — don't throw on failure
  await Promise.allSettled(
    urls.map(async (url) => {
      try {
        const r = await offlineFetch(url)
        // Consume the body so the response isn't wasted
        if (r.ok) await r.clone().json().catch(() => {})
      } catch {
        /* ignore — best effort */
      }
    }),
  )
}
