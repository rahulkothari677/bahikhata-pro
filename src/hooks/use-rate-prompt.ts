'use client'

/**
 * useRatePrompt — tracks successful actions and prompts the user to rate
 * the app after milestones (5, 15, 30 actions).
 *
 * - Persists count + last-prompt-shown in localStorage
 * - Only shows once per milestone
 * - Skips if user dismissed (clicked "Not now") or already rated
 * - Resets after 7 days if user said "Not now" (so we can ask again later)
 *
 * Usage:
 *   const { shouldShow, onRated, onDismiss, count } = useRatePrompt()
 *   // Increment after a successful action:
 *   count()  // or use increment()
 */

import { useState, useEffect, useCallback } from 'react'

const KEY = 'bahikhata:rate-prompt:v1'
const MILESTONES = [5, 15, 30, 60, 120] // Show at these action counts
const REASK_AFTER_MS = 7 * 24 * 60 * 60 * 1000 // 7 days

type Store = {
  actionCount: number
  lastPromptedAt: number | null // when we last showed the prompt
  hasRated: boolean
  hasDismissed: boolean // user clicked "Not now"
  dismissedAt: number | null
}

function read(): Store {
  if (typeof window === 'undefined') {
    return { actionCount: 0, lastPromptedAt: null, hasRated: false, hasDismissed: false, dismissedAt: null }
  }
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return { actionCount: 0, lastPromptedAt: null, hasRated: false, hasDismissed: false, dismissedAt: null }
    return JSON.parse(raw) as Store
  } catch {
    return { actionCount: 0, lastPromptedAt: null, hasRated: false, hasDismissed: false, dismissedAt: null }
  }
}

function write(s: Store) {
  if (typeof window === 'undefined') return
  try {
    localStorage.setItem(KEY, JSON.stringify(s))
  } catch {
    // silent
  }
}

export function useRatePrompt() {
  const [shouldShow, setShouldShow] = useState(false)

  useEffect(() => {
    // On mount, check if we should show the prompt
    const s = read()
    if (s.hasRated) return
    // If user dismissed, wait 7 days before asking again
    if (s.hasDismissed && s.dismissedAt) {
      if (Date.now() - s.dismissedAt < REASK_AFTER_MS) return
    }
    // Check if we hit a milestone that hasn't been prompted yet
    const hitMilestone = MILESTONES.includes(s.actionCount)
    const alreadyPrompted = s.lastPromptedAt !== null && s.actionCount <= (s.lastPromptedAt || 0)
    if (hitMilestone && !alreadyPrompted) {
      setShouldShow(true)
    }
  }, [])

  const increment = useCallback(() => {
    const s = read()
    s.actionCount += 1
    write(s)
    // Check if we should show prompt after this increment
    if (s.hasRated) return
    if (s.hasDismissed && s.dismissedAt) {
      if (Date.now() - s.dismissedAt < REASK_AFTER_MS) return
    }
    if (MILESTONES.includes(s.actionCount)) {
      setShouldShow(true)
    }
  }, [])

  const onRated = useCallback(() => {
    const s = read()
    s.hasRated = true
    s.lastPromptedAt = Date.now()
    write(s)
    setShouldShow(false)
  }, [])

  const onDismiss = useCallback(() => {
    const s = read()
    s.hasDismissed = true
    s.dismissedAt = Date.now()
    s.lastPromptedAt = Date.now()
    write(s)
    setShouldShow(false)
  }, [])

  return { shouldShowRatePrompt: shouldShow, increment, onRated, onDismiss }
}
