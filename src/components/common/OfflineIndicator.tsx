'use client'

/**
 * OfflineIndicator — sticky top bar that shows when offline or when there are
 * pending writes waiting to sync.
 *
 * Two display modes:
 * - Sticky top bar (new): always visible when offline — replaces the small
 *   floating toast in the bottom-right corner. User can't miss it.
 * - Floating sync toast (kept): shows briefly when sync completes, or when
 *   online with pending writes (rare case).
 *
 * Behavior:
 * - When offline: amber bar at top with "Offline — N pending" + Last sync
 * - When online + pending: blue bar at top with "Syncing N..."
 * - When sync completes: green toast at bottom-right for 3 seconds
 */

import { useEffect, useState, useCallback } from 'react'
import { CheckCircle, Loader2, RefreshCw, Clock, CloudOff, Cloud } from 'lucide-react'
import {
  isOnline,
  onOnlineChange,
  syncPendingWrites,
  onSyncComplete,
  onPendingCountChange,
  getLastSyncAt,
  getPendingWriteCount,
} from '@/lib/offline-fetch'
import { haptic } from '@/lib/haptic'

export function OfflineIndicator() {
  const [online, setOnline] = useState(true)
  const [syncing, setSyncing] = useState(false)
  const [showSynced, setShowSynced] = useState(false)
  const [pendingCount, setPendingCount] = useState(0)
  const [lastSync, setLastSync] = useState<number | null>(null)

  useEffect(() => {
    setOnline(isOnline())
    getLastSyncAt().then(setLastSync)

    const unsubOnline = onOnlineChange(() => {
      setOnline(isOnline())
      haptic.tick()
    })

    const unsubSync = onSyncComplete(() => {
      setSyncing(false)
      setShowSynced(true)
      setTimeout(() => setShowSynced(false), 3000)
      getLastSyncAt().then(setLastSync)
      haptic.success()
    })

    const unsubPending = onPendingCountChange((n) => setPendingCount(n))
    getPendingWriteCount().then(setPendingCount)

    return () => {
      unsubOnline()
      unsubSync()
      unsubPending()
    }
  }, [])

  // Auto-sync when coming online
  useEffect(() => {
    if (online && pendingCount > 0 && !syncing) {
      setSyncing(true)
      syncPendingWrites()
        .catch(() => {})
        .finally(() => setSyncing(false))
    }
  }, [online, pendingCount, syncing])

  const handleManualSync = useCallback(async () => {
    if (!online || syncing) return
    setSyncing(true)
    haptic.click()
    try {
      await syncPendingWrites()
    } finally {
      setSyncing(false)
    }
  }, [online, syncing])

  const formatLastSync = (ts: number | null) => {
    if (!ts) return 'Never'
    const diff = Date.now() - ts
    if (diff < 60_000) return 'just now'
    if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`
    if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`
    return `${Math.floor(diff / 86_400_000)}d ago`
  }

  // Show top bar if: offline OR (online + syncing) OR (online + pending)
  const showTopBar = !online || (online && (syncing || pendingCount > 0))

  return (
    <>
      {/* Sticky top bar — most prominent */}
      {showTopBar && (
        <div
          className={`sticky top-0 z-50 print:hidden ${
            !online
              ? 'bg-amber-600 text-white'
              : syncing
                ? 'bg-blue-600 text-white'
                : 'bg-blue-600 text-white'
          }`}
          role="status"
          aria-live="polite"
        >
          <div className="flex items-center justify-between gap-3 px-4 py-2 text-xs sm:text-sm">
            <div className="flex items-center gap-2 min-w-0">
              {!online ? (
                <>
                  <CloudOff className="w-4 h-4 flex-shrink-0" />
                  <span className="font-medium truncate">
                    You&apos;re offline{pendingCount > 0 ? ` — ${pendingCount} change${pendingCount === 1 ? '' : 's'} queued` : ''}
                  </span>
                  {lastSync && (
                    <span className="hidden sm:inline opacity-80 truncate">
                      · Last sync {formatLastSync(lastSync)}
                    </span>
                  )}
                </>
              ) : syncing ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin flex-shrink-0" />
                  <span className="font-medium truncate">
                    Syncing{pendingCount > 0 ? ` ${pendingCount} change${pendingCount === 1 ? '' : 's'}` : '...'}
                  </span>
                </>
              ) : (
                <>
                  <Cloud className="w-4 h-4 flex-shrink-0" />
                  <span className="font-medium truncate">
                    {pendingCount} pending change{pendingCount === 1 ? '' : 's'} — tap to sync
                  </span>
                </>
              )}
            </div>
            {online && !syncing && pendingCount > 0 && (
              <button
                onClick={handleManualSync}
                className="flex items-center gap-1.5 px-2 py-1 rounded-md bg-white/20 hover:bg-white/30 transition flex-shrink-0 min-h-[36px]"
              >
                <RefreshCw className="w-3.5 h-3.5" />
                <span className="font-medium">Sync now</span>
              </button>
            )}
            {!online && (
              <span className="hidden sm:flex items-center gap-1 text-[11px] opacity-80 flex-shrink-0">
                <Clock className="w-3 h-3" />
                Changes will sync automatically
              </span>
            )}
          </div>
        </div>
      )}

      {/* Synced toast — bottom-right, brief confirmation */}
      {showSynced && (
        <div className="fixed bottom-20 lg:bottom-4 right-4 z-50 print:hidden">
          <div className="bg-emerald-600 text-white rounded-xl shadow-lg px-4 py-2.5 flex items-center gap-2">
            <CheckCircle className="w-4 h-4" />
            <span className="text-sm font-medium">All changes synced!</span>
          </div>
        </div>
      )}
    </>
  )
}
