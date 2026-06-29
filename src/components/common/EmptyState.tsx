'use client'

import { type LucideIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

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
  className?: string
  /** Size variant: 'default' for full-page empty states, 'compact' for inline (e.g. inside a card) */
  size?: 'default' | 'compact'
}

export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  secondaryAction,
  className,
  size = 'default',
}: EmptyStateProps) {
  const isCompact = size === 'compact'

  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center text-center',
        isCompact ? 'py-8 px-4' : 'py-16 px-4',
        className,
      )}
    >
      {/* Illustration container — gradient bg with decorative rings.
          The icon sits in the center of a layered composition:
          - Outer faint ring (largest, lowest opacity)
          - Middle ring (medium opacity)
          - Inner solid circle with the icon (gradient bg)
          This gives a sense of depth and "illustration" rather than
          just a flat icon in a box. */}
      <div className={cn('relative flex items-center justify-center', isCompact ? 'mb-3' : 'mb-6')}>
        {/* Outer ring — faint */}
        <div
          className={cn(
            'absolute rounded-full bg-primary/5',
            isCompact ? 'w-20 h-20' : 'w-32 h-32',
          )}
        />
        {/* Middle ring — slightly more visible */}
        <div
          className={cn(
            'absolute rounded-full bg-primary/10',
            isCompact ? 'w-16 h-16' : 'w-24 h-24',
          )}
        />
        {/* Inner circle with gradient + icon */}
        <div
          className={cn(
            'relative rounded-2xl flex items-center justify-center bg-gradient-to-br from-primary/15 to-primary/5 border border-primary/20',
            isCompact ? 'w-12 h-12' : 'w-20 h-20',
          )}
        >
          <Icon
            className={cn(
              'text-primary',
              isCompact ? 'w-6 h-6' : 'w-10 h-10',
            )}
            strokeWidth={1.5}
          />
        </div>
      </div>

      <h3
        className={cn(
          'font-semibold text-foreground font-heading tracking-tight',
          isCompact ? 'text-sm' : 'text-lg',
        )}
      >
        {title}
      </h3>
      {description && (
        <p
          className={cn(
            'text-muted-foreground mt-1.5 max-w-md leading-relaxed',
            isCompact ? 'text-xs' : 'text-sm',
          )}
        >
          {description}
        </p>
      )}
      {(action || secondaryAction) && (
        <div className="flex gap-2 mt-5 flex-wrap justify-center">
          {action && (
            <Button
              onClick={action.onClick}
              size={isCompact ? 'sm' : 'default'}
              className="gap-2 bg-gradient-saffron shadow-md"
            >
              {action.label}
            </Button>
          )}
          {secondaryAction && (
            <Button
              onClick={secondaryAction.onClick}
              variant="outline"
              size={isCompact ? 'sm' : 'default'}
            >
              {secondaryAction.label}
            </Button>
          )}
        </div>
      )}
    </div>
  )
}
