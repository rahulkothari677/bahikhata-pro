'use client'

import { useQuery } from '@tanstack/react-query'
import { offlineFetch } from '@/lib/offline-fetch'
import { ArrowRight } from 'lucide-react'
import { Notice, type NoticeLevel } from '@/components/ui/notice'
import { useState } from 'react'

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
      {announcements.map((a: any) => (
        // Phase 4b: the one warning box. An announcement's type maps onto the
        // four levels so it reads like every other notice in the app.
        <Notice
          key={a.id}
          level={LEVEL_FOR_TYPE[a.type as string] ?? 'note'}
          title={a.title}
          onDismiss={() => handleDismiss(a.id)}
          action={a.link ? (
            <a href={a.link} className="inline-flex items-center gap-1 min-h-12 text-sm font-medium text-primary hover:underline">
              Learn more <ArrowRight className="w-4 h-4" aria-hidden />
            </a>
          ) : undefined}
        >
          {a.message}
        </Notice>
      ))}
    </div>
  )
}

const LEVEL_FOR_TYPE: Record<string, NoticeLevel> = {
  error: 'stop',
  warning: 'act',
  success: 'clear',
  info: 'note',
}
