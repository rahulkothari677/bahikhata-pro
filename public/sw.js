/**
 * EkBook Service Worker v6
 *
 * PERFORMANCE: Aggressive static asset caching for instant repeat loads.
 *
 * Strategy:
 *  - Precache the app shell on install (HTML, icons, manifest).
 *  - For navigation requests: network-first, fall back to cached '/'.
 *  - For /api/* GET requests: passthrough (offlineFetch handles caching).
 *  - For static assets (_next/static, fonts, images): CACHE-FIRST.
 *    Static assets are content-hashed (e.g. chunks/abc123.js), so they're
 *    safe to cache indefinitely. When the app updates, the hash changes
 *    and a new URL is fetched — the old cache just becomes stale.
 *  - For mutations (POST/PUT/DELETE): passthrough (offlineFetch handles queueing).
 */

const CACHE_VERSION = 'bahikhata-pro-v8'
const STATIC_CACHE = 'bahikhata-static-v8'
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
          // Delete ALL old caches (both v7 and any other older versions)
          // This ensures stale HTML and JS chunks from the previous version
          // are purged, forcing the app to fetch fresh code from Vercel.
          names
            .filter((n) => n !== CACHE_VERSION && n !== STATIC_CACHE)
            .map((n) => caches.delete(n)),
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

  // Static assets: CACHE-FIRST with indefinite caching.
  // These assets are content-hashed by Next.js (e.g. chunks/abc123.js), so
  // caching them forever is safe — when the app updates, the hash changes
  // and a new URL is requested. Old cached entries are purged on SW activate.
  if (
    url.pathname.startsWith('/_next/static/') ||
    url.pathname.match(/\.(?:js|css|woff2?|ttf|png|jpg|jpeg|svg|gif|webp|ico)$/)
  ) {
    event.respondWith(
      (async () => {
        // 1. Check cache first
        const cached = await caches.match(request)
        if (cached) return cached
        // 2. Fetch from network, cache the response
        try {
          const response = await fetch(request)
          if (response.ok) {
            const clone = response.clone()
            const cache = await caches.open(STATIC_CACHE)
            cache.put(request, clone)
          }
          return response
        } catch {
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

// When a new SW takes control, force all clients to reload so they
// get the new HTML + new JS chunks. Without this, the old HTML stays
// loaded and references old JS chunk hashes — even though the new SW
// is active.
self.addEventListener('controllerchange', (event) => {
  // This fires in the page (not the SW) when a new SW takes control.
  // We don't need to do anything here — the page's SW registration
  // code handles the reload.
})
