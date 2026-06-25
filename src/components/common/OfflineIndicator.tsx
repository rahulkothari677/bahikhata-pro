'use client'
import { useEffect, useState } from 'react'
import { WifiOff, CheckCircle, Loader2 } from 'lucide-react'

export function OfflineIndicator() {
  const [isOnline, setIsOnline] = useState(true)
  const [syncing, setSyncing] = useState(false)
  const [showSynced, setShowSynced] = useState(false)

  useEffect(() => {
    if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {})
    Promise.resolve().then(() => setIsOnline(navigator.onLine))
    const handleOnline = () => { setIsOnline(true); if ('serviceWorker' in navigator && navigator.serviceWorker.controller) { setSyncing(true); navigator.serviceWorker.ready.then((reg) => { if ('sync' in reg) reg.sync.register('bahikhata-sync').catch(() => navigator.serviceWorker.controller.postMessage('sync-now')) }) } }
    const handleOffline = () => setIsOnline(false)
    window.addEventListener('online', handleOnline)
    window.addEventListener('offline', handleOffline)
    const handleMessage = (e) => { if (e.data?.type === 'sync-complete') { setSyncing(false); setShowSynced(true); setTimeout(() => setShowSynced(false), 3000) } }
    if ('serviceWorker' in navigator) navigator.serviceWorker.addEventListener('message', handleMessage)
    return () => { window.removeEventListener('online', handleOnline); window.removeEventListener('offline', handleOffline) }
  }, [])

  if (isOnline && !syncing && !showSynced) return null
  return (
    <div className="fixed bottom-4 right-4 z-50">
      {showSynced ? (
        <div className="bg-emerald-600 text-white rounded-xl shadow-lg px-4 py-2.5 flex items-center gap-2">
          <CheckCircle className="w-4 h-4" /><span className="text-sm font-medium">Data synced!</span>
        </div>
      ) : syncing ? (
        <div className="bg-blue-600 text-white rounded-xl shadow-lg px-4 py-2.5 flex items-center gap-2">
          <Loader2 className="w-4 h-4 animate-spin" /><span className="text-sm font-medium">Syncing...</span>
        </div>
      ) : (
        <div className="bg-amber-600 text-white rounded-xl shadow-lg px-4 py-2.5 flex items-center gap-2">
          <WifiOff className="w-4 h-4" /><span className="text-sm font-medium">Offline — changes will sync</span>
        </div>
      )}
    </div>
  )
}
