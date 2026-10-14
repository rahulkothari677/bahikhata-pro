'use client'

/**
 * useArrivalRequest — do something when this screen arrives, if another
 * screen asked for it (Phase 5a-3, widened in 5b-2).
 *
 * The bug this fixes: shortcuts navigated and then bumped a counter in the
 * same tick; the target screen mounted afterwards, took the already-bumped
 * counter as its starting point, and so never saw the bump. Found first for
 * the add forms (#214: "Add Party opens the parties list"), then in 5b-2 for
 * Close day and Reminders from More, and the Speak / Barcode shortcuts.
 *
 * A request is a value that waits in the store until the right screen
 * consumes it, so it works whether the screen was already open or opens a
 * moment later.
 */
import { useEffect, useRef } from 'react'
import { useAppStore, type ArrivalAction, type ViewType } from '@/store/app-store'

export function useArrivalRequest(view: ViewType, action: ArrivalAction, run: () => void) {
  const pending = useAppStore((s) => s.pendingArrival)
  const clear = useAppStore((s) => s.clearArrival)
  const runRef = useRef(run)
  // Keep the latest callback without re-running the request effect (declared first, so it runs first).
  useEffect(() => { runRef.current = run })

  const mine = pending?.view === view && pending?.action === action
  useEffect(() => {
    if (!mine) return
    clear()
    // After this render, the same way the old trigger listeners opened their dialogs.
    Promise.resolve().then(() => runRef.current())
  }, [mine, clear])
}

/** The add form of a list screen (Inventory, Khata, Cashbook). */
export function useNewEntryRequest(view: ViewType, open: () => void) {
  useArrivalRequest(view, 'new-entry', open)
}
