'use client'

/**
 * Multi-draft manager for form autosave.
 *
 * Supports MULTIPLE drafts per form type (e.g. many sale drafts, many purchase drafts).
 * Each draft has a unique ID and timestamp.
 *
 * Phase 7f — a draft is a HELD BILL. The shop holds a bill to serve the next
 * customer and comes back to it later, sometimes the next day. Drafts used to
 * expire after 24 hours and the eleventh pushed out the oldest — a held bill
 * could vanish without a word. Now nothing is dropped silently: a bill stays
 * until it is finished or discarded, and at MAX_HELD the app says so (Hold is
 * refused with a message) instead of losing one.
 *
 * IMPORTANT DESIGN: The `save` callback uses a REF for activeDraftId (not state)
 * so it never needs to be recreated. This prevents stale closure bugs where
 * restore/create operations race with the autosave useEffect.
 */

import { useState, useEffect, useCallback, useRef } from 'react'

const DRAFT_VERSION = 2
/** Bills kept per form type. Reaching it is said on screen; nothing is dropped. */
export const MAX_HELD = 20

export type DraftEnvelope<T> = {
  id: string
  savedAt: number
  /** When the shop held it (Hold, or "Hold bill" on leaving); unset for a bill saved only by autosave. */
  heldAt?: number
  data: T
}

type Store<T> = {
  v: number
  drafts: DraftEnvelope<T>[]
}

function key(formType: string) {
  return `bahikhata:drafts:${formType}:v${DRAFT_VERSION}`
}

function read<T>(formType: string): Store<T> {
  if (typeof window === 'undefined') return { v: DRAFT_VERSION, drafts: [] }
  try {
    const raw = localStorage.getItem(key(formType))
    if (!raw) return { v: DRAFT_VERSION, drafts: [] }
    const s = JSON.parse(raw) as Store<T>
    if (s.v !== DRAFT_VERSION) return { v: DRAFT_VERSION, drafts: [] }
    s.drafts.sort((a, b) => b.savedAt - a.savedAt)
    return s
  } catch {
    return { v: DRAFT_VERSION, drafts: [] }
  }
}

function write<T>(formType: string, store: Store<T>) {
  if (typeof window === 'undefined') return
  try {
    localStorage.setItem(key(formType), JSON.stringify(store))
  } catch {
    // silent
  }
}

function isEmptyDraft(data: any): boolean {
  if (data === null || data === undefined) return true
  if (typeof data !== 'object') return true
  // Only count user-entered content as "meaningful":
  // items, partyId, invoiceNo, notes.
  // Default form values (date=today, paymentMode='cash') do NOT count.
  if (Array.isArray(data.items) && data.items.length > 0) return false
  if (typeof data.partyId === 'string' && data.partyId.trim() !== '') return false
  if (typeof data.invoiceNo === 'string' && data.invoiceNo.trim() !== '') return false
  if (typeof data.notes === 'string' && data.notes.trim() !== '') return false
  return true
}

function genId() {
  return `d-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

export function useDrafts<T>(formType: string) {
  const [drafts, setDrafts] = useState<DraftEnvelope<T>[]>([])
  const [activeDraftId, setActiveDraftId] = useState<string | null>(null)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const hasInteractedRef = useRef(false)
  const dataRef = useRef<T | null>(null)

  // CRITICAL: Use a ref for activeDraftId inside save() so the callback
  // never needs to be recreated. This prevents stale closure bugs where
  // restore/create operations race with the autosave useEffect.
  const activeDraftIdRef = useRef<string | null>(null)

  // Keep ref in sync with state
  useEffect(() => {
    activeDraftIdRef.current = activeDraftId
  }, [activeDraftId])

  // Load drafts on mount + clean up old keys
  useEffect(() => {
    const store = read<T>(formType)
    setDrafts(store.drafts)
    if (typeof window !== 'undefined') {
      try {
        localStorage.removeItem(`bahikhata:draft:${formType}:v1`)
      } catch {
        // ignore
      }
    }
  }, [formType])

  const persist = useCallback((store: Store<T>) => {
    write(formType, store)
    setDrafts([...store.drafts])
  }, [formType])

  // save() is STABLE — it never needs to be recreated because it reads
  // activeDraftId from a ref, not from state.
  const save = useCallback((data: T) => {
    hasInteractedRef.current = true
    dataRef.current = data

    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => {
      const currentData = dataRef.current
      if (!currentData) return
      if (isEmptyDraft(currentData)) return

      // Read the LATEST activeDraftId from the ref (not from closure)
      const currentActiveId = activeDraftIdRef.current
      const store = read<T>(formType)

      if (currentActiveId) {
        // Update existing draft
        const idx = store.drafts.findIndex((d) => d.id === currentActiveId)
        if (idx >= 0) {
          store.drafts[idx] = { ...store.drafts[idx], savedAt: Date.now(), data: currentData }
        } else {
          // Active draft was deleted — create a new one (never past MAX_HELD: Hold says so)
          if (store.drafts.length >= MAX_HELD) return
          const newDraft: DraftEnvelope<T> = { id: genId(), savedAt: Date.now(), data: currentData }
          store.drafts.unshift(newDraft)
          activeDraftIdRef.current = newDraft.id
          setActiveDraftId(newDraft.id)
        }
      } else {
        // Create a new draft (never past MAX_HELD: Hold says so)
        if (store.drafts.length >= MAX_HELD) return
        const newDraft: DraftEnvelope<T> = { id: genId(), savedAt: Date.now(), data: currentData }
        store.drafts.unshift(newDraft)
        activeDraftIdRef.current = newDraft.id
        setActiveDraftId(newDraft.id)
      }
      persist(store)
    }, 600)
  }, [formType, persist]) // ← Does NOT depend on activeDraftId

  const restore = useCallback((id: string): T | null => {
    const store = read<T>(formType)
    const draft = store.drafts.find((d) => d.id === id)
    if (!draft) return null
    // CRITICAL: Cancel any pending autosave timer before flipping the active
    // draft ID. Otherwise, a stale timer could fire and write the OLD form
    // state (pre-restore) to the NEW active draft, clobbering it.
    if (debounceRef.current) {
      clearTimeout(debounceRef.current)
      debounceRef.current = null
    }
    // Set BOTH ref and state immediately so the next save() call
    // updates this draft instead of creating a new one.
    activeDraftIdRef.current = id
    setActiveDraftId(id)
    hasInteractedRef.current = true
    return draft.data
  }, [formType])

  const deleteDraft = useCallback((id: string) => {
    const store = read<T>(formType)
    store.drafts = store.drafts.filter((d) => d.id !== id)
    persist(store)
    // Clear active if we're deleting the active draft
    if (activeDraftIdRef.current === id) {
      activeDraftIdRef.current = null
      setActiveDraftId(null)
      hasInteractedRef.current = false
    }
  }, [formType, persist])

  /*
   * Phase 7f: hold the bill on screen NOW — written at once, not after the
   * 600 ms autosave pause (a tap on Hold right after a change would otherwise
   * lose that change), marked held, and let go as the active draft so the next
   * bill starts fresh. 'empty': nothing worth keeping; 'full': MAX_HELD bills
   * already held — the caller says so, nothing is dropped.
   */
  const holdNow = useCallback((data: T): 'held' | 'empty' | 'full' => {
    if (debounceRef.current) {
      clearTimeout(debounceRef.current)
      debounceRef.current = null
    }
    if (isEmptyDraft(data)) return 'empty'
    const store = read<T>(formType)
    const now = Date.now()
    const id = activeDraftIdRef.current
    const idx = id ? store.drafts.findIndex((d) => d.id === id) : -1
    if (idx >= 0) {
      store.drafts[idx] = { ...store.drafts[idx], savedAt: now, heldAt: now, data }
    } else {
      if (store.drafts.length >= MAX_HELD) return 'full'
      store.drafts.unshift({ id: genId(), savedAt: now, heldAt: now, data })
    }
    store.drafts.sort((a, b) => b.savedAt - a.savedAt)
    persist(store)
    activeDraftIdRef.current = null
    setActiveDraftId(null)
    hasInteractedRef.current = false
    dataRef.current = null
    return 'held'
  }, [formType, persist])

  const clearActive = useCallback(() => {
    activeDraftIdRef.current = null
    setActiveDraftId(null)
    hasInteractedRef.current = false
    dataRef.current = null
  }, [])

  // Cleanup debounce on unmount
  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
    }
  }, [])

  // Refresh drafts from localStorage (used after external clearing)
  const refresh = useCallback(() => {
    const store = read<T>(formType)
    setDrafts([...store.drafts])
    if (activeDraftIdRef.current && !store.drafts.find(d => d.id === activeDraftIdRef.current)) {
      activeDraftIdRef.current = null
      setActiveDraftId(null)
    }
  }, [formType])

  return {
    drafts,
    activeDraftId,
    save,
    restore,
    // Alias for backward compat — some callers use restoreDraft
    restoreDraft: restore,
    deleteDraft,
    clearActive,
    holdNow,
    refresh,
    hasDrafts: drafts.length > 0,
  }
}
// A held bill's name and total: lib/bill-total.ts (heldBillName, heldBillFigures) —
// the total by the bill engine (#187), never Σ quantity × price.
