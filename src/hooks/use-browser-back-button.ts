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
const HISTORY_SECTION_KEY = 'bahikhata-section'
const HISTORY_GEN_KEY = 'bahikhata-gen'
const MAX_STACK_DEPTH = 15

/**
 * 🐛 2026-08-04. "when i click back from business card section the app
 * restarts."
 *
 * The stack tracked `currentView` only. Account SECTIONS — Business Card, My
 * Profile, Security, and eight more — all live under the single view
 * `account`, so opening one pushed nothing. They were invisible to this file.
 *
 * Two things followed. Back from a section skipped the whole Account screen
 * and unwound to whatever came before it. And the on-screen back arrow had to
 * navigate by hand, calling `setView('more')` — a ROOT view, which bumps the
 * generation and marks every earlier history entry stale. A later back press
 * landing on one of those stale entries hit the skip below, which called
 * `history.back()` again, and again, with nothing bounding it. Walk past the
 * app's own entries and the WebView goes back to its initial URL and reloads
 * it: splash screen, re-auth, dashboard. A restart.
 *
 * Sections are now first-class stack entries, so back from Business Card
 * returns to the Account menu, and the skip is bounded so it can never walk
 * out of the app no matter what state the history is in.
 */
interface StackEntry {
  view: ViewType
  /** The account sub-page, when the view is `account`. */
  section: string | null
}

const sameEntry = (a: StackEntry | undefined, b: StackEntry) =>
  a !== undefined && a.view === b.view && a.section === b.section

// Views that RESET the navigation stack when navigated to via bottom nav.
// These are the "root" destinations — tapping them starts a new context.
// 🔒 V26 N2: ROOT_VIEWS updated to match actual bottom-nav tabs.
// Was: ['dashboard', 'sales', 'inventory', 'more'] — 'purchases' was missing
// (a bottom-nav tab treated as child push), 'inventory' was included
// (no longer a tab, only reachable via More → treated as root → back skips More).
// Now: ['dashboard', 'sales', 'purchases', 'more'] — matches the 4 bottom-nav tabs.
const ROOT_VIEWS: ViewType[] = ['dashboard', 'sales', 'purchases', 'more']

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
  const { currentView, accountSection, setView, setAccountSection, setSelectedTransactionId, setSelectedTransactionType, setSelectedPartyId } = useAppStore()
  const viewStackRef = useRef<StackEntry[]>([])
  const generationRef = useRef(0)
  const lastPushedRef = useRef<StackEntry | null>(null)
  /** Consecutive stale entries skipped — bounds the skip loop below. */
  const staleSkipsRef = useRef(0)

  useEffect(() => {
    // An account section is only meaningful on the account view; carrying a
    // stale one would push a phantom entry the user never visited.
    const entry: StackEntry = {
      view: currentView,
      section: currentView === 'account' ? accountSection : null,
    }

    // ── Initialize on first render ──────────────────────────────────────
    if (viewStackRef.current.length === 0) {
      viewStackRef.current = [entry]
      _appBackStackLength = 1  // 🔒 V11 FIX: sync module-level mirror
      lastPushedRef.current = entry
      if (typeof window !== 'undefined') {
        window.history.replaceState(
          {
            [HISTORY_STATE_KEY]: entry.view,
            [HISTORY_SECTION_KEY]: entry.section,
            [HISTORY_GEN_KEY]: generationRef.current,
          },
          '',
          window.location.href,
        )
      }
      return
    }

    /*
     * ── Already where we think we are: nothing to push ──────────────────
     *
     * This covers the back button too. A separate `isPopstateRef` flag used to
     * do that, and it was a bug: the flag was only cleared when the effect
     * actually ran, so a pop that landed on the state the store ALREADY held —
     * closing an Account section, say — left it set, and it then swallowed the
     * next genuine navigation. The stack silently stopped recording pushes
     * while the browser's history kept growing, and the two drifted until back
     * went somewhere arbitrary. `lastPushedRef` is the whole truth: the popstate
     * handler sets it to wherever it navigated, so the check self-clears.
     */
    if (sameEntry(lastPushedRef.current ?? undefined, entry)) {
      return
    }

    if (typeof window === 'undefined') return

    // ── Leaving a section for the Account menu is a BACK, not a forward ──
    // Closing Business Card returns to the page that opened it. Pushing a new
    // entry for it would mean the user had to press back twice to leave, and
    // would grow the stack every time they browsed the account pages.
    const prev = viewStackRef.current[viewStackRef.current.length - 1]
    if (prev && prev.view === 'account' && prev.section && entry.view === 'account' && !entry.section) {
      // Hand it to history and let the popstate handler own the stack. Popping
      // here as well would take TWO entries off for one back — the section and
      // the Account menu behind it — landing the user a screen too far back.
      window.history.back()
      return
    }

    if (ROOT_VIEWS.includes(currentView)) {
      // ── ROOT VIEW: reset the stack ────────────────────────────────────
      // Bump generation so old history entries become stale
      generationRef.current++

      const push = (e: StackEntry) =>
        window.history.pushState(
          {
            [HISTORY_STATE_KEY]: e.view,
            [HISTORY_SECTION_KEY]: e.section,
            [HISTORY_GEN_KEY]: generationRef.current,
          },
          '',
          window.location.href,
        )

      if (currentView === 'dashboard') {
        viewStackRef.current = [{ view: 'dashboard', section: null }]
        _appBackStackLength = 1  // 🔒 V11 FIX: sync module-level mirror
        // Push dashboard entry with new generation
        push({ view: 'dashboard', section: null })
      } else {
        // Stack: [dashboard, currentRootView]
        viewStackRef.current = [{ view: 'dashboard', section: null }, entry]
        _appBackStackLength = 2  // 🔒 V11 FIX: sync module-level mirror

        // Push a "dashboard" entry first so back from root view → dashboard
        push({ view: 'dashboard', section: null })
        // Then push the root view entry
        push(entry)
      }
    } else {
      // ── CHILD VIEW: push onto stack ───────────────────────────────────
      viewStackRef.current.push(entry)

      // Prune if too deep
      if (viewStackRef.current.length > MAX_STACK_DEPTH) {
        viewStackRef.current = viewStackRef.current.slice(-MAX_STACK_DEPTH)
      }
      _appBackStackLength = viewStackRef.current.length  // 🔒 V11 FIX: sync

      // Push to browser history with current generation
      window.history.pushState(
        {
          [HISTORY_STATE_KEY]: entry.view,
          [HISTORY_SECTION_KEY]: entry.section,
          [HISTORY_GEN_KEY]: generationRef.current,
        },
        '',
        window.location.href,
      )
    }

    lastPushedRef.current = entry
  }, [currentView, accountSection])

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
      const reanchor = () => {
        const top = viewStackRef.current[viewStackRef.current.length - 1]
        if (!top) return
        window.history.pushState(
          {
            [HISTORY_STATE_KEY]: top.view,
            [HISTORY_SECTION_KEY]: top.section,
            [HISTORY_GEN_KEY]: generationRef.current,
          },
          '',
          window.location.href,
        )
      }

      if (!state || !(HISTORY_STATE_KEY in state)) {
        reanchor()
        return
      }

      // ── Check if this entry is from the current generation ────────────
      // If not, it's a stale entry from before a stack reset. Skip it
      // WITHOUT triggering a UI update — just go back again.
      if (state[HISTORY_GEN_KEY] !== generationRef.current) {
        // ⚠️ BOUNDED. This skip used to be unbounded, and a run of stale
        // entries would call history.back() until it ran off the end of the
        // app's own history — at which point the WebView reloads the start
        // URL, which the user experiences as the app restarting. Past the
        // bound, stop skipping and re-anchor on the current view: staying put
        // is always recoverable, leaving the app is not.
        staleSkipsRef.current += 1
        if (staleSkipsRef.current > MAX_STACK_DEPTH || window.history.length <= 1) {
          staleSkipsRef.current = 0
          reanchor()
          return
        }
        window.history.back()
        return
      }

      staleSkipsRef.current = 0

      // ── Valid entry — pop our stack and navigate ──────────────────────
      if (viewStackRef.current.length > 1) {
        viewStackRef.current.pop()
        _appBackStackLength = viewStackRef.current.length  // 🔒 V11 FIX: sync
        const previous = viewStackRef.current[viewStackRef.current.length - 1]
        lastPushedRef.current = previous
        // Clear any selected items when going back so they don't reopen
        setSelectedTransactionId(null)
        setSelectedTransactionType(null)
        setSelectedPartyId(null)
        // 🔒 V26 N6: Clear accountSection when leaving Account via hardware back.
        // Was: accountSection persisted → next Account open landed in stale section.
        // Now it also RESTORES the section when going back INTO one, so the
        // account pages behave like the rest of the app.
        setAccountSection(previous.view === 'account' ? previous.section : null)
        setView(previous.view)
      }
      // If stack is just [dashboard], don't pop — next back press exits
    }

    window.addEventListener('popstate', handlePopState)
    return () => window.removeEventListener('popstate', handlePopState)
  }, [setView, setAccountSection, setSelectedTransactionId, setSelectedTransactionType, setSelectedPartyId])
}
