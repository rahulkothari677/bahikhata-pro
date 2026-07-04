'use client'

/**
 * useAutosaveDraft — autosave form state to localStorage so users don't lose
 * data on accidental refresh, back button, or app crash.
 *
 * Features:
 * - Debounced save (500ms after last change)
 * - Versioned keys (so schema changes don't load stale data)
 * - Expiry after 24h (so abandoned drafts don't linger forever)
 * - Restore on mount (with confirmation if there's something to restore)
 * - Clear on successful save
 *
 * Usage:
 *   const { draft, restoreDraft, clearDraft, hasDraft } = useAutosaveDraft(
 *     'sale-entry',
 *     { items: [], partyId: '', notes: '' }
 *   )
 *
 *   // Auto-saves whenever `form` changes
 *   useEffect(() => {
 *     saveDraft(form)
 *   }, [form])
 */

import { useState, useEffect, useCallback, useRef } from 'react'

const DRAFT_VERSION = 1
const DRAFT_TTL_MS = 24 * 60 * 60 * 1000 // 24 hours

type DraftEnvelope<T> = {
  v: number
  savedAt: number
  data: T
}

function key(id: string) {
  return `bahikhata:draft:${id}:v${DRAFT_VERSION}`
}

/**
 * Save a draft to localStorage (debounced by caller).
 */
export function saveDraft<T>(id: string, data: T): void {
  if (typeof window === 'undefined') return
  try {
    // Don't save empty/trivial drafts
    if (isEmptyDraft(data)) {
      clearDraft(id)
      return
    }
    const envelope: DraftEnvelope<T> = {
      v: DRAFT_VERSION,
      savedAt: Date.now(),
      data,
    }
    localStorage.setItem(key(id), JSON.stringify(envelope))
  } catch {
    // localStorage might be full or disabled — silent fail
  }
}

/**
 * Load a draft from localStorage. Returns null if missing, expired, or invalid.
 */
export function loadDraft<T>(id: string): T | null {
  if (typeof window === 'undefined') return null
  try {
    const raw = localStorage.getItem(key(id))
    if (!raw) return null
    const envelope = JSON.parse(raw) as DraftEnvelope<T>
    if (envelope.v !== DRAFT_VERSION) {
      clearDraft(id)
      return null
    }
    // Check expiry
    if (Date.now() - envelope.savedAt > DRAFT_TTL_MS) {
      clearDraft(id)
      return null
    }
    return envelope.data
  } catch {
    return null
  }
}

/**
 * Clear a draft from localStorage. Called after successful form submission.
 */
export function clearDraft(id: string): void {
  if (typeof window === 'undefined') return
  try {
    localStorage.removeItem(key(id))
  } catch {
    // silent
  }
}

/**
 * Heuristic: detect "empty" drafts so we don't pollute localStorage.
 * A draft is empty if:
 *   - All string fields are empty
 *   - All array fields are empty
 *   - All numeric fields are 0
 *   - All boolean fields are false
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
 * React hook that manages a draft lifecycle.
 *
 * - On mount: checks localStorage for an existing draft.
 * - `saveDraft(data)`: debounced save (caller decides what to save).
 * - `restoreDraft()`: returns the saved draft (or null).
 * - `clearDraft()`: removes the draft (call after successful submit).
 * - `hasDraft`: boolean indicating if a restorable draft exists.
 * - `savedAt`: timestamp of last save (for "Restored from X minutes ago" UI).
 */
export function useAutosaveDraft<T>(id: string) {
  const [hasDraft, setHasDraft] = useState(false)
  const [savedAt, setSavedAt] = useState<number | null>(null)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (typeof window === 'undefined') return
    try {
      const raw = localStorage.getItem(key(id))
      if (!raw) return
      const envelope = JSON.parse(raw) as DraftEnvelope<T>
      if (envelope.v !== DRAFT_VERSION) {
        clearDraft(id)
        return
      }
      if (Date.now() - envelope.savedAt > DRAFT_TTL_MS) {
        clearDraft(id)
        return
      }
      setHasDraft(true)
      setSavedAt(envelope.savedAt)
    } catch {
      // silent
    }
  }, [id])

  const save = useCallback((data: T) => {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => {
      saveDraft(id, data)
      setHasDraft(true)
      setSavedAt(Date.now())
    }, 500)
  }, [id])

  const restore = useCallback((): T | null => {
    return loadDraft<T>(id)
  }, [id])

  const clear = useCallback(() => {
    clearDraft(id)
    setHasDraft(false)
    setSavedAt(null)
  }, [id])

  return {
    saveDraft: save,
    restoreDraft: restore,
    clearDraft: clear,
    hasDraft,
    savedAt,
  }
}
