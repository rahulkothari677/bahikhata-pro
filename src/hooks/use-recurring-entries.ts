'use client'

/**
 * useRecurringEntries — manage recurring expense/income templates.
 *
 * Stores templates in localStorage. On each app load (dashboard mount),
 * checks if any recurring entries are due for the current month and
 * creates them automatically via the transactions API.
 *
 * Template shape:
 *   { id, type: 'expense'|'income', category, amount, paymentMode,
 *     notes, dayOfMonth, lastRunMonth, createdAt }
 *
 * 'dayOfMonth': which day of the month to create the entry (1-28)
 * 'lastRunMonth': 'YYYY-MM' of the last time this entry was created
 */

import { useState, useEffect, useCallback } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { offlineFetch } from '@/lib/offline-fetch'
import { toast as sonnerToast } from 'sonner'
import { invalidateMoneyCaches } from '@/lib/invalidate-money-caches'

const KEY = 'bahikhata:recurring-entries:v1'

export interface RecurringEntry {
  id: string
  type: 'expense' | 'income'
  category: string
  amount: number
  paymentMode: string
  notes?: string
  dayOfMonth: number // 1-28
  lastRunMonth?: string // 'YYYY-MM'
  createdAt: number
}

function read(): RecurringEntry[] {
  if (typeof window === 'undefined') return []
  try {
    const raw = localStorage.getItem(KEY)
    return raw ? JSON.parse(raw) : []
  } catch {
    return []
  }
}

function write(entries: RecurringEntry[]) {
  if (typeof window === 'undefined') return
  try {
    localStorage.setItem(KEY, JSON.stringify(entries))
  } catch {
    // silent
  }
}

function getCurrentMonth(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

function isDue(entry: RecurringEntry): boolean {
  const now = new Date()
  const currentMonth = getCurrentMonth()
  // Already ran this month?
  if (entry.lastRunMonth === currentMonth) return false
  // Is it past the day of month?
  return now.getDate() >= entry.dayOfMonth
}

export function useRecurringEntries() {
  const [entries, setEntries] = useState<RecurringEntry[]>([])
  const queryClient = useQueryClient()

  useEffect(() => {
    setEntries(read())
  }, [])

  // Check for due entries and create them automatically
  const checkAndCreate = useCallback(async () => {
    const all = read()
    const due = all.filter(isDue)
    if (due.length === 0) return

    const currentMonth = getCurrentMonth()
    let created = 0
    let totalAmount = 0

    for (const entry of due) {
      try {
        const r = await offlineFetch('/api/transactions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            type: entry.type,
            category: entry.category,
            totalAmount: entry.amount,
            paidAmount: entry.amount,
            paymentMode: entry.paymentMode,
            notes: entry.notes || `Recurring: ${entry.category}`,
            date: new Date().toISOString().slice(0, 10),
          }),
          offline: { invalidate: ['/api/transactions', '/api/dashboard', '/api/parties'] },
        })
        if (r.ok) {
          created++
          totalAmount += entry.amount
          // Update lastRunMonth
          const updated = read().map(e =>
            e.id === entry.id ? { ...e, lastRunMonth: currentMonth } : e
          )
          write(updated)
          setEntries(updated)
        }
      } catch {
        // Failed — will retry next load
      }
    }

    if (created > 0) {
      // 🔒 R9-8: Recurring entries post real money (rent, salary) — refresh
      // every money cache so the dashboard, parties list, and party profiles
      // update immediately. Was: only /api/transactions + /api/dashboard were
      // in the URL cache invalidation list, and NO queryClient.invalidateQueries
      // was called → money appeared in the ledger with no signal for 2 minutes.
      await invalidateMoneyCaches(queryClient)
      // 🔒 R9-8 spec: Toast should include the ₹X total so the user knows what
      // was posted. Was: "N recurring entries created automatically" (no amount).
      const formattedTotal = new Intl.NumberFormat('en-IN', {
        style: 'currency',
        currency: 'INR',
        maximumFractionDigits: 0,
      }).format(totalAmount)
      sonnerToast.success(
        `${created} recurring ${created === 1 ? 'entry' : 'entries'} posted — ${formattedTotal}`,
        { description: due.map(e => `${e.category}: ${e.type}`).slice(0, 3).join(' · ') }
      )
    }
  }, [queryClient])

  const addEntry = useCallback((entry: Omit<RecurringEntry, 'id' | 'createdAt'>) => {
    const newEntry: RecurringEntry = {
      ...entry,
      id: `recurring-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      createdAt: Date.now(),
    }
    const updated = [...read(), newEntry]
    write(updated)
    setEntries(updated)
    return newEntry
  }, [])

  const removeEntry = useCallback((id: string) => {
    const updated = read().filter(e => e.id !== id)
    write(updated)
    setEntries(updated)
  }, [])

  const toggleEntry = useCallback((id: string) => {
    // Not implemented — could add 'enabled' flag later
  }, [])

  return { entries, addEntry, removeEntry, checkAndCreate }
}
