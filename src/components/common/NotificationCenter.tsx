'use client'

/**
 * NotificationCenter — bell icon in header with full-screen notification feed.
 *
 * Features:
 * - Full-screen sheet on mobile, side sheet on desktop (no pull-to-refresh conflict)
 * - Pulse on bell ONLY when there are unseen notifications (stops after opening)
 * - Read/unread separation: unread at top with dot, read below with divider
 * - Swipe-to-dismiss individual notifications
 * - "Clear All" button in header
 * - Persists seen/dismissed state in localStorage
 *
 * Shows:
 * - Low stock alerts (products below threshold)
 * - Out of stock alerts
 * - Outstanding payments (dues from customers)
 * - Pending offline writes (if offline)
 */

import { useState, useRef, useEffect, useCallback } from 'react'
import { Bell, AlertTriangle, IndianRupee, X, CheckCircle, Package, ArrowRight, Trash2, Inbox } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from '@/components/ui/sheet'
import { cn, formatINR } from '@/lib/utils'
import { useAppStore } from '@/store/app-store'
import { offlineFetch, isOnline, getPendingWriteCount } from '@/lib/offline-fetch'
import { useStaffPermissions } from '@/hooks/use-staff-permissions'
import { useDashboardThisMonth } from '@/hooks/use-dashboard'
import { haptic } from '@/lib/haptic'
import { motion, AnimatePresence } from 'framer-motion'

const SEEN_KEY = 'bahikhata-seen-notifications'
const DISMISSED_KEY = 'bahikhata-dismissed-notifications'

type NotificationType = 'warning' | 'error' | 'info'
interface AppNotification {
  id: string
  type: NotificationType
  icon: any
  title: string
  description: string
  action?: () => void
  actionLabel?: string
}

export function NotificationCenter() {
  const [open, setOpen] = useState(false)
  const [pendingWrites, setPendingWrites] = useState(0)
  const [seenIds, setSeenIds] = useState<Set<string>>(new Set())
  const [dismissedIds, setDismissedIds] = useState<Set<string>>(new Set())
  const { setView, setPreviousView } = useAppStore()
  const { canAccess } = useStaffPermissions()

  // 🔒 V22-12 (Batch B, Phase 5d): Read notification preferences from localStorage.
  // Defaults to all-enabled if not set or parse fails. Uses lazy useState
  // initializer (reads once on mount, no useEffect needed).
  const defaultNotifPrefs = { lowStock: true, receivable: true, pendingSync: true, announcements: true }
  const [notifPrefs, setNotifPrefs] = useState(() => {
    if (typeof window === 'undefined') return defaultNotifPrefs
    try {
      const stored = localStorage.getItem('bahikhata:notif-prefs')
      if (stored) return { ...defaultNotifPrefs, ...JSON.parse(stored) }
    } catch {}
    return defaultNotifPrefs
  })

  // Load seen/dismissed from localStorage on mount
  useEffect(() => {
    try {
      const seen = localStorage.getItem(SEEN_KEY)
      if (seen) setSeenIds(new Set(JSON.parse(seen)))
      const dismissed = localStorage.getItem(DISMISSED_KEY)
      if (dismissed) setDismissedIds(new Set(JSON.parse(dismissed)))
    } catch {}
  }, [])

  // 🔒 PERFORMANCE FIX (auditor P0): Use shared dashboard hook.
  // Was: separate useQuery → extra API call. Now: shared cache → zero extra calls.
  const { data } = useDashboardThisMonth()

  // Check pending writes (offline)
  useEffect(() => {
    getPendingWriteCount().then(setPendingWrites)
    const interval = setInterval(() => {
      getPendingWriteCount().then(setPendingWrites)
    }, 5000)
    return () => clearInterval(interval)
  }, [])

  // Build notifications list
  const allNotifications: AppNotification[] = []

  // 🔒 V22-12 (Batch B, Phase 5d): Respect notification preferences — only
  // add notifications for types the user has enabled.
  if (notifPrefs.lowStock && data?.kpis && canAccess('inventory')) {
    const lowStock = data.lowStockProducts || []
    lowStock.slice(0, 5).forEach((p: any) => {
      allNotifications.push({
        id: `stock-${p.id}`,
        type: p.currentStock <= 0 ? 'error' : 'warning',
        icon: Package,
        title: p.currentStock <= 0 ? `📦 ${p.name} is out of stock` : `📦 ${p.name} is running low`,
        description: `Stock: ${p.currentStock} ${p.unit} · ${p.category || 'Uncategorized'}`,
        action: () => { setPreviousView('dashboard'); setView('inventory') },
        actionLabel: 'Restock',
      })
    })
  }

  if (notifPrefs.receivable && data?.kpis && canAccess('dashboard')) {
    const receivable = data.kpis.totalReceivable || 0
    if (receivable > 0) {
      allNotifications.push({
        id: 'receivable',
        type: 'info',
        icon: IndianRupee,
        title: `💰 ${formatINR(receivable)} receivable`,
        description: 'Customers owe you money. Send payment reminders.',
        action: () => { setPreviousView('dashboard'); setView('parties') },
        actionLabel: 'View parties',
      })
    }
  }

  if (notifPrefs.pendingSync && !isOnline() && pendingWrites > 0) {
    allNotifications.push({
      id: 'pending-writes',
      type: 'warning',
      icon: AlertTriangle,
      title: `⚠️ ${pendingWrites} changes pending`,
      description: 'Will sync automatically when internet returns.',
    })
  }

  // Filter out dismissed notifications
  const visibleNotifications = allNotifications.filter(n => !dismissedIds.has(n.id))

  // Split into unread (not in seenIds) and read (in seenIds)
  const unread = visibleNotifications.filter(n => !seenIds.has(n.id))
  const read = visibleNotifications.filter(n => seenIds.has(n.id))

  const totalCount = visibleNotifications.length
  const unseenCount = unread.length

  // Pulse only when there are UNSEEN notifications and sheet is closed
  const shouldPulse = unseenCount > 0 && !open

  // Mark all visible notifications as seen when sheet opens
  useEffect(() => {
    if (open && visibleNotifications.length > 0) {
      // Small delay so the user sees the unread state briefly before it transitions
      const timer = setTimeout(() => {
        const newSeen = new Set(seenIds)
        visibleNotifications.forEach(n => newSeen.add(n.id))
        setSeenIds(newSeen)
        try {
          localStorage.setItem(SEEN_KEY, JSON.stringify([...newSeen]))
        } catch {}
      }, 1500) // 1.5s delay — user sees unread state, then they're marked read
      return () => clearTimeout(timer)
    }
  }, [open])

  const dismissNotification = useCallback((id: string) => {
    haptic.medium()
    const newDismissed = new Set(dismissedIds)
    newDismissed.add(id)
    setDismissedIds(newDismissed)
    try {
      localStorage.setItem(DISMISSED_KEY, JSON.stringify([...newDismissed]))
    } catch {}
  }, [dismissedIds])

  const clearAll = useCallback(() => {
    if (visibleNotifications.length === 0) return
    haptic.success()
    const newDismissed = new Set(dismissedIds)
    visibleNotifications.forEach(n => newDismissed.add(n.id))
    setDismissedIds(newDismissed)
    try {
      localStorage.setItem(DISMISSED_KEY, JSON.stringify([...newDismissed]))
    } catch {}
  }, [dismissedIds, visibleNotifications])

  return (
    <>
      <Button
        size="iconTouch"
        variant="ghost"
        onClick={() => { haptic.click(); setOpen(true) }}
        className="lg:size-9 lg:h-9 relative"
        title={`${totalCount} notification${totalCount === 1 ? '' : 's'}`}
        aria-label="Notifications"
      >
        <Bell className="w-5 h-5 lg:w-4 lg:h-4" />
        {totalCount > 0 && (
          <span className="absolute -top-0.5 -right-0.5 min-w-4 h-4 px-1 rounded-full bg-rose-500 text-white text-[9px] font-bold flex items-center justify-center z-10">
            {totalCount > 9 ? '9+' : totalCount}
          </span>
        )}
        {/* Pulse animation — ONLY when there are unseen notifications and sheet is closed */}
        {shouldPulse && (
          <span className="absolute -top-0.5 -right-0.5 min-w-4 h-4 px-1 rounded-full bg-rose-500 animate-ping opacity-75" />
        )}
      </Button>

      <Sheet open={open} onOpenChange={(o) => { if (!o) haptic.click(); setOpen(o) }}>
        <SheetContent
          side="right"
          className="
            p-0 gap-0 w-full sm:max-w-md
            flex flex-col h-full
          "
        >
          {/* Header — gradient with count + clear all */}
          <div className="bg-gradient-to-r from-violet-500 to-purple-600 p-4 text-white flex items-center justify-between flex-shrink-0">
            <div className="flex items-center gap-2.5">
              <div className="w-9 h-9 rounded-xl bg-white/20 backdrop-blur-sm flex items-center justify-center">
                <Bell className="w-5 h-5" />
              </div>
              <div>
                <SheetTitle className="text-base font-bold font-heading tracking-tight text-white">
                  Notifications
                </SheetTitle>
                <SheetDescription className="text-[11px] text-white/80">
                  {totalCount === 0
                    ? 'All caught up'
                    : unseenCount > 0
                      ? `${unseenCount} new · ${totalCount} total`
                      : `${totalCount} total`}
                </SheetDescription>
              </div>
            </div>
            <div className="flex items-center gap-1">
              {totalCount > 0 && (
                <button
                  onClick={clearAll}
                  className="text-white/80 hover:text-white text-xs font-medium bg-white/10 hover:bg-white/20 rounded-full px-3 py-1.5 transition flex items-center gap-1"
                >
                  <Trash2 className="w-3 h-3" />
                  Clear All
                </button>
              )}
              <button
                onClick={() => { haptic.click(); setOpen(false) }}
                className="text-white/80 hover:text-white p-1.5 rounded-md hover:bg-white/10"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
          </div>

          {/* Notification feed — scrollable */}
          <div className="flex-1 overflow-y-auto">
            {visibleNotifications.length === 0 ? (
              /* Premium empty state */
              <div className="flex flex-col items-center justify-center h-full px-6 text-center">
                <div className="relative flex items-center justify-center mb-4">
                  <div className="absolute w-20 h-20 rounded-full bg-emerald-500/5" />
                  <div className="absolute w-16 h-16 rounded-full bg-emerald-500/10" />
                  <div className="relative w-14 h-14 rounded-2xl bg-emerald-100 dark:bg-emerald-900/40 flex items-center justify-center">
                    <CheckCircle className="w-7 h-7 text-emerald-600 dark:text-emerald-400" strokeWidth={1.5} />
                  </div>
                </div>
                <p className="text-base font-semibold font-heading">All caught up!</p>
                <p className="text-sm text-muted-foreground mt-1 max-w-xs">
                  No alerts right now. We'll let you know when something needs your attention.
                </p>
              </div>
            ) : (
              <div className="p-3 space-y-1">
                {/* Unread section */}
                {unread.length > 0 && (
                  <>
                    <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground px-2 py-1">
                      New ({unread.length})
                    </p>
                    {unread.map((n, i) => (
                      <SwipeableNotification
                        key={n.id}
                        notification={n}
                        isUnread={true}
                        index={i}
                        onDismiss={() => dismissNotification(n.id)}
                        onAction={() => { setOpen(false); n.action?.() }}
                      />
                    ))}
                  </>
                )}

                {/* Read section */}
                {read.length > 0 && (
                  <>
                    {unread.length > 0 && (
                      <div className="flex items-center gap-2 px-2 py-3">
                        <div className="flex-1 h-px bg-border" />
                        <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Earlier</span>
                        <div className="flex-1 h-px bg-border" />
                      </div>
                    )}
                    {read.map((n, i) => (
                      <SwipeableNotification
                        key={n.id}
                        notification={n}
                        isUnread={false}
                        index={i}
                        onDismiss={() => dismissNotification(n.id)}
                        onAction={() => { setOpen(false); n.action?.() }}
                      />
                    ))}
                  </>
                )}
              </div>
            )}
          </div>
        </SheetContent>
      </Sheet>
    </>
  )
}

/**
 * SwipeableNotification — single notification row with swipe-to-dismiss.
 * Swipe left to reveal a delete button, or swipe far enough to auto-dismiss.
 */
function SwipeableNotification({
  notification: n,
  isUnread,
  index,
  onDismiss,
  onAction,
}: {
  notification: AppNotification
  isUnread: boolean
  index: number
  onDismiss: () => void
  onAction: () => void
}) {
  const Icon = n.icon
  const [swipeX, setSwipeX] = useState(0)
  const [startX, setStartX] = useState<number | null>(null)
  const [showDelete, setShowDelete] = useState(false)

  const handleTouchStart = (e: React.TouchEvent) => {
    setStartX(e.touches[0].clientX)
  }

  const handleTouchMove = (e: React.TouchEvent) => {
    if (startX === null) return
    const deltaX = e.touches[0].clientX - startX
    // Only allow swiping left (negative deltaX)
    if (deltaX < 0) {
      setSwipeX(Math.max(-120, deltaX))
    }
  }

  const handleTouchEnd = () => {
    if (swipeX < -80) {
      // Swiped far enough — auto-dismiss
      haptic.medium()
      onDismiss()
    } else if (swipeX < -40) {
      // Show delete button
      setShowDelete(true)
      setSwipeX(-60)
    } else {
      // Snap back
      setSwipeX(0)
      setShowDelete(false)
    }
    setStartX(null)
  }

  return (
    <motion.div
      initial={{ opacity: 0, x: -8 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ delay: index * 0.04 }}
      className="relative overflow-hidden rounded-xl"
    >
      {/* Delete button behind the row (revealed on swipe) */}
      <div className="absolute inset-0 flex items-center justify-end bg-rose-500 rounded-xl">
        <button
          onClick={() => { haptic.medium(); onDismiss() }}
          className="h-full px-5 flex items-center text-white"
        >
          <Trash2 className="w-4 h-4" />
        </button>
      </div>

      {/* Notification row — slides left to reveal delete */}
      <div
        className={cn(
          'relative flex items-start gap-3 p-3 rounded-xl border transition-colors',
          isUnread ? 'bg-card border-border/60' : 'bg-card/50 border-border/40',
          n.type === 'error' && !showDelete && 'bg-rose-50/50 dark:bg-rose-950/20',
          n.type === 'warning' && !showDelete && 'bg-amber-50/50 dark:bg-amber-950/20',
        )}
        style={{
          transform: `translateX(${swipeX}px)`,
          transition: startX === null ? 'transform 0.2s ease-out' : 'none',
        }}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
      >
        {/* Unread indicator dot */}
        {isUnread && (
          <div className="absolute top-3 left-1 w-2 h-2 rounded-full bg-violet-500 flex-shrink-0" />
        )}

        <div className={cn(
          'w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0',
          isUnread ? 'ml-2' : 'ml-0',
          n.type === 'error' && 'bg-rose-100 dark:bg-rose-900/40',
          n.type === 'warning' && 'bg-amber-100 dark:bg-amber-900/40',
          n.type === 'info' && 'bg-blue-100 dark:bg-blue-900/40',
        )}>
          <Icon className={cn(
            'w-4 h-4',
            n.type === 'error' && 'text-rose-600',
            n.type === 'warning' && 'text-amber-600 dark:text-amber-400',
            n.type === 'info' && 'text-blue-600',
          )} />
        </div>

        <div className="flex-1 min-w-0">
          <p className={cn('text-sm leading-tight', isUnread ? 'font-semibold' : 'font-medium text-muted-foreground')}>
            {n.title}
          </p>
          <p className="text-xs text-muted-foreground mt-0.5">{n.description}</p>
          {n.action && n.actionLabel && (
            <button
              onClick={(e) => { e.stopPropagation(); haptic.click(); onAction() }}
              className={cn(
                'text-[11px] font-semibold mt-1.5 flex items-center gap-1 rounded-full px-2.5 py-1 transition',
                n.type === 'error' && 'bg-rose-100 dark:bg-rose-900/40 text-rose-700 dark:text-rose-300 hover:bg-rose-200 dark:hover:bg-rose-900/60',
                n.type === 'warning' && 'bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300 hover:bg-amber-200 dark:hover:bg-amber-900/60',
                n.type === 'info' && 'bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300 hover:bg-blue-200 dark:hover:bg-blue-900/60',
              )}
            >
              {n.actionLabel}
              <ArrowRight className="w-3 h-3" />
            </button>
          )}
        </div>
      </div>
    </motion.div>
  )
}
