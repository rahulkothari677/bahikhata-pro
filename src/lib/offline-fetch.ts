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
  updatePendingWriteAttempts,
  setMeta,
  getMeta,
  saveToDeadLetter,
  getDeadLetterCount,
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
    /**
     * 🔒 V26 P7-1 (Phase 7): Per-call timeout override (milliseconds).
     * Default: 20_000 (20s). Use a higher value for long operations like
     * restore (120_000 = 2 min). The timeout lands in the existing catch
     * → queued with the same mutation ID (safe after R2).
     */
    timeoutMs?: number
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
const syncFailedListeners = new Set<(detail: { failed: number; synced: number; rejected?: number; deadLetterCount?: number }) => void>()

export function onSyncComplete(fn: () => void): () => void {
  syncListeners.add(fn)
  return () => syncListeners.delete(fn)
}

// 🔒 FIX C3: Listener for sync failures. The UI can subscribe to show a
// toast when offline writes fail to sync (e.g., validation error, deleted
// product, stock policy block).
export function onSyncFailed(fn: (detail: { failed: number; synced: number; rejected?: number; deadLetterCount?: number }) => void): () => void {
  syncFailedListeners.add(fn)
  return () => syncFailedListeners.delete(fn)
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
        headers: { 'Content-Type': 'application/json', 'X-bahikhata-Source': 'offline-cache' },
      })
    }
    // 2. Fall back to most recent cached entry for this path prefix
    //    (e.g. dashboard with different timestamps)
    const prefix = cacheKey.split('?')[0]
    const fallback = await getCachedResponseByPrefix(prefix)
    if (fallback) {
      return new Response(JSON.stringify(fallback.body), {
        status: 200,
        headers: { 'Content-Type': 'application/json', 'X-bahikhata-Source': 'offline-cache-fallback' },
      })
    }
    throw new OfflineError()
  }

  // Online: try network, fall back to cache on failure
  try {
    const res = await fetch(url, fetchOpts)

    // 🔒 AUDIT FIX V5: Auto-redirect on 401 (session expired/invalid)
    // The app uses AuthScreen component at / (not a separate /login route)
    // So we redirect to / which will show the login form when session is null
    if (res.status === 401 && !url.includes('/api/auth/')) {
      if (typeof window !== 'undefined' && window.location.pathname !== '/') {
        setTimeout(() => {
          window.location.href = '/'
        }, 100)
      }
    }

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
        headers: { 'Content-Type': 'application/json', 'X-bahikhata-Source': 'offline-cache-fallback' },
      })
    }
    const prefix = cacheKey.split('?')[0]
    const fallback = await getCachedResponseByPrefix(prefix)
    if (fallback) {
      return new Response(JSON.stringify(fallback.body), {
        status: 200,
        headers: { 'Content-Type': 'application/json', 'X-bahikhata-Source': 'offline-cache-fallback' },
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
  // 🔒 V26 P7-1 (Phase 7): Added timeoutMs override. Default 20s (R8), but
  // restore needs 120s — a >1500-row restore takes >20s and the blanket
  // timeout would abort it client-side while the server keeps working.
  offlineOpts?: { invalidate?: string[]; queueable?: boolean; timeoutMs?: number },
): Promise<Response> {
  const queueable = offlineOpts?.queueable !== false // default true
  const timeoutMs = offlineOpts?.timeoutMs ?? 20_000  // default 20s, override per-call

  // 🔒 V26 R2 (Phase 5): Ensure x-client-mutation-id header is set BEFORE the
  // first online attempt. Was: ID generated only in queueForSync AFTER fetch
  // threw → if the server committed but the response was lost (mobile network
  // blip — the single most common failure in this app's target environment),
  // the queued replay carried a brand-new UUID the server had never seen →
  // duplicate sale/payment. Now: same ID flows through both the online fetch
  // AND the queued replay, so the server's existing dedup block fires.
  const enhancedOpts = ensureMutationIdHeader(fetchOpts)

  // Online: just send it, then invalidate caches
  if (isOnline()) {
    try {
      // 🔒 V26 R8 (Phase 5): Client-side timeout. Was: raw `fetch` with no
      // signal → on a stalled-but-not-dead connection (EDGE/2G with packet
      // loss — the normal case in target geographies), the save button spun
      // indefinitely. Now: timeout lands in the existing catch → queued with
      // the same mutation ID (safe after R2) → user gets the honest "saved
      // offline, will sync" instead of an infinite spinner.
      // 🔒 V26 P7-1 (Phase 7): Use per-call timeoutMs (default 20s, override
      // for long operations like restore at 120s).
      const res = await fetch(url, {
        ...enhancedOpts,
        signal: AbortSignal.timeout(timeoutMs),
      })
      if (res.ok && offlineOpts?.invalidate?.length) {
        await Promise.all(offlineOpts.invalidate.map((p) => clearCacheByUrlPrefix(p)))
      }
      return res
    } catch (err) {
      // Network failed mid-write — queue it (if allowed).
      // Pass enhancedOpts (with the same x-client-mutation-id) so the replay
      // carries the same ID the first attempt had — server dedups correctly.
      if (queueable) {
        // 🔒 V26 R7 (Phase 5): Catch IDB queue failure (was: silently
        // swallowed inside queuePendingWrite → user saw "Saved offline ✓"
        // while nothing was saved). Now: queuePendingWrite throws, we catch
        // here and return an honest 503 so the form's error path fires.
        try {
          await queueForSync(url, method, enhancedOpts, offlineOpts?.invalidate || [])
          await notifyPendingCount()
          return queuedResponse()
        } catch (queueErr) {
          return queueErrorResponse(queueErr)
        }
      }
      throw err
    }
  }

  // Offline: queue the write, return synthetic "queued" response
  if (!queueable) {
    throw new OfflineError('This action requires internet connection.')
  }

  // 🔒 V26 R7 (Phase 5): Same honest-error pattern for the offline path.
  try {
    await queueForSync(url, method, enhancedOpts, offlineOpts?.invalidate || [])
    await notifyPendingCount()
    return queuedResponse()
  } catch (queueErr) {
    return queueErrorResponse(queueErr)
  }
}

/**
 * 🔒 V26 R7 (Phase 5): Honest error response when the offline queue itself
 * fails (IDB unavailable, quota exhausted, iOS-Safari private mode, ITP
 * storage eviction). Returns a 503 so the form's existing error path fires
 * and the user knows the entry was NOT saved.
 *
 * Was: queuePendingWrite silently swallowed errors, handleMutation returned
 * queuedResponse() (202 "Saved offline ✓") unconditionally → user recorded
 * sales all day into a void.
 */
function queueErrorResponse(err: unknown): Response {
  console.error('[offline] queue write failed — storage unavailable:', err)
  return new Response(
    JSON.stringify({
      success: false,
      error: 'Could not save offline — storage unavailable. This entry was NOT saved.',
      message: 'Your browser\'s storage is unavailable (private mode, quota full, or storage was cleared). Please use a normal browser tab, free up storage, or wait until you have a stable internet connection.',
      storageError: true,
    }),
    { status: 503, headers: { 'Content-Type': 'application/json', 'X-bahikhata-Source': 'offline-queue-error' } },
  )
}

/**
 * 🔒 V26 R2 (Phase 5): Ensure fetchOpts has an x-client-mutation-id header.
 * If the caller already provided one (X-Client-Mutation-Id or x-client-mutation-id),
 * keep it. Otherwise, generate a fresh UUID. Returns a NEW RequestInit with
 * the header set — does not mutate the caller's object.
 *
 * This MUST run before the first online fetch so that if the response is lost
 * after the server commits, the queued replay carries the same ID the server
 * saw on the first attempt → server's dedup block fires → no duplicate.
 */
function ensureMutationIdHeader(fetchOpts: RequestInit): RequestInit {
  const existingHeaders = (fetchOpts.headers || {}) as Record<string, string>
  const hasMutationId =
    existingHeaders['x-client-mutation-id'] ||
    existingHeaders['X-Client-Mutation-Id']
  if (hasMutationId) {
    return fetchOpts // caller controls the ID; respect it
  }
  const newHeaders: Record<string, string> = {
    ...(existingHeaders as Record<string, string>),
    'x-client-mutation-id': generateMutationId(),
  }
  return { ...fetchOpts, headers: newHeaders }
}

function queuedResponse(): Response {
  return new Response(
    JSON.stringify({
      success: true,
      queued: true,
      message: 'Saved offline. Will sync when internet returns.',
      offlineQueuedAt: Date.now(),
    }),
    { status: 202, headers: { 'Content-Type': 'application/json', 'X-bahikhata-Source': 'offline-queue' } },
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

  // 🔒 IDEMPOTENCY (Audit fix N1): Generate a clientMutationId for every
  // queued mutation. This UUID is sent as the X-Client-Mutation-Id header.
  // The server uses it to deduplicate — if the original request already went
  // through AND the queue replay also goes through, the server sees the same
  // UUID and returns the existing record instead of creating a duplicate.
  //
  // If the caller already provided an X-Client-Mutation-Id header, use that
  // (they may want to control the ID themselves). Otherwise, generate one.
  if (!headers['x-client-mutation-id'] && !headers['X-Client-Mutation-Id']) {
    headers['x-client-mutation-id'] = generateMutationId()
  }

  await queuePendingWrite({
    url,
    method,
    body: bodyStr,
    headers,
    invalidates,
  })
}

/**
 * Generate a UUID v4 for client mutation idempotency.
 * Uses crypto.randomUUID() if available (modern browsers), falls back to
 * a timestamp + random string for older browsers.
 */
function generateMutationId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  // Fallback: timestamp + random (not as unique as UUID, but sufficient)
  return `mut-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`
}

// ────────────────────────────────────────────────────────────────────────────
// Sync engine — runs on 'online' event and on manual trigger
// ────────────────────────────────────────────────────────────────────────────

let syncing = false

export async function syncPendingWrites(): Promise<{ synced: number; failed: number; rejected: number }> {
  if (syncing) return { synced: 0, failed: 0, rejected: 0 }
  if (!isOnline()) return { synced: 0, failed: 0, rejected: 0 }

  // 🔒 V26 R12 (Phase 5): Cross-tab mutex via Web Locks API.
  // Was: `syncing` is module-level per tab → two open tabs both fire
  // syncPendingWrites on the 'online' event, both read the same pending set,
  // both POST each item. Queued sale/purchase replays are saved by the
  // mutation-ID dedup (R2), but income/expense and payments currently aren't
  // (R2 covers them now too), and each item also gets double-deleted
  // harmlessly but double-*attempted* expensively.
  // Now: navigator.locks.request with { ifAvailable: true } — if another tab
  // already holds the lock, this tab's call is a no-op (returns {0,0,0}).
  // Falls back to running unguarded where Web Locks is unavailable (older
  // browsers — the per-tab `syncing` flag still prevents within-tab re-entry).
  if (typeof navigator !== 'undefined' && navigator.locks && navigator.locks.request) {
    return navigator.locks.request(
      'bahikhata-sync',
      { ifAvailable: true },
      async (lock) => {
        if (!lock) {
          // Another tab holds the lock — it will drain the queue.
          return { synced: 0, failed: 0, rejected: 0 }
        }
        return runSync()
      },
    )
  }
  // Fallback: no Web Locks API (older browser) — run with per-tab guard only.
  return runSync()
}

async function runSync(): Promise<{ synced: number; failed: number; rejected: number }> {
  syncing = true
  let synced = 0
  let failed = 0
  let rejected = 0  // 🔒 V26 R7 (Phase 5): 409/422 counted separately (was: counted as 'synced').

  try {
    const pending = await getPendingWrites()
    // 🔒 V9 2.9: Max attempts before quarantining a failing write.
    // After 5 failures, the item is dropped (so it doesn't block the queue forever).
    const MAX_ATTEMPTS = 5

    for (const w of pending) {
      if (!w.id) continue

      // Track attempts per item
      const attempts = (w.attempts || 0) + 1

      try {
        const res = await fetch(w.url, {
          method: w.method,
          body: w.body,
          headers: w.headers,
        })
        if (res.ok) {
          await deletePendingWrite(w.id)
          if (w.invalidates?.length) {
            await Promise.all(w.invalidates.map((p) => clearCacheByUrlPrefix(p)))
          }
          synced++
        } else if (res.status === 404 && w.method === 'DELETE') {
          // 🔒 V26 R10 (Phase 5): 404 on a replayed DELETE = the row is already
          // gone (soft-deleted by the first attempt whose response was lost).
          // Treat as SUCCESS — drop from queue, count as synced. Was: treated
          // as failure → 5 retries → dead-letter → "1 entry could not be
          // synced… please re-enter" toast for a delete that WORKED.
          //
          // The DELETE handler returns 404 for soft-deleted rows (findFirst
          // with deletedAt:null fails). This is correct server behavior —
          // the queue just needs to interpret it correctly.
          await deletePendingWrite(w.id)
          synced++
        } else if (res.status === 409 || res.status === 422) {
          // 🔒 V26 R7 (Phase 5): 409/422 = server rejected (e.g. duplicate,
          // validation conflict, period lock). Drop from queue (don't retry —
          // the server will reject every replay), but count as `rejected`
          // (NOT `synced`). Include in the syncFailed notification so the user
          // knows a queued edit hit a real conflict and vanished from the
          // queue with no UI feedback.
          //
          // Was: counted as `synced` → green sync badge even though a queued
          // party-edit hit a real conflict. Today 422 is only scan/voice
          // (never queued) and 409s are mostly benign ("already converted"),
          // so impact was low — but a queued party-edit hitting a real
          // conflict vanished silently.
          const errorBody = await res.text().catch(() => '')
          console.warn(`[offline-sync] Server rejected queued write (${res.status}):`, {
            url: w.url,
            status: res.status,
            body: errorBody.slice(0, 500),
          })
          await deletePendingWrite(w.id)
          rejected++
        } else if (res.status >= 500) {
          // 🔒 V9 2.9: Skip and continue (was: break). Track attempts.
          // After MAX_ATTEMPTS, drop the item (quarantine) so it doesn't block forever.
          if (attempts >= MAX_ATTEMPTS) {
            // 🔒 FIX M1: Was silently deleting — now moves to dead-letter store
            console.warn(`[offline-sync] Moving write to dead-letter after ${MAX_ATTEMPTS} failed attempts: ${w.url}`)
            await saveToDeadLetter(w)
            await deletePendingWrite(w.id)
            failed++
          } else {
            await updatePendingWriteAttempts(w.id, attempts)
            failed++
          }
          continue
        } else {
          // 🔒 FIX C3: 4xx (other than 409/422) — was SILENTLY DROPPING the
          // write and counting it as "synced" (success). This is a DATA LOSS
          // bug: the user saw "Saved offline. Will sync when online" but the
          // sale never reached the database. Scenarios that trigger this:
          //   - Server validation tightened between write-time and sync-time
          //   - Product/party referenced in the queued sale was deleted
          //   - Subscription/plan limit hit during sync (402)
          //   - Stock policy changed to 'block' and the sale now exceeds stock
          //
          // Now: keep the item in the queue (don't delete it) and mark it as
          // failed. The user will see a "sync failed" notification. The item
          // stays in IndexedDB so the user can retry or manually fix it.
          // After MAX_ATTEMPTS, move to dead-letter store so data is never lost.
          const errorBody = await res.text().catch(() => '')
          console.error(`[offline-sync] 4xx sync failure (NOT dropping — keeping for retry):`, {
            url: w.url,
            status: res.status,
            body: errorBody.slice(0, 500),
            attempts,
          })
          if (attempts >= MAX_ATTEMPTS) {
            // 🔒 FIX M1: Move to dead-letter store instead of deleting
            console.warn(`[offline-sync] Moving write to dead-letter after ${MAX_ATTEMPTS} failed 4xx attempts: ${w.url}`)
            await saveToDeadLetter(w)
            await deletePendingWrite(w.id)
          } else {
            await updatePendingWriteAttempts(w.id, attempts)
          }
          failed++
        }
      } catch {
        // 🔒 V9 2.9: Network error — same retry/quit logic as 5xx.
        if (attempts >= MAX_ATTEMPTS) {
          // 🔒 FIX M1: Move to dead-letter store instead of deleting
          console.warn(`[offline-sync] Moving write to dead-letter after ${MAX_ATTEMPTS} failed attempts (network): ${w.url}`)
          await saveToDeadLetter(w)
          await deletePendingWrite(w.id)
          failed++
        } else {
          await updatePendingWriteAttempts(w.id, attempts)
          failed++
        }
        continue
      }
    }

    if (synced > 0) {
      await setMeta('lastSyncAt', Date.now())
      notifySyncComplete()
      await notifyPendingCount()
    }
    // 🔒 FIX C3+M1: If any writes failed, notify the user so they know data
    // didn't sync. Include the dead-letter count so the user knows how many
    // entries are permanently stuck and need manual review.
    // 🔒 V26 R7: Also notify if any writes were rejected (409/422) so the
    // user knows a queued edit hit a real conflict.
    if (failed > 0 || rejected > 0) {
      const deadLetterCount = await getDeadLetterCount()
      syncFailedListeners.forEach((l) => {
        try {
          l({ failed, synced, rejected, deadLetterCount })
        } catch {
          /* ignore */
        }
      })
    }
  } finally {
    syncing = false
  }

  return { synced, failed, rejected }
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
    r.headers.get('X-bahikhata-Source') === 'offline-queue'
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
