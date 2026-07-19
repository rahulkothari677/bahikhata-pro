'use client'

/**
 * 🔒 V26 R7 (Phase 5): Unsynced Entries card — surfaces the dead-letter store.
 *
 * Phase 5 audit (R7 🟠): the dead-letter store had ZERO UI consumers.
 * `saveToDeadLetter`'s comment promised "the user can see it, review it, and
 * re-enter the data" — but there was no screen to do any of that. The only
 * surface was a toast saying N entries "need manual review. Please re-enter
 * them" — with no way to see what they were. For a shopkeeper, that's a day
 * of sales reduced to a number in a toast.
 *
 * This card lists each dead-letter item — parses the body JSON, shows
 * method/endpoint mapped to a human label ("Sale — ₹1,240, 3 items, 16 Jul"),
 * with Retry (re-queue via queuePendingWrite + delete from dead-letter) and
 * Discard buttons. A persistent badge shows the count when > 0.
 *
 * Renders inside Settings → Data section.
 */

import { useState, useEffect, useCallback } from 'react'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { AlertCircle, RefreshCw, Trash2, Inbox } from 'lucide-react'
import { toast as sonnerToast } from 'sonner'
import {
  getDeadLetterItems,
  deleteDeadLetterItem,
  clearDeadLetter,
  queuePendingWrite,
  type PendingWrite,
} from '@/lib/offline-db'
import { syncPendingWrites } from '@/lib/offline-fetch'
import { haptic } from '@/lib/haptic'

interface DeadLetterItem extends PendingWrite {
  id: number
  timestamp: number
  reason: string
}

/**
 * Map method + URL + body to a human-readable label.
 * Examples:
 *   POST /api/transactions  + {type: 'sale', totalAmount: 1240, items: [...]}
 *     → "Sale — ₹1,240, 3 items, 16 Jul"
 *   POST /api/payments      + {amount: 500, type: 'received'}
 *     → "Payment received — ₹500, 16 Jul"
 *   PUT  /api/parties/abc   + {name: 'Rajesh'}
 *     → "Party edit — Rajesh"
 *   DELETE /api/transactions/abc
 *     → "Sale deletion"
 */
function describeItem(item: DeadLetterItem): { label: string; detail: string } {
  const method = item.method
  const url = item.url
  const date = new Date(item.timestamp).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' })

  let body: any = {}
  try {
    body = item.body ? JSON.parse(item.body) : {}
  } catch {
    /* keep body = {} */
  }

  // Transaction create (sale/purchase/income/expense/credit-note/debit-note)
  if (url.includes('/api/transactions') && method === 'POST') {
    const type = body.type || 'transaction'
    const typeLabel: Record<string, string> = {
      sale: 'Sale',
      purchase: 'Purchase',
      income: 'Income entry',
      expense: 'Expense entry',
      'credit-note': 'Credit note',
      'debit-note': 'Debit note',
      estimate: 'Estimate',
    }
    const label = typeLabel[type] || 'Transaction'
    const amount = body.totalAmount ? `— ₹${Number(body.totalAmount).toLocaleString('en-IN')}` : ''
    const itemsCount = Array.isArray(body.items) ? `, ${body.items.length} item${body.items.length === 1 ? '' : 's'}` : ''
    const party = body.partyName ? `, ${body.partyName}` : ''
    return { label: `${label} ${amount}${itemsCount}${party}`, detail: `Created ${date}` }
  }

  // Transaction update
  if (url.match(/\/api\/transactions\/[^/]+$/) && method === 'PUT') {
    const type = body.type || 'transaction'
    const typeLabel: Record<string, string> = {
      sale: 'Sale',
      purchase: 'Purchase',
      income: 'Income entry',
      expense: 'Expense entry',
      'credit-note': 'Credit note',
      'debit-note': 'Debit note',
    }
    return { label: `${typeLabel[type] || 'Transaction'} edit`, detail: `Edited ${date}` }
  }

  // Transaction delete
  if (url.match(/\/api\/transactions\/[^/]+$/) && method === 'DELETE') {
    return { label: 'Transaction deletion', detail: `Deleted ${date}` }
  }

  // Payment
  if (url.includes('/api/payments') && method === 'POST') {
    const amount = body.amount ? `₹${Number(body.amount).toLocaleString('en-IN')}` : ''
    const type = body.type === 'received' ? 'Payment received' : 'Payment made'
    return { label: `${type} — ${amount}`, detail: `Created ${date}` }
  }

  // Party create/update
  if (url.includes('/api/parties')) {
    const name = body.name || 'Unknown party'
    const action = method === 'POST' ? 'Party created' : 'Party edit'
    return { label: `${action} — ${name}`, detail: `${date}` }
  }

  // Product create/update
  if (url.includes('/api/products')) {
    const name = body.name || 'Unknown product'
    const action = method === 'POST' ? 'Product created' : 'Product edit'
    return { label: `${action} — ${name}`, detail: `${date}` }
  }

  // Fallback: show raw method + URL
  return { label: `${method} ${url.split('/api/')[1] || url}`, detail: `${date}` }
}

export function UnsyncedEntries() {
  const [items, setItems] = useState<DeadLetterItem[]>([])
  const [loading, setLoading] = useState(true)
  const [retryingId, setRetryingId] = useState<number | null>(null)

  const refresh = useCallback(async () => {
    try {
      const list = await getDeadLetterItems()
      // Sort newest first.
      list.sort((a: any, b: any) => b.timestamp - a.timestamp)
      setItems(list as DeadLetterItem[])
    } catch (err) {
      console.error('[unsynced-entries] failed to load dead-letter items:', err)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    refresh()
  }, [refresh])

  const handleRetry = async (item: DeadLetterItem) => {
    if (!item.id) return
    setRetryingId(item.id)
    haptic.click()
    try {
      // Re-queue the write (preserves method/url/body/headers/invalidates).
      await queuePendingWrite({
        url: item.url,
        method: item.method,
        body: item.body,
        headers: item.headers,
        invalidates: item.invalidates || [],
      })
      // Remove from dead-letter (the queue now owns it).
      await deleteDeadLetterItem(item.id)
      sonnerToast.success('Re-queued for sync', {
        description: 'The entry is back in the offline queue. It will sync on the next online attempt.',
      })
      // Trigger an immediate sync attempt (if online).
      syncPendingWrites().catch(() => { /* non-fatal */ })
      await refresh()
    } catch (err) {
      console.error('[unsynced-entries] retry failed:', err)
      sonnerToast.error('Could not re-queue', {
        description: 'Browser storage may still be unavailable. Try again later or re-enter the data manually.',
      })
    } finally {
      setRetryingId(null)
    }
  }

  const handleDiscard = async (item: DeadLetterItem) => {
    if (!item.id) return
    haptic.warning()
    try {
      await deleteDeadLetterItem(item.id)
      sonnerToast.success('Entry discarded')
      await refresh()
    } catch (err) {
      console.error('[unsynced-entries] discard failed:', err)
      sonnerToast.error('Could not discard')
    }
  }

  const handleClearAll = async () => {
    if (items.length === 0) return
    haptic.warning()
    try {
      await clearDeadLetter()
      sonnerToast.success(`Cleared ${items.length} unsynced ${items.length === 1 ? 'entry' : 'entries'}`)
      await refresh()
    } catch (err) {
      console.error('[unsynced-entries] clear-all failed:', err)
      sonnerToast.error('Could not clear entries')
    }
  }

  if (loading) {
    return null  // don't render the card until we know if there are items
  }

  if (items.length === 0) {
    return null  // empty store → hide the card entirely (no noise on the Data tab)
  }

  return (
    <Card className="border-amber-200 dark:border-amber-900/40 bg-amber-50/50 dark:bg-amber-950/10">
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-start gap-2">
            <Inbox className="w-5 h-5 text-amber-600 dark:text-amber-400 flex-shrink-0 mt-0.5" />
            <div>
              <CardTitle className="text-sm flex items-center gap-2">
                Unsynced Entries
                <Badge variant="destructive" className="text-3xs px-1.5 py-0">
                  {items.length}
                </Badge>
              </CardTitle>
              <CardDescription className="text-xs mt-1">
                These entries could not be synced after multiple attempts. Review each one — retry to re-queue, or discard if no longer needed.
              </CardDescription>
            </div>
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={handleClearAll}
            className="text-xs text-muted-foreground hover:text-rose-600"
          >
            Clear all
          </Button>
        </div>
      </CardHeader>
      <CardContent className="pt-0 space-y-2 max-h-96 overflow-y-auto">
        {items.map((item) => {
          const desc = describeItem(item)
          return (
            <div
              key={item.id}
              className="flex items-start gap-3 p-3 rounded-lg bg-background border border-border/60"
            >
              <AlertCircle className="w-4 h-4 text-amber-600 dark:text-amber-400 flex-shrink-0 mt-0.5" />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium truncate">{desc.label}</p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  {desc.detail} · {item.reason.replace(/_/g, ' ')}
                </p>
              </div>
              <div className="flex items-center gap-1 flex-shrink-0">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => handleRetry(item)}
                  disabled={retryingId === item.id}
                  className="gap-1 text-xs h-7"
                >
                  <RefreshCw className={`w-3 h-3 ${retryingId === item.id ? 'animate-spin' : ''}`} />
                  Retry
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => handleDiscard(item)}
                  className="text-muted-foreground hover:text-rose-600 text-xs h-7 px-2"
                >
                  <Trash2 className="w-3 h-3" />
                </Button>
              </div>
            </div>
          )
        })}
      </CardContent>
    </Card>
  )
}
