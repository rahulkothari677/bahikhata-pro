/**
 * Back navigation through the Account sections.
 *
 * 🐛 2026-08-04. Rahul: "when i click back from business card section the app
 * restarts."
 *
 * The stack tracked `currentView` only, and all eleven Account sections live
 * under the single view `account`. Opening Business Card pushed nothing, so
 * back from it unwound past the whole Account screen — and the on-screen arrow,
 * having no stack entry to pop, navigated by hand via `setView('more')`. That
 * is a ROOT view, so every trip through a section bumped the history generation
 * and left the previous entries stale. A later back press landing on stale
 * entries hit an UNBOUNDED skip loop that called `history.back()` until it ran
 * off the end of the app's own history, at which point the WebView reloads the
 * start URL: splash screen, dashboard, what the user calls a restart.
 *
 * These tests hold both halves shut — sections are real stack entries, and the
 * skip can never walk out of the app.
 */

import { renderHook, act } from '@testing-library/react'
import { useBrowserBackButton, canGoBackInApp } from '@/hooks/use-browser-back-button'
import { useAppStore } from '@/store/app-store'

const HISTORY_STATE_KEY = 'bahikhata-view'
const HISTORY_GEN_KEY = 'bahikhata-gen'

/**
 * A history stack that reports when something walked off the end of it.
 *
 * jsdom's own history silently no-ops on over-popping, which is exactly the
 * case that hurts on Android — so the real behaviour has to be modelled.
 */
function installHistory() {
  const entries: Array<Record<string, unknown> | null> = [null]
  let index = 0
  let exited = false

  const fire = () => {
    window.dispatchEvent(new PopStateEvent('popstate', { state: entries[index] ?? null }))
  }

  Object.defineProperty(window, 'history', {
    configurable: true,
    value: {
      get length() {
        return entries.length
      },
      get state() {
        return entries[index] ?? null
      },
      pushState(state: Record<string, unknown>) {
        entries.splice(index + 1)
        entries.push(state)
        index = entries.length - 1
      },
      replaceState(state: Record<string, unknown>) {
        entries[index] = state
      },
      back() {
        if (index === 0) {
          // On Android this leaves the app's pages entirely and the WebView
          // reloads its start URL. That IS the restart being tested for.
          exited = true
          return
        }
        index -= 1
        fire()
      },
    },
  })

  return {
    get exited() {
      return exited
    },
    get depth() {
      return entries.length
    },
    get topState() {
      return entries[index]
    },
    seedStale(count: number) {
      // Entries from an older generation, as a stack reset would leave behind.
      for (let i = 0; i < count; i++) {
        entries.splice(index + 1)
        entries.push({ [HISTORY_STATE_KEY]: 'sales', [HISTORY_GEN_KEY]: -99 })
        index = entries.length - 1
      }
    },
    back() {
      ;(window.history as unknown as { back: () => void }).back()
    },
  }
}

function resetStore() {
  useAppStore.setState({
    currentView: 'dashboard',
    accountSection: null,
    previousView: null,
    accountOriginView: null,
  } as never)
}

describe('back from an Account section', () => {
  let hist: ReturnType<typeof installHistory>

  beforeEach(() => {
    resetStore()
    hist = installHistory()
  })

  const go = (view: string, section: string | null = null) =>
    act(() => {
      useAppStore.setState({ currentView: view, accountSection: section } as never)
    })

  it('makes the section its own step, so back returns to the Account menu', () => {
    renderHook(() => useBrowserBackButton())

    go('more')
    go('account')
    go('account', 'business-card')

    expect(useAppStore.getState().accountSection).toBe('business-card')

    act(() => hist.back())

    // Back lands on the Account MENU, not somewhere past it.
    expect(useAppStore.getState().currentView).toBe('account')
    expect(useAppStore.getState().accountSection).toBeNull()
    expect(hist.exited ? 'LEFT THE APP' : 'still inside').toBe('still inside')
  })

  it('walks back out through More and dashboard without leaving the app', () => {
    renderHook(() => useBrowserBackButton())

    go('more')
    go('account')
    go('account', 'business-card')

    act(() => hist.back()) // → account menu
    act(() => hist.back()) // → more
    expect(useAppStore.getState().currentView).toBe('more')

    act(() => hist.back()) // → dashboard
    expect(useAppStore.getState().currentView).toBe('dashboard')
    expect(hist.exited ? 'LEFT THE APP' : 'still inside').toBe('still inside')
  })

  it('restores the section when going back INTO one', () => {
    renderHook(() => useBrowserBackButton())

    go('more')
    go('account')
    go('account', 'business-card')
    go('transaction-detail')

    act(() => hist.back())

    // The user was looking at Business Card before opening the transaction;
    // returning them to a blank Account menu loses their place.
    expect(useAppStore.getState().currentView).toBe('account')
    expect(useAppStore.getState().accountSection).toBe('business-card')
  })

  it('does not grow the stack when browsing between sections', () => {
    renderHook(() => useBrowserBackButton())

    go('more')
    go('account')
    const base = canGoBackInApp()
    expect(base).toBe(true)

    // Open and close four sections, as a shopkeeper exploring their account
    // would. Each round trip must be stack-neutral.
    for (const s of ['profile', 'business-card', 'security', 'data']) {
      go('account', s)
      go('account', null)
    }

    act(() => hist.back()) // one press should still reach More
    expect(useAppStore.getState().currentView).toBe('more')
    expect(hist.exited ? 'LEFT THE APP' : 'still inside').toBe('still inside')
  })
})

describe('stale history entries', () => {
  let hist: ReturnType<typeof installHistory>

  beforeEach(() => {
    resetStore()
    hist = installHistory()
  })

  it('never walks out of the app, however many stale entries it meets', () => {
    renderHook(() => useBrowserBackButton())

    act(() => {
      useAppStore.setState({ currentView: 'more' } as never)
    })

    // A long run of entries from an earlier generation — what repeated root
    // navigations used to leave behind. The old code skipped these one by one
    // with no bound and eventually stepped off the end.
    hist.seedStale(40)

    act(() => hist.back())

    expect(hist.exited ? 'LEFT THE APP — the restart is back' : 'still inside').toBe('still inside')
  })
})
