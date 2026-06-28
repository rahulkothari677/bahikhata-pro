'use client'

/**
 * BusinessGoals — set monthly revenue/expense targets and track progress.
 *
 * Stores goals in localStorage per month (YYYY-MM).
 * Shows progress bars on dashboard.
 */

import { useState, useEffect, useCallback } from 'react'

const KEY = 'bahikhata:business-goals:v1'

type Goals = {
  revenueTarget?: number
  expenseBudget?: number
}

function read(month: string): Goals {
  if (typeof window === 'undefined') return {}
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return {}
    const all = JSON.parse(raw)
    return all[month] || {}
  } catch {
    return {}
  }
}

function write(month: string, goals: Goals) {
  if (typeof window === 'undefined') return
  try {
    const raw = localStorage.getItem(KEY)
    const all = raw ? JSON.parse(raw) : {}
    all[month] = goals
    localStorage.setItem(KEY, JSON.stringify(all))
  } catch {}
}

export function getCurrentMonth(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

export function useBusinessGoals() {
  const [goals, setGoals] = useState<Goals>({})
  const month = getCurrentMonth()

  useEffect(() => {
    setGoals(read(month))
  }, [month])

  const setRevenueTarget = useCallback((amount: number) => {
    const updated = { ...goals, revenueTarget: amount || undefined }
    write(month, updated)
    setGoals(updated)
  }, [goals, month])

  const setExpenseBudget = useCallback((amount: number) => {
    const updated = { ...goals, expenseBudget: amount || undefined }
    write(month, updated)
    setGoals(updated)
  }, [goals, month])

  return {
    goals,
    setRevenueTarget,
    setExpenseBudget,
    revenueTarget: goals.revenueTarget,
    expenseBudget: goals.expenseBudget,
  }
}
