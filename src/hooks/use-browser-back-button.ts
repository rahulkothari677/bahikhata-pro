'use client'

/**
 * useBrowserBackButton — syncs the app's view navigation with browser history.
 *
 * PROBLEM: Mobile users expect the hardware/browser back button to navigate
 * WITHIN the app (e.g., from "New Sale" back to "Sales Ledger"). But by
 * default, pressing back exits the app entirely because the app uses
 * client-side view switching (Zustand) that doesn't touch browser history.
 *
 * SOLUTION:
 * 1. Every time currentView changes via setView, push a new history entry.
 * 2. When popstate fires (user pressed back), restore the previous view
 *    from our internal stack instead of letting the browser navigate away.
 * 3. When the stack is empty (user is on dashboard), let the browser
 *    back button work normally (exit the app).
 *
 * This makes "swipe to back" on iOS/Android and the bottom back button
 * work as users expect — navigating within the app.
 *
 * Also handles selectedTransactionId and selectedPartyId (detail views)
 * as separate history entries, so pressing back from a detail view goes
 * to the list, not out of the app.
 */

import { useEffect, useRef } from 'react'
import { useAppStore } from '@/store/app-store'
import type { ViewType } from '@/store/app-store'

const HISTORY_STATE_KEY = 'bahikhata-view'

export function useBrowserBackButton() {
  const { currentView, setView, selectedTransactionId, selectedPartyId } = useAppStore()
  const viewStackRef = useRef<ViewType[]>(['dashboard'])
  const isPopstateRef = useRef(false)

  useEffect(() => {
    // Skip the very first render (initial mount) — don't push for the
    // initial dashboard view, the browser already has it
    if (viewStackRef.current.length === 1 && currentView === 'dashboard') {
      // Replace the initial state so we have something to pop back to
      if (typeof window !== 'undefined') {
        window.history.replaceState(
          { [HISTORY_STATE_KEY]: 'dashboard', stackDepth: 0 },
          '',
          window.location.href,
        )
      }
      return
    }

    // If this view change was triggered by popstate (back button), don't
    // push a new history entry — we're already moving back in the stack
    if (isPopstateRef.current) {
      isPopstateRef.current = false
      return
    }

    // User navigated forward (clicked a button or menu item) — push new entry
    viewStackRef.current.push(currentView)
    if (typeof window !== 'undefined') {
      window.history.pushState(
        { [HISTORY_STATE_KEY]: currentView, stackDepth: viewStackRef.current.length - 1 },
        '',
        window.location.href,
      )
    }
  }, [currentView, selectedTransactionId, selectedPartyId])

  useEffect(() => {
    if (typeof window === 'undefined') return

    const handlePopState = (event: PopStateEvent) => {
      const state = event.state as { [key: string]: any } | null

      if (!state || !(HISTORY_STATE_KEY in state)) {
        // No app state in history — user is going back beyond the app
        // Let them exit normally
        return
      }

      // Mark that this is a popstate-triggered navigation so we don't
      // push a new history entry for it
      isPopstateRef.current = true

      // Pop the current view from our stack
      if (viewStackRef.current.length > 1) {
        viewStackRef.current.pop()
        const previousView = viewStackRef.current[viewStackRef.current.length - 1]
        setView(previousView)
      } else {
        // Stack is empty — go back to dashboard
        setView('dashboard')
      }
    }

    window.addEventListener('popstate', handlePopState)
    return () => window.removeEventListener('popstate', handlePopState)
  }, [setView])
}
