'use client'

/**
 * DraftRestoreBanner — shows a banner at the top of a form when an autosaved
 * draft is detected. Asks the user: Restore / Discard.
 *
 * Used by sale/purchase entry forms.
 */

import { AlertCircle, RotateCcw, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Notice } from '@/components/ui/notice'
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

  // Phase 4b: the one warning box, level Act, with both choices on the box.
  return (
    <div className={`transition-all duration-200 ${visible ? 'opacity-100 translate-y-0' : 'opacity-0 -translate-y-2'}`}>
      <Notice
        level="act"
        icon={AlertCircle}
        title={`Unsaved draft from ${ago}`}
        action={
          <>
            <Button variant="outline" onClick={onDiscard} className="gap-1.5 h-12">
              <Trash2 className="w-4 h-4" aria-hidden />
              Discard
            </Button>
            <Button onClick={onRestore} className="gap-1.5 h-12">
              <RotateCcw className="w-4 h-4" aria-hidden />
              Restore
            </Button>
          </>
        }
      >
        Restore it or start fresh.
      </Notice>
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
