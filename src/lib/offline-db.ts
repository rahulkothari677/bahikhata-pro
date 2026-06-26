/**
 * IndexedDB wrapper for BahiKhata Pro offline support.
 *
 * Stores:
 *  - session         → cached user session (single row, key='current')
 *  - kv               → generic key/value cache for API GET responses (key = url)
 *  - pendingWrites    → queue of mutations to sync when back online
 *  - meta             → sync metadata (lastSyncAt, etc.)
 *
 * All functions are SSR-safe (no-op on server) and Promise-based.
 */

const DB_NAME = 'bahikhata-offline'
const DB_VERSION = 1

const STORE_SESSION = 'session'
const STORE_KV = 'kv'
const STORE_PENDING = 'pendingWrites'
const STORE_META = 'meta'

let dbPromise: Promise<IDBDatabase> | null = null

function isBrowser(): boolean {
  return typeof window !== 'undefined' && typeof indexedDB !== 'undefined'
}

function openDB(): Promise<IDBDatabase> {
  if (!isBrowser()) return Promise.reject(new Error('No IndexedDB'))
  if (dbPromise) return dbPromise

  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onerror = () => reject(req.error)
    req.onsuccess = () => resolve(req.result)
    req.onupgradeneeded = (e) => {
      const db = (e.target as IDBOpenDBRequest).result
      if (!db.objectStoreNames.contains(STORE_SESSION)) {
        db.createObjectStore(STORE_SESSION, { keyPath: 'key' })
      }
      if (!db.objectStoreNames.contains(STORE_KV)) {
        db.createObjectStore(STORE_KV, { keyPath: 'key' })
      }
      if (!db.objectStoreNames.contains(STORE_PENDING)) {
        const s = db.createObjectStore(STORE_PENDING, { keyPath: 'id', autoIncrement: true })
        s.createIndex('byTimestamp', 'timestamp', { unique: false })
      }
      if (!db.objectStoreNames.contains(STORE_META)) {
        db.createObjectStore(STORE_META, { keyPath: 'key' })
      }
    }
  })

  return dbPromise
}

function tx<T>(
  store: string,
  mode: IDBTransactionMode,
  fn: (s: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  return openDB().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const t = db.transaction(store, mode)
        const req = fn(t.objectStore(store))
        req.onsuccess = () => resolve(req.result)
        req.onerror = () => reject(req.error)
      }),
  )
}

// ────────────────────────────────────────────────────────────────────────────
// Session cache
// ────────────────────────────────────────────────────────────────────────────

export interface CachedSession {
  key: 'current'
  user: {
    id: string
    email: string
    name: string | null
    role: 'owner' | 'staff'
    ownerId: string | null
  }
  expiresAt: number // epoch ms
  cachedAt: number
}

export async function saveSession(session: Omit<CachedSession, 'key' | 'cachedAt'>): Promise<void> {
  try {
    await tx(STORE_SESSION, 'readwrite', (store) =>
      store.put({ ...session, key: 'current' as const, cachedAt: Date.now() } as CachedSession),
    )
  } catch {
    /* ignore */
  }
}

export async function getCachedSession(): Promise<CachedSession | null> {
  try {
    const r = await tx<CachedSession | undefined>(STORE_SESSION, 'readonly', (s) => s.get('current'))
    if (!r) return null

    // Defensive: validate shape (older versions saved broken sessions without
    // expiresAt / user due to a parameter-shadowing bug)
    if (!r.user || !r.user.id || typeof r.expiresAt !== 'number' || isNaN(r.expiresAt)) {
      await clearSession()
      return null
    }

    // Expire after 30 days (matches JWT maxAge)
    if (Date.now() > r.expiresAt) {
      await clearSession()
      return null
    }
    return r
  } catch {
    return null
  }
}

export async function clearSession(): Promise<void> {
  try {
    await tx(STORE_SESSION, 'readwrite', (s) => s.delete('current'))
  } catch {
    /* ignore */
  }
}

// ────────────────────────────────────────────────────────────────────────────
// Generic KV cache for API GET responses
// ────────────────────────────────────────────────────────────────────────────

export interface CachedResponse {
  key: string // URL including query string
  body: any
  cachedAt: number
}

export async function cacheResponse(key: string, body: any): Promise<void> {
  try {
    await tx(STORE_KV, 'readwrite', (s) =>
      s.put({ key, body, cachedAt: Date.now() } as CachedResponse),
    )
  } catch {
    /* ignore */
  }
}

export async function getCachedResponse(key: string): Promise<CachedResponse | null> {
  try {
    const r = await tx<CachedResponse | undefined>(STORE_KV, 'readonly', (s) => s.get(key))
    return r || null
  } catch {
    return null
  }
}

export async function clearCacheByUrlPrefix(prefix: string): Promise<void> {
  try {
    const db = await openDB()
    const t = db.transaction(STORE_KV, 'readwrite')
    const store = t.objectStore(STORE_KV)
    return new Promise<void>((resolve) => {
      const req = store.openCursor()
      req.onsuccess = () => {
        const cursor = req.result
        if (cursor) {
          if ((cursor.value as CachedResponse).key.startsWith(prefix)) cursor.delete()
          cursor.continue()
        } else {
          resolve()
        }
      }
      req.onerror = () => resolve()
    })
  } catch {
    /* ignore */
  }
}

/**
 * Find the MOST RECENT cached response whose key starts with `prefix`.
 * Used when offline and the exact URL isn't cached (e.g. dashboard with
 * a timestamp query param that changes every millisecond).
 */
export async function getCachedResponseByPrefix(prefix: string): Promise<CachedResponse | null> {
  try {
    const db = await openDB()
    const t = db.transaction(STORE_KV, 'readonly')
    const store = t.objectStore(STORE_KV)
    return new Promise<CachedResponse | null>((resolve) => {
      const req = store.openCursor()
      let bestMatch: CachedResponse | null = null
      let bestTime = 0
      req.onsuccess = () => {
        const cursor = req.result
        if (cursor) {
          const val = cursor.value as CachedResponse
          if (val.key.startsWith(prefix) && val.cachedAt > bestTime) {
            bestMatch = val
            bestTime = val.cachedAt
          }
          cursor.continue()
        } else {
          resolve(bestMatch)
        }
      }
      req.onerror = () => resolve(null)
    })
  } catch {
    return null
  }
}

export async function clearAllCache(): Promise<void> {
  try {
    await tx(STORE_KV, 'readwrite', (s) => s.clear())
  } catch {
    /* ignore */
  }
}

/**
 * Keep only the `keep` most recent cached entries for a given URL prefix.
 * Older entries are deleted to prevent IndexedDB from growing unbounded
 * (e.g. dashboard with timestamps created a new entry every page load).
 */
export async function trimCacheByPrefix(prefix: string, keep: number): Promise<void> {
  try {
    const db = await openDB()
    const t = db.transaction(STORE_KV, 'readwrite')
    const store = t.objectStore(STORE_KV)
    return new Promise<void>((resolve) => {
      // Collect all entries matching the prefix
      const matches: { key: string; cachedAt: number }[] = []
      const req = store.openCursor()
      req.onsuccess = () => {
        const cursor = req.result
        if (cursor) {
          const val = cursor.value as CachedResponse
          if (val.key.startsWith(prefix)) {
            matches.push({ key: val.key, cachedAt: val.cachedAt })
          }
          cursor.continue()
        } else {
          // Sort by cachedAt descending, delete everything after `keep`
          matches.sort((a, b) => b.cachedAt - a.cachedAt)
          const toDelete = matches.slice(keep)
          if (toDelete.length === 0) {
            resolve()
            return
          }
          let deleted = 0
          for (const item of toDelete) {
            const delReq = store.delete(item.key)
            delReq.onsuccess = () => {
              deleted++
              if (deleted === toDelete.length) resolve()
            }
            delReq.onerror = () => {
              deleted++
              if (deleted === toDelete.length) resolve()
            }
          }
        }
      }
      req.onerror = () => resolve()
    })
  } catch {
    /* ignore */
  }
}

// ────────────────────────────────────────────────────────────────────────────
// Pending writes queue
// ────────────────────────────────────────────────────────────────────────────

export interface PendingWrite {
  id?: number
  url: string
  method: 'POST' | 'PUT' | 'DELETE' | 'PATCH'
  body: string | null
  headers: Record<string, string>
  timestamp: number
  // For optimistic UI: which cache prefix should be invalidated after sync
  invalidates: string[]
}

export async function queuePendingWrite(w: Omit<PendingWrite, 'id' | 'timestamp'>): Promise<void> {
  try {
    await tx(STORE_PENDING, 'readwrite', (s) => s.add({ ...w, timestamp: Date.now() } as PendingWrite))
  } catch {
    /* ignore */
  }
}

export async function getPendingWrites(): Promise<PendingWrite[]> {
  try {
    const r = await tx<PendingWrite[]>(STORE_PENDING, 'readonly', (s) => s.getAll())
    return r.sort((a, b) => a.timestamp - b.timestamp)
  } catch {
    return []
  }
}

export async function deletePendingWrite(id: number): Promise<void> {
  try {
    await tx(STORE_PENDING, 'readwrite', (s) => s.delete(id))
  } catch {
    /* ignore */
  }
}

export async function getPendingWriteCount(): Promise<number> {
  try {
    const r = await tx<number>(STORE_PENDING, 'readonly', (s) => s.count())
    return r
  } catch {
    return 0
  }
}

// ────────────────────────────────────────────────────────────────────────────
// Meta (lastSyncAt etc.)
// ────────────────────────────────────────────────────────────────────────────

export async function setMeta(key: string, value: any): Promise<void> {
  try {
    await tx(STORE_META, 'readwrite', (s) => s.put({ key, value }))
  } catch {
    /* ignore */
  }
}

export async function getMeta<T = any>(key: string): Promise<T | null> {
  try {
    const r = await tx<{ key: string; value: T } | undefined>(STORE_META, 'readonly', (s) => s.get(key))
    return r?.value ?? null
  } catch {
    return null
  }
}

// ────────────────────────────────────────────────────────────────────────────
// Nuclear: clear everything (used on logout)
// ────────────────────────────────────────────────────────────────────────────

export async function clearAllOfflineData(): Promise<void> {
  await Promise.all([
    clearSession(),
    clearAllCache(),
    (async () => {
      try {
        await tx(STORE_PENDING, 'readwrite', (s) => s.clear())
      } catch {
        /* ignore */
      }
    })(),
    (async () => {
      try {
        await tx(STORE_META, 'readwrite', (s) => s.clear())
      } catch {
        /* ignore */
      }
    })(),
  ])
}
