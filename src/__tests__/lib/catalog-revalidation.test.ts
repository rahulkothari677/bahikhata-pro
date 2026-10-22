/**
 * @jest-environment node
 *
 * Phase 7a (#297) — the phone keeps the item list and asks "changed since this
 * version?". Runs the real offlineFetch with the storage and network faked.
 * (Node's own Response and Headers; jsdom has neither.)
 */
import { describe, test, expect, jest, beforeEach } from '@jest/globals'

const store = new Map<string, { key: string; body: any; cachedAt: number; etag?: string }>()
jest.mock('@/lib/offline-db', () => ({
  cacheResponse: jest.fn(async (key: string, body: any, etag?: string | null) => { store.set(key, { key, body, cachedAt: Date.now(), ...(etag ? { etag } : {}) }) }),
  getCachedResponse: jest.fn(async (key: string) => store.get(key) ?? null),
  getCachedResponseByPrefix: jest.fn(async () => null),
  clearCacheByUrlPrefix: jest.fn(async () => {}),
  trimCacheByPrefix: jest.fn(async () => {}),
  queuePendingWrite: jest.fn(), saveSession: jest.fn(), getCachedSession: jest.fn(), clearAllOfflineData: jest.fn(),
  getPendingWriteCount: jest.fn(async () => 0), getPendingWrites: jest.fn(async () => []), deletePendingWrite: jest.fn(),
  updatePendingWriteAttempts: jest.fn(), setMeta: jest.fn(), getMeta: jest.fn(async () => null), saveToDeadLetter: jest.fn(),
  getDeadLetterCount: jest.fn(async () => 0),
}))

// Online, as a phone with signal is (Node's own navigator has no onLine).
Object.defineProperty(globalThis, 'navigator', { value: { onLine: true }, configurable: true })

const CATALOG = { products: [{ id: 'p1', name: 'Parle-G ₹10' }], total: 1, truncated: false }
const TAG = 'W/"items-u1-1-1792643891778-full"'
let calls: { url: string; ifNoneMatch: string | null }[] = []

beforeEach(() => {
  store.clear()
  calls = []
  ;(global as any).fetch = jest.fn(async (url: string, opts?: RequestInit) => {
    const ifNoneMatch = new Headers(opts?.headers).get('If-None-Match')
    calls.push({ url, ifNoneMatch })
    if (ifNoneMatch === TAG) return new Response(null, { status: 304, headers: { ETag: TAG } })
    return new Response(JSON.stringify(CATALOG), { status: 200, headers: { 'Content-Type': 'application/json', ETag: TAG } })
  })
})

describe('the item list is downloaded once, then only asked about', () => {
  test('first load: the body arrives and its tag is kept with it', async () => {
    const { offlineFetch } = await import('@/lib/offline-fetch')
    const r = await offlineFetch('/api/products')
    expect(await r.json()).toEqual(CATALOG)
    expect(calls[0].ifNoneMatch).toBeNull()
    await new Promise((res) => setTimeout(res, 0))
    expect(store.get('/api/products')?.etag).toBe(TAG)
  })
  test('next load: the kept tag is sent, the server says 304, and the kept list is the answer', async () => {
    const { offlineFetch } = await import('@/lib/offline-fetch')
    store.set('/api/products', { key: '/api/products', body: CATALOG, cachedAt: 1, etag: TAG })
    const r = await offlineFetch('/api/products')
    expect(calls[0].ifNoneMatch).toBe(TAG)
    expect(r.status).toBe(200)
    expect(r.headers.get('X-bahikhata-Source')).toBe('revalidated')
    expect(await r.json()).toEqual(CATALOG)
  })
  test('a changed list (new tag) is downloaded again, and other lists never send a tag', async () => {
    const { offlineFetch } = await import('@/lib/offline-fetch')
    store.set('/api/products', { key: '/api/products', body: { products: [] }, cachedAt: 1, etag: 'W/"items-u1-0-0-full"' })
    const r = await offlineFetch('/api/products')
    expect(await r.json()).toEqual(CATALOG)
    store.set('/api/parties', { key: '/api/parties', body: {}, cachedAt: 1, etag: TAG })
    await offlineFetch('/api/parties')
    expect(calls.find((c) => c.url === '/api/parties')?.ifNoneMatch).toBeNull()
  })
})
