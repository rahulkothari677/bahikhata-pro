'use client'

import { useAppStore } from '@/store/app-store'
import { Plus } from 'lucide-react'
import { haptic } from '@/lib/haptic'

/**
 * FloatingActionButton — always-visible "+" button for quick New Sale.
 * Shows on mobile only (lg:hidden).
 * Positioned above the bottom nav, bottom-right.
 * Hidden on: new-sale, new-purchase, transaction-detail, party-profile, more, scanner
 */
export function FloatingActionButton() {
  const { currentView, setView, setPreviousView } = useAppStore()

  const hideOn = ['new-sale', 'new-purchase', 'transaction-detail', 'party-profile', 'more', 'scanner', 'pricing']
  if (hideOn.includes(currentView)) return null

  return (
    <button
      onClick={() => {
        haptic.medium()
        setPreviousView(currentView)
        setView('new-sale')
      }}
      className="lg:hidden fixed bottom-20 right-4 z-40 w-14 h-14 rounded-full bg-gradient-saffron text-white shadow-xl shadow-primary/40 flex items-center justify-center active:scale-90 transition-transform"
      aria-label="New Sale"
    >
      <Plus className="w-7 h-7" strokeWidth={2.5} />
    </button>
  )
}
