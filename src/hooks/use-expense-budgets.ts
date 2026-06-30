'use client'

/**
 * useExpenseBudgets — manage monthly expense budgets per category.
 *
 * Stores budgets in localStorage (per-user, per-month).
 * No database migration needed — can be upgraded to DB later.
 *
 * Usage:
 *   const { budgets, setBudget, getBudget, getProgress } = useExpenseBudgets()
 *   setBudget('Rent', 15000)  // set ₹15,000 monthly budget for Rent
 *   getProgress('Rent', 12000) // returns { spent: 12000, budget: 15000, pct: 80, exceeded: false }
 */

import { useState, useEffect, useCallback } from 'react'

const KEY = 'bahikhata:expense-budgets:v1'

type Budgets = Record<string, number> // category → monthly budget amount

function read(): Budgets {
  if (typeof window === 'undefined') return {}
  try {
    const raw = localStorage.getItem(KEY)
    return raw ? JSON.parse(raw) : {}
  } catch {
    return {}
  }
}

function write(budgets: Budgets) {
  if (typeof window === 'undefined') return
  try {
    localStorage.setItem(KEY, JSON.stringify(budgets))
  } catch {
    // silent
  }
}

export function useExpenseBudgets() {
  const [budgets, setBudgets] = useState<Budgets>({})

  useEffect(() => {
    setBudgets(read())
  }, [])

  const setBudget = useCallback((category: string, amount: number) => {
    setBudgets(prev => {
      const next = { ...prev }
      if (amount <= 0) {
        delete next[category]
      } else {
        next[category] = amount
      }
      write(next)
      return next
    })
  }, [])

  const getBudget = useCallback((category: string): number => {
    return budgets[category] || 0
  }, [budgets])

  const getProgress = useCallback((category: string, spent: number) => {
    const budget = budgets[category] || 0
    if (budget === 0) return null
    const pct = Math.min(100, (spent / budget) * 100)
    return {
      spent,
      budget,
      pct,
      exceeded: spent > budget,
      remaining: budget - spent,
    }
  }, [budgets])

  const removeBudget = useCallback((category: string) => {
    setBudgets(prev => {
      const next = { ...prev }
      delete next[category]
      write(next)
      return next
    })
  }, [])

  return { budgets, setBudget, getBudget, getProgress, removeBudget }
}
