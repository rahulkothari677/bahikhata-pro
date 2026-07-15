'use client'

/**
 * 🔒 V22-12 (Batch B, Phase 8b) — EmptyState
 *
 * Reusable illustrated empty state with an icon, title, description, and
 * optional CTA buttons (primary + secondary). Replaces plain "No data" text
 * with a friendly, actionable prompt.
 *
 * Inspired by: Stripe's empty states, Linear's "No results" illustrations.
 *
 * Backward-compatible with the previous EmptyState which used `size="compact"`
 * and `secondaryAction`. The new `compact` boolean prop and `color` prop are
 * additions.
 *
 * Usage:
 * <EmptyState
 *   icon={ShoppingCart}
 *   title="No sales yet"
 *   description="Record your first sale to see it here."
 *   action={{ label: 'New Sale', onClick: () => setView('new-sale') }}
 *   secondaryAction={{ label: 'Scan Bill', onClick: () => setView('scanner') }}
 *   color="emerald"
 *   compact
 * />
 */

import { cn } from '@/lib/utils'
import { ArrowRight, type LucideIcon } from 'lucide-react'

interface EmptyStateProps {
  icon: LucideIcon
  title: string
  description?: string
  action?: {
    label: string
    onClick: () => void
  }
  secondaryAction?: {
    label: string
    onClick: () => void
  }
  color?: 'blue' | 'emerald' | 'amber' | 'rose' | 'violet' | 'slate'
  compact?: boolean
  size?: 'compact' | 'default'  // backward-compat: size="compact" = compact={true}
  className?: string
}

const colorMap = {
  blue: {
    bg: 'bg-blue-100 dark:bg-blue-950',
    text: 'text-blue-600 dark:text-blue-400',
    btn: 'bg-blue-600 hover:bg-blue-700 text-white',
  },
  emerald: {
    bg: 'bg-emerald-100 dark:bg-emerald-950',
    text: 'text-emerald-600 dark:text-emerald-400',
    btn: 'bg-emerald-600 hover:bg-emerald-700 text-white',
  },
  amber: {
    bg: 'bg-amber-100 dark:bg-amber-950',
    text: 'text-amber-600 dark:text-amber-400',
    btn: 'bg-amber-600 hover:bg-amber-700 text-white',
  },
  rose: {
    bg: 'bg-rose-100 dark:bg-rose-950',
    text: 'text-rose-600 dark:text-rose-400',
    btn: 'bg-rose-600 hover:bg-rose-700 text-white',
  },
  violet: {
    bg: 'bg-violet-100 dark:bg-violet-950',
    text: 'text-violet-600 dark:text-violet-400',
    btn: 'bg-violet-600 hover:bg-violet-700 text-white',
  },
  slate: {
    bg: 'bg-slate-100 dark:bg-slate-800',
    text: 'text-slate-600 dark:text-slate-400',
    btn: 'bg-slate-700 hover:bg-slate-800 text-white',
  },
}

export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  secondaryAction,
  color = 'slate',
  compact = false,
  size,
  className,
}: EmptyStateProps) {
  // 🔒 Backward-compat: size="compact" maps to compact=true
  const isCompact = compact || size === 'compact'
  const colors = colorMap[color]
  return (
    <div className={cn(
      'flex flex-col items-center text-center',
      isCompact ? 'py-6' : 'py-10',
      className,
    )}>
      <div className={cn(
        'rounded-2xl flex items-center justify-center mb-3',
        isCompact ? 'w-12 h-12' : 'w-16 h-16',
        colors.bg,
      )}>
        <Icon className={cn(isCompact ? 'w-6 h-6' : 'w-8 h-8', colors.text)} />
      </div>
      <p className={cn('font-semibold', isCompact ? 'text-sm' : 'text-base')}>{title}</p>
      {description && (
        <p className={cn(
          'text-muted-foreground mt-1 max-w-xs',
          isCompact ? 'text-[11px]' : 'text-xs',
        )}>
          {description}
        </p>
      )}
      {(action || secondaryAction) && (
        <div className="flex items-center gap-2 mt-4">
          {action && (
            <button
              onClick={action.onClick}
              className={cn(
                'inline-flex items-center gap-1.5 rounded-lg font-medium transition active:scale-95',
                isCompact ? 'px-3 py-1.5 text-xs' : 'px-4 py-2 text-sm',
                colors.btn,
              )}
            >
              {action.label}
              <ArrowRight className="w-3.5 h-3.5" />
            </button>
          )}
          {secondaryAction && (
            <button
              onClick={secondaryAction.onClick}
              className={cn(
                'inline-flex items-center rounded-lg font-medium transition active:scale-95 border border-border hover:bg-muted',
                isCompact ? 'px-3 py-1.5 text-xs' : 'px-4 py-2 text-sm',
              )}
            >
              {secondaryAction.label}
            </button>
          )}
        </div>
      )}
    </div>
  )
}
