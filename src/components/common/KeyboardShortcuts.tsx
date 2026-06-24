'use client'

import { useEffect } from 'react'
import { useAppStore } from '@/store/app-store'

export function KeyboardShortcuts() {
  const { features, setView, setPreviousView, setSearchOpen, currentView, fireTriggerNewEntry } = useAppStore()

  useEffect(() => {
    if (!features.keyboardShortcuts) return

    const handler = (e: KeyboardEvent) => {
      // Skip if typing in input/textarea/select
      const target = e.target as HTMLElement
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT') {
        // Allow Escape to blur
        if (e.key === 'Escape') {
          target.blur()
        }
        return
      }

      // Ctrl/Cmd + K → Global Search
      if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
        e.preventDefault()
        if (features.globalSearch) setSearchOpen(true)
        return
      }

      // Escape → close search or go back
      if (e.key === 'Escape') {
        const { searchOpen, setSelectedTransactionId, setSelectedPartyId } = useAppStore.getState()
        if (searchOpen) {
          setSearchOpen(false)
          return
        }
        if (currentView === 'transaction-detail' || currentView === 'party-profile' || currentView === 'new-sale' || currentView === 'new-purchase') {
          const { previousView, setPreviousView } = useAppStore.getState()
          setView(previousView || 'dashboard')
          setPreviousView(null)
          setSelectedTransactionId(null)
          setSelectedPartyId(null)
        }
        return
      }

      // N → New entry (context-aware)
      if (e.key === 'n' || e.key === 'N') {
        e.preventDefault()
        if (currentView === 'dashboard' || currentView === 'sales') {
          setPreviousView(currentView)
          setView('new-sale')
        } else if (currentView === 'purchases') {
          setPreviousView('purchases')
          setView('new-purchase')
        } else if (currentView === 'inventory' || currentView === 'parties' || currentView === 'income-expense') {
          fireTriggerNewEntry()
        }
        return
      }

      // D → Dashboard
      if (e.key === 'd' || e.key === 'D') {
        e.preventDefault()
        setView('dashboard')
        return
      }

      // I → Inventory
      if (e.key === 'i' || e.key === 'I') {
        e.preventDefault()
        setView('inventory')
        return
      }

      // S → Sales
      if (e.key === 's' || e.key === 'S') {
        e.preventDefault()
        setView('sales')
        return
      }

      // P → Purchases
      if (e.key === 'p' || e.key === 'P') {
        e.preventDefault()
        setView('purchases')
        return
      }

      // A → AI Scanner
      if (e.key === 'a' || e.key === 'A') {
        e.preventDefault()
        setView('scanner')
        return
      }

      // R → Reports
      if (e.key === 'r' || e.key === 'R') {
        e.preventDefault()
        setView('reports')
        return
      }

      // / → Focus search (dispatch custom event that pages listen to)
      if (e.key === '/') {
        e.preventDefault()
        window.dispatchEvent(new CustomEvent('focus-search'))
        return
      }
    }

    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [features.keyboardShortcuts, features.globalSearch, currentView, setView, setPreviousView, setSearchOpen, fireTriggerNewEntry])

  return null
}
