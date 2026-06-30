type OfflineFetchInit = RequestInit & { offline?: { queueable?: boolean; invalidate?: string[] } }
/**
 * offlineFetch — drop-in replacement for fetch() that adds offline intelligence.
 *
 * Behaviour:
 *
 * GET requests:
 *  - If online  → fetch from network → cache response → return.
 *                 If network fails, fall back to cached response (if any).
 *  - If offline → return cached response (if any).
 *                 If no cache, throw an OfflineError.
 *
 * Mutating requests (POST/PUT/DELETE/PATCH):
 *  - If online  → send to network.
 *                 On success: invalidate caches listed in `options.offline.invalidate`.
 *                 On failure: queue for later sync (if options.offline.queueable).
 *  - If offline → queue for later sync, return a synthetic 202 "queued" response
 *                 so the UI can continue as if the write succeeded.
 *
 * After every successful sync, components are notified via the `onSync` event
 * so they can re-fetch fresh data.
 */

import {
  cacheResponse,
  getCachedResponse,
  getCachedResponseByPrefix,
  clearCacheByUrlPrefix,
  trimCacheByPrefix,
  queuePendingWrite,
  saveSession,
  getCachedSession,
  clearAllOfflineData,
  getPendingWriteCount,
  getPendingWrites,
  deletePendingWrite,
  setMeta,
  getMeta,
  type PendingWrite,
} from './offline-db'

// ────────────────────────────────────────────────────────────────────────────
// Types
// ────────────────────────────────────────────────────────────────────────────

export interface OfflineFetchOptions extends RequestInit {
  offline?: {
    /**
     * URL prefixes whose cached GET responses should be invalidated after a
     * successful write. e.g. ['/api/products', '/api/dashboard']
     */
    invalidate?: string[]
    /**
     * If false, the request will NOT be queued when offline (it will just fail).
     * Default: true for mutating methods.
     */
    queueable?: boolean
  }
}

export class OfflineError extends Error {
  constructor(message = 'You are offline and this data is not cached.') {
    super(message)
    this.name = 'OfflineError'
  }
}

// ────────────────────────────────────────────────────────────────────────────
// Online status tracking
// ────────────────────────────────────────────────────────────────────────────

let _online: boolean = typeof navigator !== 'undefined' ? navigator.onLine : true
const listeners = new Set<() => void>()

if (typeof window !== 'undefined') {
  window.addEventListener('online', () => {
    _online = true
    listeners.forEach((l) => l())
    // Kick off a sync whenever we come back online
    syncPendingWrites().catch(() => {})
  })
  window.addEventListener('offline', () => {
    _online = false
    listeners.forEach((l) => l())
  })
}

export function isOnline(): boolean {
  return _online
}

export function onOnlineChange(fn: () => void): () => void {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

// ────────────────────────────────────────────────────────────────────────────
// Sync event bus — components subscribe to know when to re-fetch
// ────────────────────────────────────────────────────────────────────────────

const syncListeners = new Set<() => void>()

export function onSyncComplete(fn: () => void): () => void {
  syncListeners.add(fn)
  return () => syncListeners.delete(fn)
}

function notifySyncComplete() {
  syncListeners.forEach((l) => {
    try {
      l()
    } catch {
      /* ignore */
    }
  })
}

// ────────────────────────────────────────────────────────────────────────────
// Pending write count tracking (for UI badge)
// ────────────────────────────────────────────────────────────────────────────

const pendingCountListeners = new Set<(n: number) => void>()

export function onPendingCountChange(fn: (n: number) => void): () => void {
  pendingCountListeners.add(fn)
  return () => pendingCountListeners.delete(fn)
}

async function notifyPendingCount() {
  try {
    const n = await getPendingWriteCount()
    pendingCountListeners.forEach((l) => l(n))
  } catch {
    /* ignore */
  }
}

// ────────────────────────────────────────────────────────────────────────────
// Main: offlineFetch
// ────────────────────────────────────────────────────────────────────────────

export async function offlineFetch(
  input: string | URL,
  options: OfflineFetchOptions = {},
): Promise<Response> {
  const url = typeof input === 'string' ? input : input.toString()
  const method = (options.method || 'GET').toUpperCase() as
    | 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH'

  // Strip the offline key before passing to native fetch
  const fetchOpts = { ...options } as RequestInit
  delete (fetchOpts as any).offline

  // Only intercept same-origin /api/ calls
  const isApiCall = url.startsWith('/api/') || url.startsWith(`${window.location.origin}/api/`)

  if (!isApiCall) {
    return fetch(url, fetchOpts)
  }

  // Endpoints that MUST have internet (auth, AI, WhatsApp, uploads) — never queue, just pass through
  const REQUIRES_ONLINE = [
    '/api/auth/',
    '/api/scan-bill',
    '/api/voice-parse',
    '/api/upload-bill',
    '/api/whatsapp-',
  ]
  if (REQUIRES_ONLINE.some((p) => url.includes(p))) {
    return fetch(url, fetchOpts)
  }

  // GET → cache-first-with-network
  if (method === 'GET') {
    return handleGet(url, fetchOpts)
  }

  // Mutating → queue when offline
  return handleMutation(url, method, fetchOpts, options.offline)
}

// ────────────────────────────────────────────────────────────────────────────
// GET handler: cache-first (offline), network-first (online) with cache fallback
// ────────────────────────────────────────────────────────────────────────────

/**
 * URLs whose cache key should be normalized — strip volatile query params
 * (timestamps, dates) so the cache key is stable and matches when offline.
 * Format: { pathPrefix, paramName } — strip `paramName` from the cache key
 * for any URL starting with `pathPrefix`.
 */
const NORMALIZE_RULES: { prefix: string; stripParams: string[] }[] = [
  // Dashboard uses from= & to= with millisecond timestamps → unstable key
  { prefix: '/api/dashboard', stripParams: ['from', 'to'] },
  // Reports also use from/to
  { prefix: '/api/reports', stripParams: ['from', 'to'] },
  { prefix: '/api/gstr-export', stripParams: ['from', 'to'] },
  // Transactions list uses limit/type which are fine, but from/to are volatile
  { prefix: '/api/transactions', stripParams: ['from', 'to'] },
]

/** Normalize a URL for caching — strip volatile query params. */
function normalizeCacheKey(url: string): string {
  try {
    const u = new URL(url, window.location.origin)
    for (const rule of NORMALIZE_RULES) {
      if (u.pathname.startsWith(rule.prefix)) {
        for (const param of rule.stripParams) {
          u.searchParams.delete(param)
        }
        break
      }
    }
    return u.pathname + (u.search || '')
  } catch {
    return url
  }
}

async function handleGet(url: string, fetchOpts: RequestInit): Promise<Response> {
  const cacheKey = normalizeCacheKey(url)

  // Offline: return cached response (exact match first, then prefix match)
  if (!isOnline()) {
    // 1. Try exact key match
    const cached = await getCachedResponse(cacheKey)
    if (cached) {
      return new Response(JSON.stringify(cached.body), {
        status: 200,
        headers: { 'Content-Type': 'application/json', 'X-BahiKhata-Source': 'offline-cache' },
      })
    }
    // 2. Fall back to most recent cached entry for this path prefix
    //    (e.g. dashboard with different timestamps)
    const prefix = cacheKey.split('?')[0]
    const fallback = await getCachedResponseByPrefix(prefix)
    if (fallback) {
      return new Response(JSON.stringify(fallback.body), {
        status: 200,
        headers: { 'Content-Type': 'application/json', 'X-BahiKhata-Source': 'offline-cache-fallback' },
      })
    }
    throw new OfflineError()
  }

  // Online: try network, fall back to cache on failure
  try {
    const res = await fetch(url, fetchOpts)
    if (res.ok) {
      const ct = res.headers.get('content-type') || ''
      if (ct.includes('application/json')) {
        try {
          const body = await res.clone().json()
          // Fire-and-forget the cache write — don't block the response.
          // The cache is for offline fallback only; if it fails, no harm.
          // trimCacheByPrefix is expensive (full IDB scan) so defer it
          // to a microtask so it runs after the response is returned.
          cacheResponse(cacheKey, body).catch(() => {})
          setTimeout(() => {
            trimCacheByPrefix(cacheKey.split('?')[0], 3).catch(() => {})
          }, 0)
        } catch {
          /* not JSON or caching failed — ignore */
        }
      }
    }
    return res
  } catch (err) {
    // Network failed — fall back to cache (exact, then prefix)
    const cached = await getCachedResponse(cacheKey)
    if (cached) {
      return new Response(JSON.stringify(cached.body), {
        status: 200,
        headers: { 'Content-Type': 'application/json', 'X-BahiKhata-Source': 'offline-cache-fallback' },
      })
    }
    const prefix = cacheKey.split('?')[0]
    const fallback = await getCachedResponseByPrefix(prefix)
    if (fallback) {
      return new Response(JSON.stringify(fallback.body), {
        status: 200,
        headers: { 'Content-Type': 'application/json', 'X-BahiKhata-Source': 'offline-cache-fallback' },
      })
    }
    throw err
  }
}

// ────────────────────────────────────────────────────────────────────────────
// Mutation handler: queue when offline
// ────────────────────────────────────────────────────────────────────────────

async function handleMutation(
  url: string,
  method: 'POST' | 'PUT' | 'DELETE' | 'PATCH',
  fetchOpts: RequestInit,
  offlineOpts?: { invalidate?: string[]; queueable?: boolean },
): Promise<Response> {
  const queueable = offlineOpts?.queueable !== false // default true

  // Online: just send it, then invalidate caches
  if (isOnline()) {
    try {
      const res = await fetch(url, fetchOpts)
      if (res.ok && offlineOpts?.invalidate?.length) {
        await Promise.all(offlineOpts.invalidate.map((p) => clearCacheByUrlPrefix(p)))
      }
      return res
    } catch (err) {
      // Network failed mid-write — queue it (if allowed)
      if (queueable) {
        await queueForSync(url, method, fetchOpts, offlineOpts?.invalidate || [])
        await notifyPendingCount()
        return queuedResponse()
      }
      throw err
    }
  }

  // Offline: queue the write, return synthetic "queued" response
  if (!queueable) {
    throw new OfflineError('This action requires internet connection.')
  }

  await queueForSync(url, method, fetchOpts, offlineOpts?.invalidate || [])
  await notifyPendingCount()
  return queuedResponse()
}

function queuedResponse(): Response {
  return new Response(
    JSON.stringify({
      success: true,
      queued: true,
      message: 'Saved offline. Will sync when internet returns.',
      offlineQueuedAt: Date.now(),
    }),
    { status: 202, headers: { 'Content-Type': 'application/json', 'X-BahiKhata-Source': 'offline-queue' } },
  )
}

async function queueForSync(
  url: string,
  method: 'POST' | 'PUT' | 'DELETE' | 'PATCH',
  fetchOpts: RequestInit,
  invalidates: string[],
): Promise<void> {
  let bodyStr: string | null = null
  if (fetchOpts.body) {
    bodyStr = typeof fetchOpts.body === 'string' ? fetchOpts.body : JSON.stringify(fetchOpts.body)
  }
  const headers: Record<string, string> = {}
  if (fetchOpts.headers) {
    const h = fetchOpts.headers as Record<string, string>
    Object.keys(h).forEach((k) => (headers[k] = h[k]))
  }
  await queuePendingWrite({
    url,
    method,
    body: bodyStr,
    headers,
    invalidates,
  })
}

// ────────────────────────────────────────────────────────────────────────────
// Sync engine — runs on 'online' event and on manual trigger
// ────────────────────────────────────────────────────────────────────────────

let syncing = false

export async function syncPendingWrites(): Promise<{ synced: number; failed: number }> {
  if (syncing) return { synced: 0, failed: 0 }
  if (!isOnline()) return { synced: 0, failed: 0 }

  syncing = true
  let synced = 0
  let failed = 0

  try {
    const pending = await getPendingWrites()
    for (const w of pending) {
      if (!w.id) continue
      try {
        const res = await fetch(w.url, {
          method: w.method,
          body: w.body,
          headers: w.headers,
        })
        if (res.ok || res.status === 409 || res.status === 422) {
          // 409/422 = server rejected (e.g. duplicate) — drop from queue, don't retry
          await deletePendingWrite(w.id)
          if (w.invalidates?.length) {
            await Promise.all(w.invalidates.map((p) => clearCacheByUrlPrefix(p)))
          }
          synced++
        } else if (res.status >= 500) {
          // Server error — retry next time
          failed++
          break
        } else {
          // 4xx (other than 409/422) — drop, don't retry
          await deletePendingWrite(w.id)
          synced++
        }
      } catch {
        failed++
        break
      }
    }

    if (synced > 0) {
      await setMeta('lastSyncAt', Date.now())
      notifySyncComplete()
      await notifyPendingCount()
    }
  } finally {
    syncing = false
  }

  return { synced, failed }
}

export async function getLastSyncAt(): Promise<number | null> {
  return getMeta<number>('lastSyncAt')
}

// ────────────────────────────────────────────────────────────────────────────
// Session helpers (re-exported for convenience)
// ────────────────────────────────────────────────────────────────────────────

export {
  saveSession,
  getCachedSession,
  clearAllOfflineData,
  getPendingWriteCount,
  getPendingWrites,
  deletePendingWrite,
}

/**
 * Check if a response is an offline-queued response (HTTP 202 from our queue).
 * Components should check this after mutations to handle the offline case
 * gracefully (e.g. don't try to read the response body, show a different
 * toast, navigate back without expecting server-created data).
 */
export function isQueuedResponse(r: Response): boolean {
  return (
    r.status === 202 &&
    r.headers.get('X-BahiKhata-Source') === 'offline-queue'
  )
}

/**
 * Auto-sync session to IndexedDB whenever NextAuth session is available.
 * Call this from a top-level client component.
 */
export function autoSyncSession(): () => void {
  // This is a no-op placeholder; the actual syncing happens in useOfflineSession hook
  return () => {}
}
