'use client'

/**
 * OfflineNoData — friendly empty state shown when the user is offline AND
 * no cached data exists for the current view.
 *
 * Instead of showing an endless loading skeleton, this tells the user
 * what happened and what they can do.
 */

import { CloudOff, Wifi, RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { isOnline } from '@/lib/offline-fetch'

export function OfflineNoData({
  title = 'No cached data',
  message = "You're offline and this data hasn't been cached yet. Connect to internet once to load it — after that, it works offline.",
  onRetry,
  retryLabel = 'Try again',
  children,
}: {
  title?: string
  message?: string
  onRetry?: () => void
  retryLabel?: string
  children?: React.ReactNode
}) {
  return (
    <div className="flex flex-col items-center justify-center py-12 px-4 text-center">
      <div className="w-16 h-16 rounded-full bg-amber-100 dark:bg-amber-950/40 flex items-center justify-center mb-4">
        <CloudOff className="w-8 h-8 text-amber-600" />
      </div>
      <h3 className="text-lg font-semibold mb-2">{title}</h3>
      <p className="text-sm text-muted-foreground max-w-sm mb-4">{message}</p>
      {children}
      {onRetry && (
        <Button variant="outline" size="sm" onClick={onRetry} className="gap-2 mt-2">
          {isOnline() ? <RefreshCw className="w-4 h-4" /> : <Wifi className="w-4 h-4" />}
          {retryLabel}
        </Button>
      )}
    </div>
  )
}
