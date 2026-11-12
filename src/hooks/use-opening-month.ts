'use client'

import { useEffect, useState } from 'react'
import { useAppStore } from '@/store/app-store'

/**
 * 9b-4: the month a return screen opens on — the one the Due dates list asked
 * for (pendingReportMonth, used once), else this month as before.
 */
export function useOpeningMonth(): string {
  const pending = useAppStore((s) => s.pendingReportMonth)
  const clear = useAppStore((s) => s.setPendingReportMonth)
  const [opening] = useState(() => {
    if (pending && /^\d{4}-\d{2}$/.test(pending)) return pending
    const now = new Date()
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
  })
  useEffect(() => {
    // Read once on mount: a later change belongs to the next screen opened.
    if (pending) clear?.(null)
  }, [])
  return opening
}
