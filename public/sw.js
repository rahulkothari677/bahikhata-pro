const CACHE_NAME = 'bahikhata-pro-v1'
const OFFLINE_QUEUE = 'bahikhata-offline-queue'
const APP_SHELL = ['/', '/manifest.json', '/icon-192.png', '/icon-512.png', '/logo.svg']

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL).catch(() => {})))
  self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  event.waitUntil(caches.keys().then((names) => Promise.all(names.filter((n) => n !== CACHE_NAME).map((n) => caches.delete(n)))))
  self.clients.claim()
})

self.addEventListener('fetch', (event) => {
  const { request } = event
  const url = new URL(request.url)
  if (request.method !== 'GET') {
    if (url.pathname.startsWith('/api/') && !navigator.onLine) { event.respondWith(queueRequest(request)); return }
    return
  }
  event.respondWith(
    fetch(request).then((response) => {
      if (response.ok && url.origin === self.location.origin) {
        const clone = response.clone()
        caches.open(CACHE_NAME).then((cache) => cache.put(request, clone))
      }
      return response
    }).catch(() => caches.match(request).then((cached) => cached || (request.mode === 'navigate' ? caches.match('/') : new Response('Offline', { status: 503 }))))
  )
})

async function queueRequest(request) {
  try {
    const body = await request.clone().text()
    const db = await openDB()
    await db.transaction(OFFLINE_QUEUE, 'readwrite').objectStore(OFFLINE_QUEUE).add({ url: request.url, method: request.method, body, headers: Object.fromEntries(request.headers.entries()), timestamp: Date.now() })
    return new Response(JSON.stringify({ success: true, queued: true }), { status: 200, headers: { 'Content-Type': 'application/json' } })
  } catch (e) { return new Response(JSON.stringify({ error: 'Failed to queue' }), { status: 500, headers: { 'Content-Type': 'application/json' } }) }
}

self.addEventListener('sync', (event) => { if (event.tag === 'bahikhata-sync') event.waitUntil(syncQueue()) })
self.addEventListener('message', (event) => { if (event.data === 'sync-now' && navigator.onLine) syncQueue() })

async function syncQueue() {
  try {
    const db = await openDB()
    const all = await db.transaction(OFFLINE_QUEUE, 'readonly').objectStore(OFFLINE_QUEUE).getAll()
    for (const q of all) {
      try {
        const r = await fetch(q.url, { method: q.method, body: q.body, headers: q.headers })
        if (r.ok) { await db.transaction(OFFLINE_QUEUE, 'readwrite').objectStore(OFFLINE_QUEUE).delete(q.id) }
      } catch (e) { break }
    }
    const clients = await self.clients.matchAll()
    clients.forEach((c) => c.postMessage({ type: 'sync-complete' }))
  } catch (e) {}
}

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open('bahikhata-offline-db', 1)
    req.onerror = () => reject(req.error)
    req.onsuccess = () => resolve(req.result)
    req.onupgradeneeded = (e) => { const db = e.target.result; if (!db.objectStoreNames.contains(OFFLINE_QUEUE)) db.createObjectStore(OFFLINE_QUEUE, { keyPath: 'id', autoIncrement: true }) }
  })
}
