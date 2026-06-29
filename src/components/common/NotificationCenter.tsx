'use client'

/**
 * NotificationCenter — bell icon in header with dropdown showing alerts.
 *
 * Shows:
 * - Low stock alerts (products below threshold)
 * - Out of stock alerts
 * - Outstanding payments (dues from customers)
 * - Pending offline writes (if offline)
 *
 * Uses the dashboard data (already cached in React Query) — no extra API call.
 */

import { useState, useRef, useEffect } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Bell, AlertTriangle, IndianRupee, X, CheckCircle, Package, ArrowRight } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { cn, formatINR } from '@/lib/utils'
import { useAppStore } from '@/store/app-store'
import { offlineFetch, isOnline, getPendingWriteCount } from '@/lib/offline-fetch'
import { useStaffPermissions } from '@/hooks/use-staff-permissions'
import { haptic } from '@/lib/haptic'
import { motion, AnimatePresence } from 'framer-motion'

export function NotificationCenter() {
  const [open, setOpen] = useState(false)
  const [pendingWrites, setPendingWrites] = useState(0)
  const { setView, setPreviousView } = useAppStore()
  const { canAccess } = useStaffPermissions()
  const ref = useRef<HTMLDivElement>(null)

  // Fetch dashboard data (uses cached data — no extra API call if already loaded)
  const { data } = useQuery({
    queryKey: ['dashboard-notifications'],
    queryFn: async () => {
      const r = await offlineFetch('/api/dashboard?from=' + new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString() + '&to=' + new Date().toISOString())
      return r.json()
    },
    staleTime: 60 * 1000, // 1 min
  })

  // Check pending writes (offline)
  useEffect(() => {
    getPendingWriteCount().then(setPendingWrites)
    const interval = setInterval(() => {
      getPendingWriteCount().then(setPendingWrites)
    }, 5000)
    return () => clearInterval(interval)
  }, [])

  // Close on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  // Build notifications list
  const notifications: { id: string; type: 'warning' | 'error' | 'info'; icon: any; title: string; description: string; action?: () => void; actionLabel?: string }[] = []

  // Low stock alerts
  if (data?.kpis && canAccess('inventory')) {
    const lowStock = data.lowStockProducts || []
    lowStock.slice(0, 5).forEach((p: any) => {
      notifications.push({
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

  // Outstanding payments
  if (data?.kpis && canAccess('dashboard')) {
    const receivable = data.kpis.totalReceivable || 0
    if (receivable > 0) {
      notifications.push({
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

  // Pending offline writes
  if (!isOnline() && pendingWrites > 0) {
    notifications.push({
      id: 'pending-writes',
      type: 'warning',
      icon: AlertTriangle,
      title: `⚠️ ${pendingWrites} changes pending`,
      description: 'Will sync automatically when internet returns.',
    })
  }

  const count = notifications.length

  return (
    <div className="relative" ref={ref}>
      <Button
        size="iconTouch"
        variant="ghost"
        onClick={() => { haptic.click(); setOpen(!open) }}
        className="lg:size-9 lg:h-9 relative"
        title={`${count} notification${count === 1 ? '' : 's'}`}
        aria-label="Notifications"
      >
        <Bell className="w-5 h-5 lg:w-4 lg:h-4" />
        {count > 0 && (
          <span className="absolute -top-0.5 -right-0.5 min-w-4 h-4 px-1 rounded-full bg-rose-500 text-white text-[9px] font-bold flex items-center justify-center">
            {count > 9 ? '9+' : count}
          </span>
        )}
        {/* Pulse animation when there are new notifications */}
        {count > 0 && !open && (
          <span className="absolute -top-0.5 -right-0.5 min-w-4 h-4 px-1 rounded-full bg-rose-500 animate-ping opacity-75" />
        )}
      </Button>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: -8, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -8, scale: 0.96 }}
            transition={{ duration: 0.15 }}
            className="absolute top-full right-0 mt-2 w-80 max-w-[calc(100vw-2rem)] bg-popover border border-border/60 rounded-2xl shadow-card z-50 overflow-hidden"
          >
            {/* Header — gradient with count */}
            <div className="bg-gradient-to-r from-violet-500 to-purple-600 p-3 text-white flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="w-7 h-7 rounded-lg bg-white/20 backdrop-blur-sm flex items-center justify-center">
                  <Bell className="w-4 h-4" />
                </div>
                <div>
                  <p className="text-sm font-bold font-heading">Notifications</p>
                  <p className="text-[10px] text-white/80">
                    {count === 0 ? 'All caught up' : `${count} alert${count === 1 ? '' : 's'}`}
                  </p>
                </div>
              </div>
              <button
                onClick={() => { haptic.click(); setOpen(false) }}
                className="text-white/80 hover:text-white p-1 rounded-md hover:bg-white/10"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Notifications list */}
            <div className="max-h-96 overflow-y-auto">
              {notifications.length === 0 ? (
                <div className="p-8 text-center">
                  {/* Premium empty state */}
                  <div className="relative flex items-center justify-center mb-3">
                    <div className="absolute w-16 h-16 rounded-full bg-emerald-500/5" />
                    <div className="absolute w-12 h-12 rounded-full bg-emerald-500/10" />
                    <div className="relative w-9 h-9 rounded-xl bg-emerald-100 dark:bg-emerald-900/40 flex items-center justify-center">
                      <CheckCircle className="w-5 h-5 text-emerald-600" />
                    </div>
                  </div>
                  <p className="text-sm font-semibold font-heading">All caught up!</p>
                  <p className="text-xs text-muted-foreground mt-1">No alerts right now. Everything looks good.</p>
                </div>
              ) : (
                notifications.map((n, i) => {
                  const Icon = n.icon
                  return (
                    <motion.div
                      key={n.id}
                      initial={{ opacity: 0, x: -8 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ delay: i * 0.04 }}
                      className={cn(
                        'flex items-start gap-3 p-3 border-b border-border/40 last:border-0 hover:bg-muted/30 transition group',
                        n.type === 'error' && 'bg-rose-50/50 dark:bg-rose-950/20',
                        n.type === 'warning' && 'bg-amber-50/50 dark:bg-amber-950/20',
                      )}
                    >
                      <div className={cn(
                        'w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0',
                        n.type === 'error' && 'bg-rose-100 dark:bg-rose-900/40',
                        n.type === 'warning' && 'bg-amber-100 dark:bg-amber-900/40',
                        n.type === 'info' && 'bg-blue-100 dark:bg-blue-900/40',
                      )}>
                        <Icon className={cn(
                          'w-4 h-4',
                          n.type === 'error' && 'text-rose-600',
                          n.type === 'warning' && 'text-amber-600',
                          n.type === 'info' && 'text-blue-600',
                        )} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-semibold leading-tight">{n.title}</p>
                        <p className="text-xs text-muted-foreground mt-0.5">{n.description}</p>
                        {n.action && n.actionLabel && (
                          <button
                            onClick={() => {
                              haptic.click()
                              n.action!()
                              setOpen(false)
                            }}
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
                    </motion.div>
                  )
                })
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

