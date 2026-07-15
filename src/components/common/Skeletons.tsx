'use client'

/**
 * 🔒 V22-14 (Batch D, Phase 8c) — Reusable skeleton components
 *
 * Premium skeleton loading states that match the actual content layout.
 * Better than plain rectangles — shows the shape of what's coming.
 *
 * Components:
 * - ListItemSkeleton: avatar + 2 text lines (for parties, inventory, ledger)
 * - CardGridSkeleton: grid of card skeletons (for reports, dashboard)
 * - TableSkeleton: table row skeletons (for reports with tables)
 * - StatCardSkeleton: KPI card skeleton
 */

import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'

// Avatar + 2 text lines — matches the party/inventory list item layout
export function ListItemSkeleton({ count = 5 }: { count?: number }) {
  return (
    <div className="space-y-2">
      {[...Array(count)].map((_, i) => (
        <div
          key={i}
          className="flex items-center gap-3 p-3 rounded-xl border border-border/40 bg-card"
        >
          {/* Avatar circle */}
          <Skeleton className="w-10 h-10 rounded-full flex-shrink-0" />
          {/* Text lines */}
          <div className="flex-1 space-y-2">
            <Skeleton className="h-3.5 w-1/3" />
            <Skeleton className="h-2.5 w-1/2" />
          </div>
          {/* Right badge */}
          <Skeleton className="h-6 w-16 rounded-full flex-shrink-0" />
        </div>
      ))}
    </div>
  )
}

// Grid of card skeletons — for reports, dashboard widgets
export function CardGridSkeleton({
  count = 4,
  className,
}: {
  count?: number
  className?: string
}) {
  return (
    <div className={cn('grid grid-cols-2 lg:grid-cols-4 gap-3', className)}>
      {[...Array(count)].map((_, i) => (
        <div key={i} className="rounded-2xl border border-border/40 bg-card p-4 space-y-3">
          <Skeleton className="w-10 h-10 rounded-lg" />
          <Skeleton className="h-2.5 w-20" />
          <Skeleton className="h-5 w-24" />
        </div>
      ))}
    </div>
  )
}

// Table row skeletons — for reports with tables
export function TableSkeleton({ rows = 6, cols = 4 }: { rows?: number; cols?: number }) {
  return (
    <div className="space-y-2">
      {/* Header */}
      <div className="flex gap-2 pb-2 border-b border-border/40">
        {[...Array(cols)].map((_, i) => (
          <Skeleton key={i} className={cn('h-3', i === 0 ? 'flex-1' : 'w-20')} />
        ))}
      </div>
      {/* Rows */}
      {[...Array(rows)].map((_, i) => (
        <div key={i} className="flex gap-2 py-2">
          {[...Array(cols)].map((_, j) => (
            <Skeleton key={j} className={cn('h-3', j === 0 ? 'flex-1' : 'w-20')} />
          ))}
        </div>
      ))}
    </div>
  )
}

// KPI stat card skeleton — for dashboard KPIs
export function StatCardSkeleton({ count = 4 }: { count?: number }) {
  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 lg:gap-4">
      {[...Array(count)].map((_, i) => (
        <div key={i} className="rounded-2xl border border-border/40 bg-card p-4 space-y-3">
          <div className="flex items-center gap-2">
            <Skeleton className="w-9 h-9 rounded-lg" />
            <Skeleton className="h-2.5 w-16" />
          </div>
          <Skeleton className="h-6 w-24" />
          <Skeleton className="h-2 w-20" />
        </div>
      ))}
    </div>
  )
}
