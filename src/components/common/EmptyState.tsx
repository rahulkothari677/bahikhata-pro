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
      <div
        className={cn(
          'rounded-2xl flex items-center justify-center bg-muted',
          isCompact ? 'w-12 h-12 mb-3' : 'w-20 h-20 mb-5',
        )}
      >
        <Icon className={cn('text-muted-foreground', isCompact ? 'w-6 h-6' : 'w-10 h-10')} />
      </div>
      <h3 className={cn('font-semibold text-foreground', isCompact ? 'text-sm' : 'text-lg')}>
        {title}
      </h3>
      {description && (
        <p className={cn(
          'text-muted-foreground mt-1 max-w-md',
          isCompact ? 'text-xs' : 'text-sm',
        )}>
          {description}
        </p>
      )}
      {(action || secondaryAction) && (
        <div className="flex gap-2 mt-4 flex-wrap justify-center">
          {action && (
            <Button onClick={action.onClick} size={isCompact ? 'sm' : 'default'} className="gap-2">
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
