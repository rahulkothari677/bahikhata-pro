'use client'

import { useQuery } from '@tanstack/react-query'
import { offlineFetch } from '@/lib/offline-fetch'
import { X, Info, CheckCircle, AlertTriangle, XCircle, ArrowRight } from 'lucide-react'
import { useState } from 'react'
import { cn } from '@/lib/utils'

/**
 * AnnouncementBanner — shows active announcements from admin.
 *
 * Displays at the top of the app (below header).
 * Users can dismiss individual announcements (stored in localStorage).
 * Admin creates announcements from the admin dashboard.
 */

export function AnnouncementBanner() {
  const [dismissed, setDismissed] = useState<string[]>([])

  // Load dismissed IDs from localStorage
  useState(() => {
    if (typeof window === 'undefined') return
    try {
      const stored = localStorage.getItem('bahikhata-dismissed-announcements')
      if (stored) setDismissed(JSON.parse(stored))
    } catch {}
  })

  const { data } = useQuery({
    queryKey: ['announcements'],
    queryFn: async () => {
      const r = await offlineFetch('/api/announcements')
      return r.json()
    },
    staleTime: 5 * 60 * 1000, // refresh every 5 min
  })

  const announcements = (data?.announcements || []).filter(
    (a: any) => !dismissed.includes(a.id),
  )

  if (announcements.length === 0) return null

  const handleDismiss = (id: string) => {
    const newDismissed = [...dismissed, id]
    setDismissed(newDismissed)
    try {
      localStorage.setItem('bahikhata-dismissed-announcements', JSON.stringify(newDismissed))
    } catch {}
  }

  return (
    <div className="space-y-2 px-4 lg:px-6 pt-3">
      {announcements.map((a: any) => {
        const config = getTypeConfig(a.type)
        const Icon = config.icon

        return (
          <div
            key={a.id}
            className={cn(
              'rounded-xl border p-3 flex items-start gap-3 shadow-sm',
              config.bg,
              config.border,
            )}
          >
            <Icon className={cn('w-5 h-5 flex-shrink-0 mt-0.5', config.iconColor)} />
            <div className="flex-1 min-w-0">
              <p className={cn('text-sm font-semibold', config.textColor)}>{a.title}</p>
              <p className={cn('text-xs mt-0.5', config.textColor, 'opacity-90')}>{a.message}</p>
              {a.link && (
                <a
                  href={a.link}
                  className="inline-flex items-center gap-1 text-xs font-medium mt-1 hover:underline"
                  style={{ color: config.linkColor }}
                >
                  Learn more <ArrowRight className="w-3 h-3" />
                </a>
              )}
            </div>
            <button
              onClick={() => handleDismiss(a.id)}
              className={cn('flex-shrink-0 p-1 rounded-lg hover:bg-black/10', config.textColor)}
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        )
      })}
    </div>
  )
}

function getTypeConfig(type: string) {
  switch (type) {
    case 'success':
      return {
        icon: CheckCircle,
        bg: 'bg-emerald-50 dark:bg-emerald-950/20',
        border: 'border-emerald-200 dark:border-emerald-900',
        textColor: 'text-emerald-700 dark:text-emerald-400',
        iconColor: 'text-emerald-600 dark:text-emerald-400',
        linkColor: '#059669',
      }
    case 'warning':
      return {
        icon: AlertTriangle,
        bg: 'bg-amber-50 dark:bg-amber-950/20',
        border: 'border-amber-200 dark:border-amber-900',
        textColor: 'text-amber-700 dark:text-amber-400',
        iconColor: 'text-amber-600 dark:text-amber-400',
        linkColor: '#d97706',
      }
    case 'error':
      return {
        icon: XCircle,
        bg: 'bg-rose-50 dark:bg-rose-950/20',
        border: 'border-rose-200 dark:border-rose-900',
        textColor: 'text-rose-700 dark:text-rose-400',
        iconColor: 'text-rose-600',
        linkColor: '#dc2626',
      }
    default:
      return {
        icon: Info,
        bg: 'bg-blue-50 dark:bg-blue-950/20',
        border: 'border-blue-200 dark:border-blue-900',
        textColor: 'text-blue-700 dark:text-blue-400',
        iconColor: 'text-blue-600',
        linkColor: '#2563eb',
      }
  }
}
