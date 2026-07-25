'use client'

/**
 * 🔒 Phase 8a: Offline banner.
 *
 * Shows a non-intrusive banner at the top of the screen when the user
 * goes offline. Matches WhatsApp's "connecting..." pattern — the user
 * always knows their connectivity state without blocking interaction.
 *
 * The banner is:
 * - Non-blocking (pointer-events-none on the container, auto on the text)
 * - Auto-hides when connection returns
 * - Shows on ALL screens (rendered in layout, not per-page)
 * - Uses amber (not red) — offline is a known state, not an error
 */

import { useState, useEffect } from 'react'
import { CloudOff } from 'lucide-react'

export function OfflineBanner() {
  const [isOffline, setIsOffline] = useState(false)

  useEffect(() => {
    // Initial check
    setIsOffline(!navigator.onLine)

    const handleOffline = () => setIsOffline(true)
    const handleOnline = () => setIsOffline(false)

    window.addEventListener('offline', handleOffline)
    window.addEventListener('online', handleOnline)

    return () => {
      window.removeEventListener('offline', handleOffline)
      window.removeEventListener('online', handleOnline)
    }
  }, [])

  if (!isOffline) return null

  return (
    <div className="fixed top-0 left-0 right-0 z-[100] bg-amber-500 text-white text-center py-1.5 px-4 text-xs font-medium flex items-center justify-center gap-2 no-print">
      <CloudOff className="w-3.5 h-3.5 flex-shrink-0" />
      <span>You&apos;re offline. Changes will sync when you reconnect.</span>
    </div>
  )
}
