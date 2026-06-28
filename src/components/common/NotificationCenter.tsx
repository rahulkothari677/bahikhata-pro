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
import { Bell, AlertTriangle, IndianRupee, X, CheckCircle, Package } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { cn, formatINR } from '@/lib/utils'
import { useAppStore } from '@/store/app-store'
import { offlineFetch, isOnline, getPendingWriteCount } from '@/lib/offline-fetch'
import { useStaffPermissions } from '@/hooks/use-staff-permissions'

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
        title: p.currentStock <= 0 ? `${p.name} is out of stock` : `${p.name} is running low`,
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
        title: `${formatINR(receivable)} receivable`,
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
      title: `${pendingWrites} changes pending`,
      description: 'Will sync automatically when internet returns.',
    })
  }

  const count = notifications.length

  if (count === 0 && isOnline()) {
    // No notifications — show bell with no badge
    return (
      <div className="relative" ref={ref}>
        <Button
          size="iconTouch"
          variant="ghost"
          onClick={() => setOpen(!open)}
          className="lg:size-9 lg:h-9"
          title="No notifications"
          aria-label="Notifications"
        >
          <Bell className="w-5 h-5 lg:w-4 lg:h-4" />
        </Button>
        {open && (
          <div className="absolute top-full right-0 mt-2 w-72 bg-popover border border-border rounded-xl shadow-lg z-50 p-4">
            <div className="flex items-center gap-2 text-emerald-600 mb-2">
              <CheckCircle className="w-5 h-5" />
              <p className="text-sm font-medium">All caught up!</p>
            </div>
            <p className="text-xs text-muted-foreground">No alerts right now. Everything looks good.</p>
          </div>
        )}
      </div>
    )
  }

  return (
    <div className="relative" ref={ref}>
      <Button
        size="iconTouch"
        variant="ghost"
        onClick={() => setOpen(!open)}
        className="lg:size-9 lg:h-9 relative"
        title={`${count} notification${count === 1 ? '' : 's'}`}
        aria-label="Notifications"
      >
        <Bell className="w-5 h-5 lg:w-4 lg:h-4" />
        {count > 0 && (
          <span className="absolute -top-0.5 -right-0.5 w-4 h-4 rounded-full bg-rose-500 text-white text-[9px] font-bold flex items-center justify-center">
            {count > 9 ? '9+' : count}
          </span>
        )}
      </Button>

      {open && (
        <div className="absolute top-full right-0 mt-2 w-80 max-w-[calc(100vw-2rem)] bg-popover border border-border rounded-xl shadow-lg z-50 overflow-hidden">
          {/* Header */}
          <div className="flex items-center justify-between p-3 border-b border-border">
            <p className="text-sm font-semibold">Notifications</p>
            <button
              onClick={() => setOpen(false)}
              className="p-1 rounded-md hover:bg-muted text-muted-foreground"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          {/* Notifications list */}
          <div className="max-h-96 overflow-y-auto">
            {notifications.length === 0 ? (
              <div className="p-6 text-center">
                <CheckCircle className="w-8 h-8 mx-auto text-emerald-500 mb-2" />
                <p className="text-sm font-medium">All caught up!</p>
                <p className="text-xs text-muted-foreground mt-1">No alerts right now.</p>
              </div>
            ) : (
              notifications.map((n) => {
                const Icon = n.icon
                return (
                  <div
                    key={n.id}
                    className={cn(
                      'flex items-start gap-3 p-3 border-b border-border/50 last:border-0 hover:bg-muted/30 transition',
                      n.type === 'error' && 'bg-rose-50/50 dark:bg-rose-950/20',
                      n.type === 'warning' && 'bg-amber-50/50 dark:bg-amber-950/20',
                    )}
                  >
                    <div className={cn(
                      'w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0',
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
                      <p className="text-sm font-medium leading-tight">{n.title}</p>
                      <p className="text-xs text-muted-foreground mt-0.5">{n.description}</p>
                      {n.action && n.actionLabel && (
                        <button
                          onClick={() => {
                            n.action!()
                            setOpen(false)
                          }}
                          className="text-xs text-primary font-medium mt-1.5 hover:underline"
                        >
                          {n.actionLabel} →
                        </button>
                      )}
                    </div>
                  </div>
                )
              })
            )}
          </div>
        </div>
      )}
    </div>
  )
}
