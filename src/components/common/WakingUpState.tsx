'use client'

/**
 * 🔒 FIX M11: Shared "waking up" loading state.
 *
 * Was: only the Dashboard showed "Waking up your shop..." during a cold DB
 * start. Ledger, Inventory, and Reports showed generic skeleton bars with
 * no message — the user assumed the app was broken.
 *
 * Now: all pages can use this component for a consistent loading experience.
 */

import { Skeleton } from '@/components/ui/skeleton'
import { Coffee } from 'lucide-react'

export function WakingUpState({ rows = 5 }: { rows?: number }) {
  return (
    <div className="space-y-3">
      {/* "Waking up" message — shown for ~3s during Neon cold start */}
      <div className="flex items-center gap-2 text-sm text-muted-foreground bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 rounded-lg px-3 py-2">
        <Coffee className="w-4 h-4 text-amber-600 dark:text-amber-400 flex-shrink-0 animate-pulse" />
        <span>Waking up your shop... this takes a few seconds on first load.</span>
      </div>
      {/* 🔒 V22-14 (Batch D, Phase 8c): Premium skeleton rows — avatar + text lines */}
      <div className="space-y-2">
        {[...Array(rows)].map((_, i) => (
          <div
            key={i}
            className="flex items-center gap-3 p-3 rounded-2xl border border-border/40 bg-card"
          >
            <Skeleton className="w-10 h-10 rounded-lg flex-shrink-0" />
            <div className="flex-1 space-y-2">
              <Skeleton className="h-3.5 w-1/3" />
              <Skeleton className="h-2.5 w-1/2" />
            </div>
            <Skeleton className="h-6 w-16 rounded-full flex-shrink-0" />
          </div>
        ))}
      </div>
    </div>
  )
}
