'use client'

/**
 * useBrowserBackButton — hierarchical navigation synced with browser history.
 *
 * MODEL:
 * The app uses a "hierarchical stack" model, not a linear history model.
 * This matches how top mobile apps (WhatsApp, Instagram) handle back button.
 *
 * ROOT VIEWS (bottom nav items): dashboard, sales, inventory, more
 *   - When you tap a bottom nav item, the back stack RESETS.
 *   - Previous history is cleared (marked as stale and skipped).
 *   - Stack becomes: [dashboard, currentRootView]
 *
 * CHILD VIEWS (everything else): transaction-detail, party-profile,
 * new-sale, new-purchase, purchases, income-expense, parties, scanner,
 * reports, settings
 *   - Pushed onto the stack.
 *   - Back from a child view goes to its parent (previous stack entry).
 *
 * EXAMPLE FLOW:
 *   Dashboard → Sales → Customer Detail → (tap Inventory) → More →
 *   Purchases → Distributor → (back) → Purchases → (tap More) →
 *   Income & Expense
 *
 *   Stack at Income & Expense: [dashboard, more, income-expense]
 *
 *   Back from Income & Expense: → More (menu page)
 *   Back from More: → Dashboard (main interface)
 *   Back from Dashboard: → Exit app
 *
 *   (Does NOT go through Sales, Customer Detail, Inventory, Purchases, Distributor)
 *
 * IMPLEMENTATION:
 * - "Generation" counter: bumped every time a root view is navigated to.
 *   Old history entries have a stale generation and are skipped on popstate.
 * - When navigating to a root view, push a "dashboard" entry first, then
 *   the root view entry. This ensures back from root view goes to dashboard.
 * - Stale entries are skipped in popstate by calling history.back() again
 *   without triggering UI updates.
 */

import { useEffect, useRef } from 'react'
import { useAppStore } from '@/store/app-store'
import type { ViewType } from '@/store/app-store'

const HISTORY_STATE_KEY = 'bahikhata-view'
const HISTORY_GEN_KEY = 'bahikhata-gen'
const MAX_STACK_DEPTH = 15

// Views that RESET the navigation stack when navigated to via bottom nav.
// These are the "root" destinations — tapping them starts a new context.
const ROOT_VIEWS: ViewType[] = ['dashboard', 'sales', 'inventory', 'more']

// 🔒 V11 FIX: Module-level mirror of the view stack, so CapacitorBridge can
// check "can the user go back within the app?" without accessing the hook's
// internal ref. Was: CapacitorBridge used Capacitor's `canGoBack` which
// checks Android WebView's URL-based history — but this app uses pushState
// with the SAME URL (no URL change), so canGoBack always returned false →
// App.exitApp() was called on every back press → app "restarted."
//
// This variable is updated by the hook on every push/pop. It's safe to read
// from anywhere (CapacitorBridge, tests, etc.).
let _appBackStackLength = 1

/**
 * Returns true if the user can go back within the app's own navigation stack.
 * Used by CapacitorBridge to decide: go back vs exit app.
 */
export function canGoBackInApp(): boolean {
  return _appBackStackLength > 1
}

export function useBrowserBackButton() {
  const { currentView, setView, setSelectedTransactionId, setSelectedTransactionType, setSelectedPartyId } = useAppStore()
  const viewStackRef = useRef<ViewType[]>([])
  const generationRef = useRef(0)
  const isPopstateRef = useRef(false)
  const lastPushedViewRef = useRef<ViewType | null>(null)

  useEffect(() => {
    // ── Initialize on first render ──────────────────────────────────────
    if (viewStackRef.current.length === 0) {
      viewStackRef.current = [currentView]
      _appBackStackLength = 1  // 🔒 V11 FIX: sync module-level mirror
      lastPushedViewRef.current = currentView
      if (typeof window !== 'undefined') {
        window.history.replaceState(
          {
            [HISTORY_STATE_KEY]: currentView,
            [HISTORY_GEN_KEY]: generationRef.current,
          },
          '',
          window.location.href,
        )
      }
      return
    }

    // ── Skip if triggered by popstate (back button) ─────────────────────
    if (isPopstateRef.current) {
      isPopstateRef.current = false
      lastPushedViewRef.current = currentView
      return
    }

    // ── Skip duplicate consecutive views ────────────────────────────────
    if (lastPushedViewRef.current === currentView) {
      return
    }

    if (typeof window === 'undefined') return

    if (ROOT_VIEWS.includes(currentView)) {
      // ── ROOT VIEW: reset the stack ────────────────────────────────────
      // Bump generation so old history entries become stale
      generationRef.current++

      if (currentView === 'dashboard') {
        viewStackRef.current = ['dashboard']
        _appBackStackLength = 1  // 🔒 V11 FIX: sync module-level mirror
        // Push dashboard entry with new generation
        window.history.pushState(
          {
            [HISTORY_STATE_KEY]: 'dashboard',
            [HISTORY_GEN_KEY]: generationRef.current,
          },
          '',
          window.location.href,
        )
      } else {
        // Stack: [dashboard, currentRootView]
        viewStackRef.current = ['dashboard', currentView]
        _appBackStackLength = 2  // 🔒 V11 FIX: sync module-level mirror

        // Push a "dashboard" entry first so back from root view → dashboard
        window.history.pushState(
          {
            [HISTORY_STATE_KEY]: 'dashboard',
            [HISTORY_GEN_KEY]: generationRef.current,
          },
          '',
          window.location.href,
        )

        // Then push the root view entry
        window.history.pushState(
          {
            [HISTORY_STATE_KEY]: currentView,
            [HISTORY_GEN_KEY]: generationRef.current,
          },
          '',
          window.location.href,
        )
      }
    } else {
      // ── CHILD VIEW: push onto stack ───────────────────────────────────
      viewStackRef.current.push(currentView)

      // Prune if too deep
      if (viewStackRef.current.length > MAX_STACK_DEPTH) {
        viewStackRef.current = viewStackRef.current.slice(-MAX_STACK_DEPTH)
      }
      _appBackStackLength = viewStackRef.current.length  // 🔒 V11 FIX: sync

      // Push to browser history with current generation
      window.history.pushState(
        {
          [HISTORY_STATE_KEY]: currentView,
          [HISTORY_GEN_KEY]: generationRef.current,
        },
        '',
        window.location.href,
      )
    }

    lastPushedViewRef.current = currentView
  }, [currentView])

  // ── Popstate handler ──────────────────────────────────────────────────
  useEffect(() => {
    if (typeof window === 'undefined') return

    const handlePopState = (event: PopStateEvent) => {
      const state = event.state as { [key: string]: any } | null

      // No app state — user is going back beyond our app's history.
      // 🔒 V11 FIX: Was: `return` (let browser navigate away → page reload
      // → app "restarts"). Now: push the current view back onto the history
      // stack so the app stays alive. The user stays in the app instead of
      // being bounced out.
      if (!state || !(HISTORY_STATE_KEY in state)) {
        if (viewStackRef.current.length > 0) {
          const currentViewName = viewStackRef.current[viewStackRef.current.length - 1]
          window.history.pushState(
            {
              [HISTORY_STATE_KEY]: currentViewName,
              [HISTORY_GEN_KEY]: generationRef.current,
            },
            '',
            window.location.href,
          )
        }
        return
      }

      // ── Check if this entry is from the current generation ────────────
      // If not, it's a stale entry from before a stack reset. Skip it
      // WITHOUT triggering a UI update — just go back again.
      if (state[HISTORY_GEN_KEY] !== generationRef.current) {
        // Stale entry — skip by going back again
        // Safety: only skip if there's history to go back to
        if (window.history.length > 1) {
          window.history.back()
        }
        return
      }

      // ── Valid entry — pop our stack and navigate ──────────────────────
      if (viewStackRef.current.length > 1) {
        viewStackRef.current.pop()
        _appBackStackLength = viewStackRef.current.length  // 🔒 V11 FIX: sync
        const previousView = viewStackRef.current[viewStackRef.current.length - 1]
        isPopstateRef.current = true
        lastPushedViewRef.current = previousView
        // Clear any selected items when going back so they don't reopen
        setSelectedTransactionId(null)
        setSelectedTransactionType(null)
        setSelectedPartyId(null)
        setView(previousView)
      }
      // If stack is just [dashboard], don't pop — next back press exits
    }

    window.addEventListener('popstate', handlePopState)
    return () => window.removeEventListener('popstate', handlePopState)
  }, [setView])
}
