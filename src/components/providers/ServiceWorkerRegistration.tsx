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

    const register = () => {
      navigator.serviceWorker
        .register('/sw.js', { scope: '/' })
        .then((reg) => {
          // Check for updates every hour
          setInterval(() => reg.update().catch(() => {}), 60 * 60 * 1000)
        })
        .catch((err) => {
          console.warn('[SW] Registration failed:', err)
        })
    }

    // Register after window load to not compete with initial page render
    if (document.readyState === 'complete') {
      register()
    } else {
      window.addEventListener('load', register, { once: true })
      return () => window.removeEventListener('load', register)
    }
  }, [])

  return null
}
