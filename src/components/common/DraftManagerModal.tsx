'use client'

/**
 * DraftManagerModal — shows all saved drafts for a form type, lets the user
 * restore or delete each one. Opens from a "Drafts" button inside the form.
 */

import { useState } from 'react'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { FileText, RotateCcw, Trash2, Clock, Package, IndianRupee } from 'lucide-react'
import { cn, formatINR } from '@/lib/utils'
import { haptic } from '@/lib/haptic'
import { getDraftLabel, getDraftTotal, type DraftEnvelope } from '@/hooks/use-drafts'

export function DraftManagerModal<T>({
  open,
  onOpenChange,
  drafts,
  activeDraftId,
  onRestore,
  onDelete,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  drafts: DraftEnvelope<T>[]
  activeDraftId: string | null
  onRestore: (id: string) => void
  onDelete: (id: string) => void
}) {
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null)

  const handleRestore = (id: string) => {
    haptic.success()
    onRestore(id)
    onOpenChange(false)
  }

  const handleDelete = (id: string) => {
    haptic.warning()
    onDelete(id)
    setConfirmDeleteId(null)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileText className="w-5 h-5 text-primary" />
            Saved Drafts
          </DialogTitle>
          <p className="text-xs text-muted-foreground">
            Drafts auto-expire after 24 hours. {drafts.length} saved.
          </p>
        </DialogHeader>

        {drafts.length === 0 ? (
          <div className="py-12 text-center">
            <FileText className="w-12 h-12 mx-auto text-muted-foreground/30 mb-3" />
            <p className="text-sm font-medium text-muted-foreground">No saved drafts</p>
            <p className="text-xs text-muted-foreground mt-1">
              Drafts are saved automatically as you fill the form.
              If you leave without submitting, your work will be here.
            </p>
          </div>
        ) : (
          <div className="space-y-2 py-2">
            {drafts.map((draft) => {
              const data = draft.data as any
              const itemCount = data?.items?.length || 0
              const total = getDraftTotal(data)
              const label = getDraftLabel(data)
              const isActive = draft.id === activeDraftId
              const isConfirming = confirmDeleteId === draft.id

              return (
                <div
                  key={draft.id}
                  className={cn(
                    'rounded-lg border p-3 transition',
                    isActive
                      ? 'border-primary bg-primary/5'
                      : 'border-border hover:border-primary/30 hover:bg-muted/30'
                  )}
                >
                  <div className="flex items-start justify-between gap-2 mb-1">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-sm font-semibold truncate">{label}</span>
                        {isActive && (
                          <Badge variant="secondary" className="text-[9px] bg-primary/10 text-primary">
                            Current
                          </Badge>
                        )}
                      </div>
                      <div className="flex items-center gap-3 mt-1 text-[11px] text-muted-foreground">
                        <span className="flex items-center gap-1">
                          <Clock className="w-3 h-3" />
                          {formatAgo(draft.savedAt)}
                        </span>
                        {itemCount > 0 && (
                          <span className="flex items-center gap-1">
                            <Package className="w-3 h-3" />
                            {itemCount} item{itemCount === 1 ? '' : 's'}
                          </span>
                        )}
                        {total > 0 && (
                          <span className="flex items-center gap-1">
                            <IndianRupee className="w-3 h-3" />
                            {formatINR(total)}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>

                  <div className="flex gap-2 mt-2">
                    {!isConfirming ? (
                      <>
                        <Button
                          size="sm"
                          variant="outline"
                          className="gap-1.5 h-8 flex-1"
                          onClick={() => handleRestore(draft.id)}
                        >
                          <RotateCcw className="w-3.5 h-3.5" />
                          Restore
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="gap-1.5 h-8 text-rose-600 hover:bg-rose-50 hover:text-rose-700"
                          onClick={() => setConfirmDeleteId(draft.id)}
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </Button>
                      </>
                    ) : (
                      <>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-8 flex-1"
                          onClick={() => setConfirmDeleteId(null)}
                        >
                          Cancel
                        </Button>
                        <Button
                          size="sm"
                          variant="destructive"
                          className="h-8 flex-1 gap-1.5"
                          onClick={() => handleDelete(draft.id)}
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                          Delete
                        </Button>
                      </>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} className="w-full sm:w-auto">
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function formatAgo(ts: number): string {
  const diff = Date.now() - ts
  if (diff < 60_000) return 'just now'
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`
  return `${Math.floor(diff / 86_400_000)}d ago`
}
