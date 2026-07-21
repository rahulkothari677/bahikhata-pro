'use client'

/**
 * SupplierOpeningBalanceReview — founder-only data-repair UI.
 *
 * 🔒 V-2 data-repair (auditor spec Part B): lists every supplier with a
 * positive opening balance (the V-2 sign-error class). The shopkeeper
 * reviews each row and decides:
 *   - genuine advance → leave alone
 *   - sign error → tap "Flip sign" to negate the opening balance
 *
 * This component consumes /api/debug/supplier-opening-balance-review (GET to
 * list, POST to flip one). The endpoint is founder-only.
 *
 * The card renders on the Settings → Data tab, between UnsyncedEntries and
 * Danger Zone. It auto-hides for non-founders and when there are no suspects.
 */

import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Loader2, AlertTriangle, ArrowLeftRight, RefreshCw } from 'lucide-react'
import { toast as sonnerToast } from 'sonner'
import { offlineFetch } from '@/lib/offline-fetch'
import { formatINR } from '@/lib/utils'
import { useAppStore } from '@/store/app-store'
import { invalidateMoneyCaches } from '@/lib/invalidate-money-caches'

interface SuspectRow {
  id: string
  name: string
  phone: string | null
  type: string
  openingBalanceRupees: number
  purchaseTotalRupees: number
  purchasePaidRupees: number
  purchaseCount: number
  currentBalanceRupees: number
  recommendation: 'review' | 'genuine-advance'
  reason: string
  createdAt: string
}

interface ReviewResponse {
  suspectCount: number
  rows: SuspectRow[]
  instructions: string
}

export function SupplierOpeningBalanceReview() {
  const isFounder = useAppStore((s) => s.isFounder)
  const queryClient = useQueryClient()
  const [expanded, setExpanded] = useState(false)
  const [flippingId, setFlippingId] = useState<string | null>(null)

  const { data, isLoading, refetch, isFetching } = useQuery<ReviewResponse>({
    queryKey: ['supplier-opening-balance-review'],
    queryFn: async () => {
      const r = await offlineFetch('/api/debug/supplier-opening-balance-review')
      if (!r.ok) throw new Error('Failed to load review')
      return r.json()
    },
    enabled: isFounder && expanded,
    staleTime: 30_000, // 30s — money data, but a re-fetch is one click away
  })

  if (!isFounder) return null

  const suspects = data?.rows ?? []

  const handleFlip = async (row: SuspectRow) => {
    const ok = window.confirm(
      `Flip ${row.name}'s opening balance from ₹${row.openingBalanceRupees.toFixed(2)} (they owe you) to -₹${row.openingBalanceRupees.toFixed(2)} (you owe them)?\n\nThis is irreversible from the UI. Only do this if you actually owe this supplier ₹${row.openingBalanceRupees.toFixed(2)}.`
    )
    if (!ok) return
    setFlippingId(row.id)
    try {
      const r = await offlineFetch('/api/debug/supplier-opening-balance-review', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ partyId: row.id }),
      })
      const result = await r.json()
      if (!r.ok) throw new Error(result?.error || 'Flip failed')
      sonnerToast.success(`Flipped ${row.name}'s opening balance`, {
        description: `Now shows "you owe them" ₹${row.openingBalanceRupees.toFixed(2)}`,
      })
      // Refresh the review list + every money cache (party balance, parties list,
      // dashboard, etc.) so the change is visible everywhere immediately.
      await invalidateMoneyCaches(queryClient)
      await queryClient.invalidateQueries({ queryKey: ['supplier-opening-balance-review'] })
    } catch (e: any) {
      sonnerToast.error(e?.message || "Couldn't flip the opening balance")
    } finally {
      setFlippingId(null)
    }
  }

  return (
    <Card className="shadow-card border-amber-200 dark:border-amber-900/40 border-t-2 border-t-amber-400/40">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <AlertTriangle className="w-4 h-4 text-amber-600 dark:text-amber-400" />
          Supplier Opening Balance Review
          {suspects.length > 0 && (
            <Badge variant="outline" className="ml-1 text-amber-700 dark:text-amber-300 border-amber-300 dark:border-amber-700">
              {suspects.length} {suspects.length === 1 ? 'suspect' : 'suspects'}
            </Badge>
          )}
        </CardTitle>
        <CardDescription className="text-xs">
          Suppliers showing <span className="font-medium">“they owe you”</span> may have a sign error from before the V-2 fix.
          Review each row and flip the sign if you actually owe them.
        </CardDescription>
      </CardHeader>
      <CardContent className="pt-0">
        {!expanded ? (
          <Button
            variant="outline"
            size="sm"
            onClick={() => setExpanded(true)}
            className="gap-2"
          >
            <AlertTriangle className="w-4 h-4" />
            Check for sign errors
          </Button>
        ) : (
          <div className="space-y-3">
            <div className="flex items-center justify-between gap-2">
              <p className="text-2xs text-muted-foreground">
                {isLoading
                  ? 'Loading…'
                  : isFetching
                    ? 'Refreshing…'
                    : suspects.length === 0
                      ? 'No suspects — every supplier opening balance is correct.'
                      : `${suspects.length} ${suspects.length === 1 ? 'supplier needs' : 'suppliers need'} review.`}
              </p>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => refetch()}
                disabled={isLoading || isFetching}
                className="h-7 gap-1.5 text-2xs"
              >
                <RefreshCw className={`w-3 h-3 ${isFetching ? 'animate-spin' : ''}`} />
                Refresh
              </Button>
            </div>

            {isLoading && (
              <div className="flex items-center justify-center py-6">
                <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
              </div>
            )}

            {!isLoading && suspects.length > 0 && (
              <div className="space-y-2">
                {suspects.map((row) => (
                  <div
                    key={row.id}
                    className="rounded-lg border border-border/60 bg-card p-3 space-y-2"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex-1 min-w-0">
                        <p className="font-medium text-sm truncate">{row.name}</p>
                        <p className="text-2xs text-muted-foreground">
                          {row.phone ? row.phone : 'no phone'} · added{' '}
                          {new Date(row.createdAt).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}
                        </p>
                      </div>
                      <Badge
                        variant="outline"
                        className={
                          row.recommendation === 'review'
                            ? 'text-amber-700 dark:text-amber-300 border-amber-300 dark:border-amber-700'
                            : 'text-emerald-700 dark:text-emerald-300 border-emerald-300 dark:border-emerald-700'
                        }
                      >
                        {row.recommendation === 'review' ? 'Review' : 'Likely advance'}
                      </Badge>
                    </div>

                    <div className="grid grid-cols-3 gap-2 text-2xs">
                      <div>
                        <p className="text-muted-foreground">Opening</p>
                        <p className="font-medium text-emerald-600 dark:text-emerald-400 tabular-nums">
                          +{formatINR(row.openingBalanceRupees)}
                        </p>
                      </div>
                      <div>
                        <p className="text-muted-foreground">Purchases</p>
                        <p className="font-medium tabular-nums">
                          {row.purchaseCount === 0 ? '—' : formatINR(row.purchaseTotalRupees)}
                        </p>
                      </div>
                      <div>
                        <p className="text-muted-foreground">Current balance</p>
                        <p className="font-medium tabular-nums">
                          {formatINR(row.currentBalanceRupees)}
                        </p>
                      </div>
                    </div>

                    <p className="text-2xs text-muted-foreground italic">{row.reason}</p>

                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => handleFlip(row)}
                      disabled={flippingId === row.id}
                      className="w-full gap-2 h-8 text-2xs border-amber-300 dark:border-amber-700 text-amber-700 dark:text-amber-300 hover:bg-amber-50 dark:hover:bg-amber-950/30"
                    >
                      {flippingId === row.id ? (
                        <Loader2 className="w-3 h-3 animate-spin" />
                      ) : (
                        <ArrowLeftRight className="w-3 h-3" />
                      )}
                      Flip sign (mark as “I owe them”)
                    </Button>
                  </div>
                ))}
              </div>
            )}

            {!isLoading && suspects.length === 0 && (
              <div className="rounded-lg border border-emerald-200 dark:border-emerald-900/40 bg-emerald-50 dark:bg-emerald-950/20 p-3">
                <p className="text-xs text-emerald-700 dark:text-emerald-300">
                  Every supplier opening balance is either negative (correct: you owe them) or zero. No sign errors detected.
                </p>
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  )
}
