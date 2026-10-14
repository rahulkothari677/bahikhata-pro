'use client'

/**
 * useNewEntryRequest — open a screen's "add" form when another screen asked
 * for it (Phase 5a-3).
 *
 * The bug this fixes: "Add Product", "Add Customer/Supplier" (search, More)
 * and the + sheet's "New item" / "New customer" / "Income / Expense" opened the
 * LIST, not the form. They navigated and then bumped `triggerNewEntry` in the
 * same tick; the target screen mounted afterwards, took the already-bumped
 * counter as its starting point, and so never saw the bump. (Likely the root of
 * #214, "Add Party opens the parties list".)
 *
 * A request is a value that waits in the store until the right screen consumes
 * it, so it works whether the screen was already open or opens a moment later.
 */
import { useEffect, useRef } from 'react'
import { useAppStore, type ViewType } from '@/store/app-store'

export function useNewEntryRequest(view: ViewType, open: () => void) {
  const pending = useAppStore((s) => s.pendingNewEntryView)
  const clear = useAppStore((s) => s.clearNewEntryRequest)
  const openRef = useRef(open)
  // Keep the latest opener without re-running the request effect (declared first, so it runs first).
  useEffect(() => { openRef.current = open })

  useEffect(() => {
    if (pending !== view) return
    clear()
    // After this render, the same way the trigger listeners open their dialogs.
    Promise.resolve().then(() => openRef.current())
  }, [pending, view, clear])
}
