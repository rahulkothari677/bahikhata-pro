'use client'

/**
 * usePullToRefresh — touch-based pull-to-refresh for mobile.
 *
 * Works on touch devices only (desktop is unaffected).
 * - User must be scrolled to top (scrollTop <= 0)
 * - User pulls down at least `threshold` px (default 70)
 * - Spinner shows during pull, release triggers refresh
 * - Haptic feedback at threshold
 *
 * Usage:
 *   const { pullDistance, isRefreshing } = usePullToRefresh({
 *     onRefresh: async () => { await refetch() }
 *   })
 *
 *   return (
 *     <div {...pullToRefreshHandlers} style={{ transform: `translateY(${pullDistance}px)` }}>
 *       <PullToRefreshIndicator pullDistance={pullDistance} isRefreshing={isRefreshing} />
 *       {content}
 *     </div>
 *   )
 *
 * Or wrap content in <PullToRefresh onRefresh={...}>...</PullToRefresh>
 */

import { useState, useEffect, useRef, useCallback, type ReactNode } from 'react'
import { Loader2, RefreshCw, ArrowDown } from 'lucide-react'
import { haptic } from '@/lib/haptic'
import { cn } from '@/lib/utils'

const THRESHOLD = 70
const MAX_PULL = 120

type Options = {
  onRefresh: () => Promise<void> | void
  threshold?: number
  // When false, pull-to-refresh is disabled (e.g., on detail pages)
  enabled?: boolean
}

export function usePullToRefresh({ onRefresh, threshold = THRESHOLD, enabled = true }: Options) {
  const [pullDistance, setPullDistance] = useState(0)
  const [isRefreshing, setIsRefreshing] = useState(false)
  const startYRef = useRef<number | null>(null)
  const triggeredRef = useRef(false)

  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    if (!enabled || isRefreshing) return
    // Only track if user is at top of scroll
    const scrollTop = window.scrollY || document.documentElement.scrollTop
    if (scrollTop > 0) return
    startYRef.current = e.touches[0].clientY
  }, [enabled, isRefreshing])

  const handleTouchMove = useCallback((e: React.TouchEvent) => {
    if (!enabled || isRefreshing || startYRef.current === null) return
    const deltaY = e.touches[0].clientY - startYRef.current
    if (deltaY <= 0) {
      setPullDistance(0)
      triggeredRef.current = false
      return
    }
    // Dampen the pull (resistance)
    const dampened = Math.min(MAX_PULL, deltaY * 0.5)
    setPullDistance(dampened)
    if (dampened >= threshold && !triggeredRef.current) {
      triggeredRef.current = true
      haptic.medium()
    } else if (dampened < threshold) {
      triggeredRef.current = false
    }
  }, [enabled, isRefreshing, threshold])

  const handleTouchEnd = useCallback(async () => {
    if (!enabled || isRefreshing) return
    if (triggeredRef.current) {
      setIsRefreshing(true)
      setPullDistance(threshold) // hold at threshold while refreshing
      try {
        await onRefresh()
        haptic.success()
      } catch {
        haptic.error()
      } finally {
        setIsRefreshing(false)
        setPullDistance(0)
      }
    } else {
      setPullDistance(0)
    }
    startYRef.current = null
    triggeredRef.current = false
  }, [enabled, isRefreshing, onRefresh, threshold])

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      startYRef.current = null
    }
  }, [])

  return {
    pullDistance,
    isRefreshing,
    handlers: {
      onTouchStart: handleTouchStart,
      onTouchMove: handleTouchMove,
      onTouchEnd: handleTouchEnd,
    },
  }
}

/**
 * Pull-to-refresh spinner indicator. Place at the top of the scroll container.
 */
export function PullToRefreshIndicator({
  pullDistance,
  isRefreshing,
  threshold = THRESHOLD,
}: {
  pullDistance: number
  isRefreshing: boolean
  threshold?: number
}) {
  if (pullDistance === 0 && !isRefreshing) return null

  const progress = Math.min(1, pullDistance / threshold)
  const ready = pullDistance >= threshold || isRefreshing

  return (
    <div
      className="flex items-center justify-center transition-opacity lg:hidden"
      style={{
        height: isRefreshing ? threshold : pullDistance,
        opacity: isRefreshing ? 1 : progress,
      }}
    >
      {isRefreshing ? (
        <Loader2 className="w-5 h-5 animate-spin text-primary" />
      ) : ready ? (
        <RefreshCw className="w-5 h-5 text-primary" style={{ transform: `rotate(${progress * 360}deg)` }} />
      ) : (
        <ArrowDown
          className="w-5 h-5 text-muted-foreground"
          style={{ transform: `rotate(${progress * 180}deg)` }}
        />
      )}
    </div>
  )
}

/**
 * Convenience wrapper component. Wrap scrollable content to enable pull-to-refresh.
 *
 * <PullToRefresh onRefresh={async () => { await refetch() }}>
 *   <Dashboard />
 * </PullToRefresh>
 */
export function PullToRefresh({
  children,
  onRefresh,
  enabled = true,
}: {
  children: ReactNode
  onRefresh: () => Promise<void> | void
  enabled?: boolean
}) {
  const { pullDistance, isRefreshing, handlers } = usePullToRefresh({ onRefresh, enabled })

  // When there's no pull activity and not refreshing, render a simple div
  // with the touch handlers attached but no transforms (zero layout impact).
  const isActive = pullDistance > 0 || isRefreshing

  if (!isActive) {
    return (
      <div {...handlers} className="relative">
        {children}
      </div>
    )
  }

  return (
    <div {...handlers} className={cn('relative', isRefreshing && 'overflow-hidden')}>
      <div
        className="absolute top-0 left-0 right-0 z-10 pointer-events-none"
        style={{ transform: `translateY(${isRefreshing ? 0 : -THRESHOLD + pullDistance}px)` }}
      >
        <PullToRefreshIndicator pullDistance={pullDistance} isRefreshing={isRefreshing} threshold={THRESHOLD} />
      </div>
      <div
        style={{
          transform: `translateY(${isRefreshing ? THRESHOLD : pullDistance}px)`,
          transition: isRefreshing ? 'transform 0.2s ease-out' : 'none',
        }}
      >
        {children}
      </div>
    </div>
  )
}
