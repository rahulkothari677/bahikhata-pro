'use client'

/**
 * useBrowserBackButton — syncs the app's view navigation with browser history.
 *
 * PROBLEM: Mobile users expect the hardware/browser back button to navigate
 * WITHIN the app. By default, pressing back exits the app entirely because
 * the app uses client-side view switching (Zustand) that doesn't touch
 * browser history.
 *
 * SOLUTION:
 * 1. Every time currentView changes via setView, push a new history entry.
 * 2. When popstate fires (user pressed back), restore the previous view
 *    from our internal stack instead of letting the browser navigate away.
 * 3. When the stack is empty (user is on dashboard), let the browser
 *    back button work normally (exit the app).
 *
 * IMPORTANT: To prevent the "infinite back" problem (where navigating
 * A → B → A → B creates a huge stack), we DEDUPLICATE consecutive
 * same-view entries. If the new view equals the top of the stack, we
 * don't push — this keeps the stack minimal.
 *
 * MAX_STACK_DEPTH = 15 prevents unbounded growth. If the stack exceeds
 * this, older entries are pruned (user can still go back, just not 50
 * levels deep).
 */

import { useEffect, useRef } from 'react'
import { useAppStore } from '@/store/app-store'
import type { ViewType } from '@/store/app-store'

const HISTORY_STATE_KEY = 'bahikhata-view'
const MAX_STACK_DEPTH = 15

export function useBrowserBackButton() {
  const { currentView, setView } = useAppStore()
  const viewStackRef = useRef<ViewType[]>([])
  const isPopstateRef = useRef(false)
  const lastPushedViewRef = useRef<ViewType | null>(null)

  useEffect(() => {
    // Skip the very first render — initialize the stack with dashboard
    if (viewStackRef.current.length === 0) {
      viewStackRef.current = [currentView]
      lastPushedViewRef.current = currentView
      if (typeof window !== 'undefined') {
        window.history.replaceState(
          { [HISTORY_STATE_KEY]: currentView, stackDepth: 0 },
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
      lastPushedViewRef.current = currentView
      return
    }

    // DEDUPLICATE: if the new view is the same as the top of the stack,
    // don't push another entry. This prevents A → B → A → B from creating
    // a 4-entry stack when it should only have 2.
    if (lastPushedViewRef.current === currentView) {
      return
    }

    // User navigated forward (clicked a button or menu item) — push new entry
    viewStackRef.current.push(currentView)
    lastPushedViewRef.current = currentView

    // Prune stack if it exceeds max depth (keep most recent entries)
    if (viewStackRef.current.length > MAX_STACK_DEPTH) {
      viewStackRef.current = viewStackRef.current.slice(-MAX_STACK_DEPTH)
    }

    if (typeof window !== 'undefined') {
      window.history.pushState(
        { [HISTORY_STATE_KEY]: currentView, stackDepth: viewStackRef.current.length - 1 },
        '',
        window.location.href,
      )
    }
  }, [currentView])

  useEffect(() => {
    if (typeof window === 'undefined') return

    const handlePopState = (event: PopStateEvent) => {
      const state = event.state as { [key: string]: any } | null

      if (!state || !(HISTORY_STATE_KEY in state)) {
        // No app state in history — user is going back beyond the app.
        // Let them exit normally (don't preventDefault).
        return
      }

      // Mark that this is a popstate-triggered navigation
      isPopstateRef.current = true

      // Pop the current view from our stack
      if (viewStackRef.current.length > 1) {
        viewStackRef.current.pop()
        const previousView = viewStackRef.current[viewStackRef.current.length - 1]
        lastPushedViewRef.current = previousView
        setView(previousView)
      } else {
        // Stack is empty — go back to dashboard (or stay if already there)
        viewStackRef.current = ['dashboard']
        lastPushedViewRef.current = 'dashboard'
        setView('dashboard')
      }
    }

    window.addEventListener('popstate', handlePopState)
    return () => window.removeEventListener('popstate', handlePopState)
  }, [setView])
}
