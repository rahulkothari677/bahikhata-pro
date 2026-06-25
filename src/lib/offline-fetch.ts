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
  clearCacheByUrlPrefix,
  queuePendingWrite,
  saveSession,
  getCachedSession,
  clearAllOfflineData,
  getPendingWriteCount,
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
  const fetchOpts: RequestInit = { ...options, offline: undefined }
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

async function handleGet(url: string, fetchOpts: RequestInit): Promise<Response> {
  // Offline: return cached response, or throw OfflineError
  if (!isOnline()) {
    const cached = await getCachedResponse(url)
    if (cached) {
      return new Response(JSON.stringify(cached.body), {
        status: 200,
        headers: { 'Content-Type': 'application/json', 'X-BahiKhata-Source': 'offline-cache' },
      })
    }
    throw new OfflineError()
  }

  // Online: try network, fall back to cache on failure
  try {
    const res = await fetch(url, fetchOpts)
    if (res.ok) {
      // Clone & cache (only JSON responses)
      const ct = res.headers.get('content-type') || ''
      if (ct.includes('application/json')) {
        try {
          const body = await res.clone().json()
          await cacheResponse(url, body)
        } catch {
          /* not JSON or caching failed — ignore */
        }
      }
    }
    return res
  } catch (err) {
    // Network failed — fall back to cache
    const cached = await getCachedResponse(url)
    if (cached) {
      return new Response(JSON.stringify(cached.body), {
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
