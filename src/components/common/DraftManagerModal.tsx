'use client'

/**
 * DraftManagerModal — shows all saved drafts for a form type.
 *
 * Each draft can be:
 * - Expanded (tap the draft row) to show its full contents (items, party, notes)
 * - Restored (loads into the form)
 * - Deleted (with confirmation)
 */

import { useState } from 'react'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { FileText, RotateCcw, Trash2, Clock, Package, IndianRupee, ChevronDown, ChevronUp, Eye, X } from 'lucide-react'
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
  const [expandedId, setExpandedId] = useState<string | null>(null)
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
    if (expandedId === id) setExpandedId(null)
  }

  const toggleExpand = (id: string) => {
    haptic.click()
    setExpandedId(expandedId === id ? null : id)
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
            <br />
            <span className="text-[10px]">Tap a draft to view its contents.</span>
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
              const isExpanded = expandedId === draft.id

              return (
                <div
                  key={draft.id}
                  className={cn(
                    'rounded-lg border transition',
                    isActive
                      ? 'border-primary bg-primary/5'
                      : 'border-border hover:border-primary/30',
                    isExpanded && 'ring-1 ring-primary/30'
                  )}
                >
                  {/* Draft header row — tappable to expand */}
                  <button
                    onClick={() => toggleExpand(draft.id)}
                    className="w-full p-3 text-left"
                  >
                    <div className="flex items-start justify-between gap-2">
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
                      {isExpanded ? (
                        <ChevronUp className="w-4 h-4 text-muted-foreground flex-shrink-0" />
                      ) : (
                        <ChevronDown className="w-4 h-4 text-muted-foreground flex-shrink-0" />
                      )}
                    </div>
                  </button>

                  {/* Expanded view — shows draft contents */}
                  {isExpanded && (
                    <div className="px-3 pb-3 border-t border-border/50 mt-1 pt-3">
                      {/* Party info */}
                      {data?.partyId && (
                        <div className="mb-2 text-xs">
                          <span className="text-muted-foreground">Party: </span>
                          <span className="font-medium">{data.partyName || 'Selected'}</span>
                        </div>
                      )}
                      {data?.invoiceNo && (
                        <div className="mb-2 text-xs">
                          <span className="text-muted-foreground">Invoice #: </span>
                          <span className="font-medium font-mono">{data.invoiceNo}</span>
                        </div>
                      )}
                      {data?.notes && (
                        <div className="mb-2 text-xs">
                          <span className="text-muted-foreground">Notes: </span>
                          <span className="font-medium">{data.notes}</span>
                        </div>
                      )}

                      {/* Items list */}
                      {itemCount > 0 ? (
                        <div className="rounded-md border border-border/50 overflow-hidden">
                          <table className="w-full text-xs">
                            <thead className="bg-muted/50">
                              <tr>
                                <th className="text-left p-1.5 font-medium">Item</th>
                                <th className="text-right p-1.5 font-medium">Qty</th>
                                <th className="text-right p-1.5 font-medium">Price</th>
                                <th className="text-right p-1.5 font-medium">Total</th>
                              </tr>
                            </thead>
                            <tbody>
                              {data.items.map((item: any, i: number) => (
                                <tr key={i} className="border-t border-border/30">
                                  <td className="p-1.5 truncate max-w-[120px]">{item.productName}</td>
                                  <td className="p-1.5 text-right">{item.quantity}</td>
                                  <td className="p-1.5 text-right">{formatINR(item.unitPrice)}</td>
                                  <td className="p-1.5 text-right font-medium">{formatINR(item.unitPrice * item.quantity)}</td>
                                </tr>
                              ))}
                            </tbody>
                            <tfoot className="bg-muted/30 border-t border-border">
                              <tr>
                                <td colSpan={3} className="p-1.5 text-right font-semibold">Total</td>
                                <td className="p-1.5 text-right font-bold">{formatINR(total)}</td>
                              </tr>
                            </tfoot>
                          </table>
                        </div>
                      ) : (
                        <p className="text-xs text-muted-foreground italic">No items in this draft</p>
                      )}

                      {/* Action buttons */}
                      <div className="flex gap-2 mt-3">
                        {!isConfirming ? (
                          <>
                            <Button
                              size="sm"
                              className="gap-1.5 h-9 flex-1 bg-gradient-saffron"
                              onClick={() => handleRestore(draft.id)}
                              disabled={itemCount === 0 && !data?.partyId && !data?.invoiceNo && !data?.notes}
                            >
                              <RotateCcw className="w-3.5 h-3.5" />
                              Restore this draft
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              className="gap-1.5 h-9 text-rose-600 hover:bg-rose-50 hover:text-rose-700 px-3"
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
                              className="h-9 flex-1"
                              onClick={() => setConfirmDeleteId(null)}
                            >
                              Cancel
                            </Button>
                            <Button
                              size="sm"
                              variant="destructive"
                              className="h-9 flex-1 gap-1.5"
                              onClick={() => handleDelete(draft.id)}
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                              Delete
                            </Button>
                          </>
                        )}
                      </div>
                    </div>
                  )}

                  {/* When not expanded, show a compact View button */}
                  {!isExpanded && !isConfirming && (
                    <div className="px-3 pb-2 flex gap-2">
                      <Button
                        size="sm"
                        variant="ghost"
                        className="gap-1 h-7 text-xs text-muted-foreground"
                        onClick={() => toggleExpand(draft.id)}
                      >
                        <Eye className="w-3 h-3" />
                        View
                      </Button>
                    </div>
                  )}
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
