'use client'

/**
 * Multi-draft manager for form autosave.
 *
 * Supports MULTIPLE drafts per form type (e.g. many sale drafts, many purchase drafts).
 * Each draft has a unique ID and timestamp. Drafts auto-expire after 24 hours.
 *
 * Storage layout (localStorage):
 *   bahikhata:drafts:{formType} → JSON array of DraftEnvelope
 *
 * Each draft:
 *   { id, savedAt, data }
 *
 * Usage:
 *   const drafts = useDrafts('txn-sale')
 *   drafts.save(data)        // creates or updates the active draft
 *   drafts.list()            // returns all drafts (newest first)
 *   drafts.restore(id)       // returns the draft data, keeps the draft in storage
 *   drafts.delete(id)        // removes a draft
 *   drafts.clearActive()     // unsets the active draft ID (after submit/discard)
 */

import { useState, useEffect, useCallback, useRef } from 'react'

const DRAFT_VERSION = 2
const DRAFT_TTL_MS = 24 * 60 * 60 * 1000 // 24 hours
const MAX_DRAFTS = 10 // per form type

export type DraftEnvelope<T> = {
  id: string
  savedAt: number
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
    // Expire old drafts
    const now = Date.now()
    s.drafts = s.drafts.filter((d) => now - d.savedAt < DRAFT_TTL_MS)
    // Sort newest first
    s.drafts.sort((a, b) => b.savedAt - a.savedAt)
    return s
  } catch {
    return { v: DRAFT_VERSION, drafts: [] }
  }
}

function write<T>(formType: string, store: Store<T>) {
  if (typeof window === 'undefined') return
  try {
    // Trim to max
    store.drafts = store.drafts.slice(0, MAX_DRAFTS)
    localStorage.setItem(key(formType), JSON.stringify(store))
  } catch {
    // localStorage full or disabled — silent
  }
}

/**
 * Check if a draft's data is "empty" (no meaningful content).
 * Used to avoid saving empty drafts.
 */
function isEmptyDraft(data: any): boolean {
  if (data === null || data === undefined) return true
  if (typeof data !== 'object') return !data
  for (const v of Object.values(data)) {
    if (v === null || v === undefined) continue
    if (Array.isArray(v)) {
      if (v.length > 0) return false
      continue
    }
    if (typeof v === 'object') {
      if (!isEmptyDraft(v)) return false
      continue
    }
    if (typeof v === 'string' && v.trim() !== '') return false
    if (typeof v === 'number' && v !== 0) return false
    if (typeof v === 'boolean' && v === true) return false
  }
  return true
}

/**
 * React hook for managing multiple drafts of a single form type.
 *
 * - `activeDraftId`: ID of the draft currently being edited (null = new unsaved form)
 * - `drafts`: list of all saved drafts (newest first), each with {id, savedAt, data}
 * - `save(data)`: debounced save — updates active draft, or creates a new one
 * - `restore(id)`: returns draft data, sets it as active
 * - `deleteDraft(id)`: removes a draft
 * - `clearActive()`: unsets the active draft (call after submit or explicit discard)
 * - `hasDrafts`: true if any drafts exist
 */
export function useDrafts<T>(formType: string) {
  const [drafts, setDrafts] = useState<DraftEnvelope<T>[]>([])
  const [activeDraftId, setActiveDraftId] = useState<string | null>(null)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  // Track whether the user has interacted with the form (to avoid saving the
  // initial empty state on mount, which would wipe an existing draft).
  const hasInteractedRef = useRef(false)
  // Track the data ref so we can save the latest data when the debounce fires
  const dataRef = useRef<T | null>(null)

  // Load drafts on mount + clean up orphaned old-version keys
  useEffect(() => {
    const store = read<T>(formType)
    setDrafts(store.drafts)
    // Clean up old single-draft keys from previous version (v1)
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
    setDrafts(store.drafts)
  }, [formType])

  const save = useCallback((data: T) => {
    // Mark as interacted (so subsequent saves are allowed even if form becomes empty)
    hasInteractedRef.current = true
    dataRef.current = data

    // Debounce
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => {
      const currentData = dataRef.current
      if (!currentData) return
      // Don't save empty drafts — and don't overwrite an existing draft with
      // empty data either. If the form is empty, just leave existing drafts alone.
      if (isEmptyDraft(currentData)) return

      const store = read<T>(formType)
      if (activeDraftId) {
        // Update existing draft
        const idx = store.drafts.findIndex((d) => d.id === activeDraftId)
        if (idx >= 0) {
          store.drafts[idx] = { ...store.drafts[idx], savedAt: Date.now(), data: currentData }
        } else {
          // Active draft was deleted elsewhere — create a new one
          const newDraft: DraftEnvelope<T> = {
            id: `d-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
            savedAt: Date.now(),
            data: currentData,
          }
          store.drafts.unshift(newDraft)
          setActiveDraftId(newDraft.id)
        }
      } else {
        // Create a new draft
        const newDraft: DraftEnvelope<T> = {
          id: `d-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          savedAt: Date.now(),
          data: currentData,
        }
        store.drafts.unshift(newDraft)
        setActiveDraftId(newDraft.id)
      }
      persist(store)
    }, 600)
  }, [formType, activeDraftId, persist])

  const restore = useCallback((id: string): T | null => {
    const store = read<T>(formType)
    const draft = store.drafts.find((d) => d.id === id)
    if (!draft) return null
    setActiveDraftId(id)
    hasInteractedRef.current = true
    return draft.data
  }, [formType])

  const deleteDraft = useCallback((id: string) => {
    const store = read<T>(formType)
    store.drafts = store.drafts.filter((d) => d.id !== id)
    persist(store)
    if (activeDraftId === id) {
      setActiveDraftId(null)
      hasInteractedRef.current = false
    }
  }, [formType, activeDraftId, persist])

  const clearActive = useCallback(() => {
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

  return {
    drafts,
    activeDraftId,
    save,
    restore,
    deleteDraft,
    clearActive,
    hasDrafts: drafts.length > 0,
  }
}

/**
 * Generate a human-readable label for a draft.
 * e.g. "3 items · ₹1,234 · Rahul General Store"
 */
export function getDraftLabel(data: any): string {
  const parts: string[] = []
  if (data?.items?.length > 0) {
    parts.push(`${data.items.length} item${data.items.length === 1 ? '' : 's'}`)
  }
  if (data?.partyName) {
    parts.push(data.partyName)
  } else if (data?.partyId) {
    parts.push('Party selected')
  }
  if (data?.invoiceNo) {
    parts.push(`#${data.invoiceNo}`)
  }
  if (data?.totalAmount) {
    parts.push(`₹${data.totalAmount}`)
  }
  return parts.length > 0 ? parts.join(' · ') : 'Empty draft'
}

/**
 * Calculate the total value of items in a draft (for display).
 */
export function getDraftTotal(data: any): number {
  if (!data?.items?.length) return 0
  return data.items.reduce((sum: number, item: any) => {
    const qty = Number(item.quantity) || 0
    const price = Number(item.unitPrice) || 0
    return sum + qty * price
  }, 0)
}
