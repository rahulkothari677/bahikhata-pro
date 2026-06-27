'use client'

/**
 * Multi-draft manager for form autosave.
 *
 * Supports MULTIPLE drafts per form type (e.g. many sale drafts, many purchase drafts).
 * Each draft has a unique ID and timestamp. Drafts auto-expire after 24 hours.
 *
 * IMPORTANT DESIGN: The `save` callback uses a REF for activeDraftId (not state)
 * so it never needs to be recreated. This prevents stale closure bugs where
 * restore/create operations race with the autosave useEffect.
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
    const now = Date.now()
    s.drafts = s.drafts.filter((d) => now - d.savedAt < DRAFT_TTL_MS)
    s.drafts.sort((a, b) => b.savedAt - a.savedAt)
    return s
  } catch {
    return { v: DRAFT_VERSION, drafts: [] }
  }
}

function write<T>(formType: string, store: Store<T>) {
  if (typeof window === 'undefined') return
  try {
    store.drafts = store.drafts.slice(0, MAX_DRAFTS)
    localStorage.setItem(key(formType), JSON.stringify(store))
  } catch {
    // silent
  }
}

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
          // Active draft was deleted — create a new one
          const newDraft: DraftEnvelope<T> = { id: genId(), savedAt: Date.now(), data: currentData }
          store.drafts.unshift(newDraft)
          activeDraftIdRef.current = newDraft.id
          setActiveDraftId(newDraft.id)
        }
      } else {
        // Create a new draft
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
  return parts.length > 0 ? parts.join(' · ') : 'Empty draft'
}

export function getDraftTotal(data: any): number {
  if (!data?.items?.length) return 0
  return data.items.reduce((sum: number, item: any) => {
    const qty = Number(item.quantity) || 0
    const price = Number(item.unitPrice) || 0
    return sum + qty * price
  }, 0)
}
