/**
 * BahiKhata Pro Service Worker
 *
 * Strategy:
 *  - Precache the app shell on install (so the app loads even with zero cache).
 *  - For navigation requests: network-first, fall back to cached '/'.
 *    This ensures users can open the app offline (PWA), and the React app
 *    then uses offlineFetch for data which has its own IndexedDB cache.
 *  - For /api/* GET requests: passthrough to the app (offlineFetch handles
 *    caching). We don't intercept here to avoid double-caching.
 *  - For static assets (_next/static, images): cache-first (indefinite).
 *  - For mutations (POST/PUT/DELETE): passthrough — offlineFetch handles
 *    queueing via IndexedDB.
 */

const CACHE_VERSION = 'bahikhata-pro-v5'
const APP_SHELL = [
  '/',
  '/manifest.json',
  '/icon-192.png',
  '/icon-512.png',
  '/logo.svg',
  '/apple-touch-icon.png',
]

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE_VERSION)
      .then((cache) => cache.addAll(APP_SHELL).catch(() => {}))
      .then(() => self.skipWaiting()),
  )
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((names) =>
        Promise.all(
          names.filter((n) => n !== CACHE_VERSION).map((n) => caches.delete(n)),
        ),
      )
      .then(() => self.clients.claim()),
  )
})

self.addEventListener('fetch', (event) => {
  const { request } = event
  const url = new URL(request.url)

  // Only handle same-origin
  if (url.origin !== self.location.origin) return

  // Skip non-GET (mutations are handled by offlineFetch in the page)
  if (request.method !== 'GET') return

  // Skip /api/* — the app's offlineFetch layer handles API caching via
  // IndexedDB (not the Cache API), to keep auth headers and timestamps clean.
  if (url.pathname.startsWith('/api/')) return

  // Navigation requests: network-first, fall back to cached '/' or cached
  // navigation response. Never return undefined (causes "Failed to fetch").
  if (request.mode === 'navigate') {
    event.respondWith(
      (async () => {
        try {
          const response = await fetch(request)
          const clone = response.clone()
          const cache = await caches.open(CACHE_VERSION)
          cache.put(request, clone)
          return response
        } catch {
          // Offline — try exact match first, then cached '/'
          const exact = await caches.match(request)
          if (exact) return exact
          const root = await caches.match('/')
          if (root) return root
          // Last resort: a basic offline page
          return new Response(
            '<!DOCTYPE html><html><body style="font-family:sans-serif;padding:40px;text-align:center">' +
              '<h2>You are offline</h2><p>Please connect to the internet and refresh.</p>' +
              '</body></html>',
            { status: 503, headers: { 'Content-Type': 'text/html' } },
          )
        }
      })(),
    )
    return
  }

  // Static assets: cache-first
  if (
    url.pathname.startsWith('/_next/static/') ||
    url.pathname.match(/\.(?:js|css|woff2?|ttf|png|jpg|jpeg|svg|gif|webp|ico)$/)
  ) {
    event.respondWith(
      (async () => {
        const cached = await caches.match(request)
        if (cached) return cached
        try {
          const response = await fetch(request)
          if (response.ok) {
            const clone = response.clone()
            const cache = await caches.open(CACHE_VERSION)
            cache.put(request, clone)
          }
          return response
        } catch {
          // No cache, no network — return 503 instead of undefined
          return new Response('', { status: 504, statusText: 'Not Cached' })
        }
      })(),
    )
    return
  }

  // Default: try network, fall back to cache, return 503 if neither
  event.respondWith(
    fetch(request)
      .then((response) => {
        if (response.ok) {
          const clone = response.clone()
          caches.open(CACHE_VERSION).then((cache) => cache.put(request, clone))
        }
        return response
      })
      .catch(async () => {
        const cached = await caches.match(request)
        if (cached) return cached
        // No cache match — return a proper error response instead of undefined
        // (which would throw "Failed to fetch" inside event.respondWith)
        return new Response('Offline and not cached', {
          status: 503,
          statusText: 'Service Unavailable',
          headers: { 'Content-Type': 'text/plain' },
        })
      }),
  )
})

// Allow page to trigger manual sync
self.addEventListener('message', (event) => {
  if (event.data === 'skip-waiting') self.skipWaiting()
})
