'use client'

import { useEffect, useState, useCallback } from 'react'
import { WifiOff, CheckCircle, Loader2, RefreshCw, Clock } from 'lucide-react'
import {
  isOnline,
  onOnlineChange,
  syncPendingWrites,
  onSyncComplete,
  onPendingCountChange,
  getLastSyncAt,
  getPendingWriteCount,
} from '@/lib/offline-fetch'

export function OfflineIndicator() {
  const [online, setOnline] = useState(true)
  const [syncing, setSyncing] = useState(false)
  const [showSynced, setShowSynced] = useState(false)
  const [pendingCount, setPendingCount] = useState(0)
  const [lastSync, setLastSync] = useState<number | null>(null)
  const [expanded, setExpanded] = useState(false)

  useEffect(() => {
    setOnline(isOnline())
    getLastSyncAt().then(setLastSync)

    const unsubOnline = onOnlineChange(() => {
      setOnline(isOnline())
    })

    const unsubSync = onSyncComplete(() => {
      setSyncing(false)
      setShowSynced(true)
      setTimeout(() => setShowSynced(false), 3000)
      getLastSyncAt().then(setLastSync)
    })

    const unsubPending = onPendingCountChange((n) => setPendingCount(n))
    // Trigger initial count
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
      syncPendingWrites().catch(() => setSyncing(false))
    }
  }, [online, pendingCount, syncing])

  const handleManualSync = useCallback(async () => {
    if (!online || syncing) return
    setSyncing(true)
    try {
      await syncPendingWrites()
    } finally {
      setSyncing(false)
    }
  }, [online, syncing])

  // Hide entirely if online, no pending writes, not syncing, and not recently synced
  if (online && !syncing && !showSynced && pendingCount === 0) return null

  const formatLastSync = (ts: number | null) => {
    if (!ts) return 'Never'
    const diff = Date.now() - ts
    if (diff < 60_000) return 'Just now'
    if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`
    if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`
    return `${Math.floor(diff / 86_400_000)}d ago`
  }

  return (
    <div className="fixed bottom-4 right-4 z-50 print:hidden">
      {/* Synced toast */}
      {showSynced && (
        <div className="bg-emerald-600 text-white rounded-xl shadow-lg px-4 py-2.5 flex items-center gap-2 mb-2">
          <CheckCircle className="w-4 h-4" />
          <span className="text-sm font-medium">Data synced!</span>
        </div>
      )}

      {/* Syncing */}
      {syncing && (
        <div className="bg-blue-600 text-white rounded-xl shadow-lg px-4 py-2.5 flex items-center gap-2">
          <Loader2 className="w-4 h-4 animate-spin" />
          <span className="text-sm font-medium">Syncing {pendingCount > 0 ? `(${pendingCount} pending)` : '...'} </span>
        </div>
      )}

      {/* Offline banner with pending count */}
      {!online && (
        <div
          className="bg-amber-600 text-white rounded-xl shadow-lg overflow-hidden cursor-pointer"
          onClick={() => setExpanded((v) => !v)}
        >
          <div className="px-4 py-2.5 flex items-center gap-2">
            <WifiOff className="w-4 h-4" />
            <span className="text-sm font-medium">
              Offline{pendingCount > 0 ? ` — ${pendingCount} pending` : ''}
            </span>
          </div>
          {expanded && (
            <div className="bg-amber-700/80 px-4 py-3 text-xs space-y-2">
              <div className="flex items-center gap-2">
                <Clock className="w-3 h-3" />
                <span>Last sync: {formatLastSync(lastSync)}</span>
              </div>
              <p className="text-amber-100">
                Your changes are saved on this device. They will sync to the cloud automatically when internet returns.
              </p>
            </div>
          )}
        </div>
      )}

      {/* Online with pending writes (rare — sync in progress) */}
      {online && pendingCount > 0 && !syncing && (
        <div
          className="bg-blue-600 text-white rounded-xl shadow-lg px-4 py-2.5 flex items-center gap-2 cursor-pointer"
          onClick={handleManualSync}
        >
          <RefreshCw className="w-4 h-4" />
          <span className="text-sm font-medium">{pendingCount} pending — tap to sync</span>
        </div>
      )}
    </div>
  )
}
