'use client'

/**
 * LedgerSplitView — desktop split-view wrapper for Sales/Purchase ledger.
 *
 * On desktop (lg+):
 *   Left:  Transaction list (Ledger component)
 *   Right: Transaction detail (when one is selected)
 *
 * On mobile:
 *   Full-page navigation (unchanged — list → detail → back)
 *
 * This eliminates back-and-forth clicking on desktop — the ultimate
 * productivity boost for shop owners reviewing transactions.
 */

import { useState, useEffect } from 'react'
import { useAppStore } from '@/store/app-store'
import { Ledger } from '@/components/ledger/Ledger'
import { TransactionDetail } from '@/components/ledger/TransactionDetail'
import { X } from 'lucide-react'
import { cn } from '@/lib/utils'

export function LedgerSplitView({ type }: { type: 'sale' | 'purchase' }) {
  const { selectedTransactionId, setSelectedTransactionId, setView, setPreviousView, currentView } = useAppStore()

  // On desktop, if a transaction is selected, show split view
  const showDetail = !!selectedTransactionId && (currentView === 'sales' || currentView === 'purchases')

  return (
    <div className="flex gap-4 lg:gap-0">
      {/* Left: Ledger list — full width on mobile, half on desktop when detail is open */}
      <div className={cn(
        'flex-1 min-w-0',
        showDetail && 'hidden lg:block lg:flex-1 lg:border-r lg:border-border lg:pr-4'
      )}>
        <Ledger type={type} />
      </div>

      {/* Right: Transaction detail — full page on mobile, half on desktop */}
      {showDetail && (
        <div className="fixed inset-0 z-50 bg-background lg:relative lg:z-auto lg:flex-1 lg:inset-auto lg:pl-4 overflow-y-auto">
          {/* Close button — desktop only (mobile uses browser back) */}
          <button
            onClick={() => {
              setSelectedTransactionId(null)
              setPreviousView(null)
            }}
            className="hidden lg:flex absolute top-4 right-4 z-10 p-2 rounded-lg hover:bg-muted text-muted-foreground"
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
