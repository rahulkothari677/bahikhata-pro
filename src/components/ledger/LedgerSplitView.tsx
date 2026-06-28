'use client'

/**
 * LedgerSplitView — desktop split-view wrapper for Sales/Purchase ledger.
 *
 * On desktop (lg+):
 *   Left:  Transaction list (Ledger component) — scrolls independently
 *   Right: Transaction detail (when one is selected) — sticky, auto-scrolls to top
 *
 * On mobile:
 *   Full-page navigation (unchanged — list → detail → back)
 *
 * The right panel is sticky (position: sticky; top: 0) so it stays in
 * view regardless of where the user scrolled in the left list.
 * When a new transaction is selected, the right panel auto-scrolls to top.
 */

import { useState, useEffect, useRef } from 'react'
import { useAppStore } from '@/store/app-store'
import { Ledger } from '@/components/ledger/Ledger'
import { TransactionDetail } from '@/components/ledger/TransactionDetail'
import { X } from 'lucide-react'
import { cn } from '@/lib/utils'

export function LedgerSplitView({ type }: { type: 'sale' | 'purchase' }) {
  const { selectedTransactionId, setSelectedTransactionId, setView, setPreviousView, currentView } = useAppStore()
  const detailRef = useRef<HTMLDivElement>(null)

  // On desktop, if a transaction is selected, show split view
  const showDetail = !!selectedTransactionId && (currentView === 'sales' || currentView === 'purchases')

  // Auto-scroll the detail panel to top when a new transaction is selected
  useEffect(() => {
    if (showDetail && detailRef.current) {
      detailRef.current.scrollTop = 0
    }
  }, [selectedTransactionId, showDetail])

  return (
    <div className="flex gap-4 lg:gap-0">
      {/* Left: Ledger list — full width on mobile, half on desktop when detail is open */}
      <div className={cn(
        'flex-1 min-w-0',
        showDetail && 'hidden lg:block lg:flex-1 lg:border-r lg:border-border lg:pr-4'
      )}>
        <Ledger type={type} />
      </div>

      {/* Right: Transaction detail — full page on mobile, sticky on desktop */}
      {showDetail && (
        <div className="fixed inset-0 z-50 bg-background lg:sticky lg:top-0 lg:z-auto lg:flex-1 lg:inset-auto lg:pl-4 lg:h-[calc(100vh-4rem)] lg:overflow-y-auto"
          ref={detailRef}
        >
          {/* Close button — desktop only (mobile uses browser back) */}
          <button
            onClick={() => {
              setSelectedTransactionId(null)
              setPreviousView(null)
            }}
            className="hidden lg:flex sticky top-0 right-0 z-10 ml-auto p-2 rounded-lg hover:bg-muted text-muted-foreground bg-background/80 backdrop-blur-sm"
            aria-label="Close detail"
          >
            <X className="w-5 h-5" />
          </button>
          <TransactionDetail />
        </div>
      )}
    </div>
  )
}
