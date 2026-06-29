'use client'

/**
 * ServiceWorkerRegistration — registers /sw.js on mount.
 *
 * The service worker is what makes the app work OFFLINE by serving the
 * cached HTML page (app shell) when the network is unavailable.
 * Without this, going offline shows Chrome's "ERR_INTERNET_DISCONNECTED"
 * dinosaur page — the app can't even load.
 *
 * The SW caches:
 * - App shell (HTML, manifest, icons) on install
 * - Static assets (_next/static/*, fonts, images) on first fetch
 * - Navigation requests: network-first, falls back to cached '/'
 *
 * API responses are NOT cached by the SW — that's handled by offlineFetch
 * + IndexedDB for proper auth header handling.
 */

import { useEffect } from 'react'

export function ServiceWorkerRegistration() {
  useEffect(() => {
    if (typeof window === 'undefined') return
    if (!('serviceWorker' in navigator)) return

    // Only register in production (avoids confusing dev experience)
    if (process.env.NODE_ENV !== 'production') return

    let reloading = false

    const register = () => {
      navigator.serviceWorker
        .register('/sw.js', { scope: '/' })
        .then((reg) => {
          // Check for updates every 5 minutes (was 1 hour — too slow for
          // users who keep the app open all day)
          setInterval(() => reg.update().catch(() => {}), 5 * 60 * 1000)

          // If a new SW is waiting to activate, force it to take over
          // immediately (skipWaiting) and reload the page when it does.
          if (reg.waiting) {
            reg.waiting.postMessage('skip-waiting')
          }

          // When a new SW is found during update, prompt it to take over
          reg.addEventListener('updatefound', () => {
            const newWorker = reg.installing
            if (!newWorker) return
            newWorker.addEventListener('statechange', () => {
              if (newWorker.state === 'installed') {
                // New SW installed — if there's an existing controller,
                // a new version is available. Force it to take over.
                if (navigator.serviceWorker.controller) {
                  newWorker.postMessage('skip-waiting')
                }
              }
            })
          })
        })
        .catch((err) => {
          console.warn('[SW] Registration failed:', err)
        })
    }

    // When a new SW takes control (after skipWaiting), reload the page
    // so the new HTML + new JS chunks are loaded. Without this, the old
    // HTML stays in memory and references old JS chunk hashes.
    const onControllerChange = () => {
      if (reloading) return
      reloading = true
      window.location.reload()
    }
    navigator.serviceWorker.addEventListener('controllerchange', onControllerChange)

    // Register after window load to not compete with initial page render
    if (document.readyState === 'complete') {
      register()
    } else {
      window.addEventListener('load', register, { once: true })
    }

    return () => {
      navigator.serviceWorker.removeEventListener('controllerchange', onControllerChange)
    }
  }, [])

  return null
}
