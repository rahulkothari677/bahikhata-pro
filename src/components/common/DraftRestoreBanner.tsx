'use client'

/**
 * DraftRestoreBanner — shows a banner at the top of a form when an autosaved
 * draft is detected. Asks the user: Restore / Discard.
 *
 * Used by sale/purchase entry forms.
 */

import { AlertCircle, RotateCcw, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useEffect, useState } from 'react'

export function DraftRestoreBanner({
  show,
  savedAt,
  onRestore,
  onDiscard,
}: {
  show: boolean
  savedAt: number | null
  onRestore: () => void
  onDiscard: () => void
}) {
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    if (show) {
      // Small delay so banner slides in smoothly
      const t = setTimeout(() => setVisible(true), 100)
      return () => clearTimeout(t)
    } else {
      setVisible(false)
    }
  }, [show])

  if (!show) return null

  const ago = savedAt ? formatAgo(savedAt) : 'earlier'

  return (
    <div
      className={`rounded-xl border border-amber-200 dark:border-amber-900/50 bg-amber-50 dark:bg-amber-950/30 p-3 flex items-start gap-3 transition-all duration-300 ${visible ? 'opacity-100 translate-y-0' : 'opacity-0 -translate-y-2'}`}
    >
      <AlertCircle className="w-5 h-5 text-amber-600 flex-shrink-0 mt-0.5" />
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-amber-900 dark:text-amber-200">
          Unsaved draft from {ago}
        </p>
        <p className="text-xs text-amber-700 dark:text-amber-300 mt-0.5">
          We saved your work automatically. Restore it or start fresh.
        </p>
      </div>
      <div className="flex gap-2 flex-shrink-0">
        <Button size="sm" variant="outline" onClick={onDiscard} className="gap-1.5 h-8">
          <Trash2 className="w-3.5 h-3.5" />
          Discard
        </Button>
        <Button size="sm" onClick={onRestore} className="gap-1.5 h-8 bg-amber-600 hover:bg-amber-700 text-white">
          <RotateCcw className="w-3.5 h-3.5" />
          Restore
        </Button>
      </div>
    </div>
  )
}

function formatAgo(ts: number): string {
  const diff = Date.now() - ts
  if (diff < 60_000) return 'just now'
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`
  return `${Math.floor(diff / 86_400_000)}d ago`
}
