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

const CACHE_VERSION = 'bahikhata-pro-v3'
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

  // Navigation requests: network-first, fall back to cached '/'
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const clone = response.clone()
          caches.open(CACHE_VERSION).then((cache) => cache.put(request, clone))
          return response
        })
        .catch(() =>
          caches.match(request).then((cached) => cached || caches.match('/')),
        ),
    )
    return
  }

  // Static assets: cache-first
  if (
    url.pathname.startsWith('/_next/static/') ||
    url.pathname.match(/\.(?:js|css|woff2?|ttf|png|jpg|jpeg|svg|gif|webp|ico)$/)
  ) {
    event.respondWith(
      caches.match(request).then(
        (cached) =>
          cached ||
          fetch(request).then((response) => {
            if (response.ok) {
              const clone = response.clone()
              caches.open(CACHE_VERSION).then((cache) => cache.put(request, clone))
            }
            return response
          }),
      ),
    )
    return
  }

  // Default: try network, fall back to cache
  event.respondWith(
    fetch(request)
      .then((response) => {
        if (response.ok) {
          const clone = response.clone()
          caches.open(CACHE_VERSION).then((cache) => cache.put(request, clone))
        }
        return response
      })
      .catch(() => caches.match(request)),
  )
})

// Allow page to trigger manual sync
self.addEventListener('message', (event) => {
  if (event.data === 'skip-waiting') self.skipWaiting()
})
