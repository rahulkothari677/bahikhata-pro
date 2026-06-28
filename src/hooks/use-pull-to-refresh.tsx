'use client'

/**
 * usePullToRefresh — touch-based pull-to-refresh for mobile.
 *
 * CRITICAL: Uses a NON-PASSIVE event listener for touchmove so we can call
 * preventDefault() to block the browser's native pull-to-refresh.
 * React's onTouchMove is passive by default, so preventDefault() is ignored.
 * That's why we must use window.addEventListener with { passive: false }.
 *
 * Works on touch devices only (desktop is unaffected).
 * - User must be scrolled to top (scrollTop <= 0)
 * - User pulls down at least `threshold` px (default 70)
 * - Spinner shows during pull, release triggers refresh
 * - Haptic feedback at threshold
 */

import { useState, useEffect, useCallback, useRef, type ReactNode } from 'react'
import { Loader2, RefreshCw, ArrowDown } from 'lucide-react'
import { haptic } from '@/lib/haptic'
import { cn } from '@/lib/utils'

const THRESHOLD = 70
const MAX_PULL = 120

type Options = {
  onRefresh: () => Promise<void> | void
  threshold?: number
  enabled?: boolean
}

export function usePullToRefresh({ onRefresh, threshold = THRESHOLD, enabled = true }: Options) {
  const [pullDistance, setPullDistance] = useState(0)
  const [isRefreshing, setIsRefreshing] = useState(false)
  const startYRef = useRef<number | null>(null)
  const triggeredRef = useRef(false)
  const isRefreshingRef = useRef(false)
  const enabledRef = useRef(enabled)
  const onRefreshRef = useRef(onRefresh)

  // Keep refs in sync with latest values
  useEffect(() => {
    enabledRef.current = enabled
  }, [enabled])

  useEffect(() => {
    onRefreshRef.current = onRefresh
  }, [onRefresh])

  // Attach NON-PASSIVE touch listeners to window so we can preventDefault()
  useEffect(() => {
    if (!enabled) return

    const handleTouchStart = (e: TouchEvent) => {
      if (!enabledRef.current || isRefreshingRef.current) return
      const scrollTop = window.scrollY || document.documentElement.scrollTop
      if (scrollTop > 0) return
      startYRef.current = e.touches[0].clientY
    }

    const handleTouchMove = (e: TouchEvent) => {
      if (!enabledRef.current || isRefreshingRef.current || startYRef.current === null) return
      const deltaY = e.touches[0].clientY - startYRef.current
      if (deltaY <= 0) {
        // User is scrolling UP — not a pull-to-refresh gesture.
        // Reset the start ref so we don't accidentally trigger preventDefault
        // if the user reverses direction.
        if (pullDistance !== 0) setPullDistance(0)
        triggeredRef.current = false
        startYRef.current = null
        return
      }
      // User is pulling DOWN at the top of the page.
      // CRITICAL: preventDefault() stops the browser's native pull-to-refresh.
      // This requires a non-passive listener.
      e.preventDefault()

      const dampened = Math.min(MAX_PULL, deltaY * 0.5)
      setPullDistance(dampened)
      if (dampened >= threshold && !triggeredRef.current) {
        triggeredRef.current = true
        haptic.medium()
      } else if (dampened < threshold) {
        triggeredRef.current = false
      }
    }

    const handleTouchEnd = async () => {
      if (!enabledRef.current || isRefreshingRef.current) {
        startYRef.current = null
        return
      }
      if (triggeredRef.current) {
        isRefreshingRef.current = true
        setIsRefreshing(true)
        setPullDistance(threshold)
        try {
          await onRefreshRef.current()
          haptic.success()
        } catch {
          haptic.error()
        } finally {
          isRefreshingRef.current = false
          setIsRefreshing(false)
          setPullDistance(0)
        }
      } else {
        setPullDistance(0)
      }
      startYRef.current = null
      triggeredRef.current = false
    }

    // touchstart and touchend can be passive (we don't preventDefault on them)
    window.addEventListener('touchstart', handleTouchStart, { passive: true })
    // touchmove MUST be non-passive so preventDefault() works
    window.addEventListener('touchmove', handleTouchMove, { passive: false })
    window.addEventListener('touchend', handleTouchEnd, { passive: true })
    window.addEventListener('touchcancel', handleTouchEnd, { passive: true })

    return () => {
      window.removeEventListener('touchstart', handleTouchStart)
      window.removeEventListener('touchmove', handleTouchMove)
      window.removeEventListener('touchend', handleTouchEnd)
      window.removeEventListener('touchcancel', handleTouchEnd)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, threshold])

  return {
    pullDistance,
    isRefreshing,
  }
}

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

export function PullToRefresh({
  children,
  onRefresh,
  enabled = true,
}: {
  children: ReactNode
  onRefresh: () => Promise<void> | void
  enabled?: boolean
}) {
  const { pullDistance, isRefreshing } = usePullToRefresh({ onRefresh, enabled })

  const isActive = pullDistance > 0 || isRefreshing

  if (!isActive) {
    return <div className="relative">{children}</div>
  }

  return (
    <div className={cn('relative', isRefreshing && 'overflow-hidden')}>
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
