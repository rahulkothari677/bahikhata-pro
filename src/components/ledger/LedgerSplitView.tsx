'use client'

/**
 * LedgerSplitView — desktop split-view wrapper for Sales/Purchase ledger.
 *
 * On desktop (lg+):
 *   Left:  Transaction list (Ledger component) — scrolls independently
 *   Right: Transaction detail (when one is selected) — sticky, auto-scrolls to top
 *   Divider between panels is draggable to resize.
 *
 * On mobile:
 *   Full-page navigation (unchanged — list → detail → back)
 *
 * Uses CSS flexbox with proper width calculation to avoid blank space
 * when the sidebar is collapsed/expanded. Scrollbars are styled thin
 * via the .thin-scrollbar utility class.
 */

import { useState, useEffect, useRef, useCallback } from 'react'
import { useAppStore } from '@/store/app-store'
import { Ledger } from '@/components/ledger/Ledger'
import { TransactionDetail } from '@/components/ledger/TransactionDetail'
import { X } from 'lucide-react'
import { cn } from '@/lib/utils'

export function LedgerSplitView({ type }: { type: 'sale' | 'purchase' }) {
  const { selectedTransactionId, setSelectedTransactionId, setPreviousView, currentView, selectedTransactionType } = useAppStore()
  const detailRef = useRef<HTMLDivElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const [leftWidth, setLeftWidth] = useState<number>(50) // percentage
  const isDragging = useRef(false)

  // Only show detail if:
  // 1. A transaction is selected
  // 2. We're on the sales or purchases view
  // 3. The selected transaction type matches the current ledger type
  //    (prevents a sale bill from showing in the purchase ledger and vice versa)
  const expectedType = type === 'sale' ? 'sale' : 'purchase'
  const showDetail = !!selectedTransactionId
    && (currentView === 'sales' || currentView === 'purchases')
    && (selectedTransactionType === expectedType)

  // Auto-scroll the detail panel to top when a new transaction is selected
  useEffect(() => {
    if (showDetail && detailRef.current) {
      detailRef.current.scrollTop = 0
    }
  }, [selectedTransactionId, showDetail])

  // Draggable divider
  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    isDragging.current = true
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'
  }, [])

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!isDragging.current || !containerRef.current) return
      const rect = containerRef.current.getBoundingClientRect()
      const pct = ((e.clientX - rect.left) / rect.width) * 100
      setLeftWidth(Math.min(75, Math.max(25, pct)))
    }

    const handleMouseUp = () => {
      if (isDragging.current) {
        isDragging.current = false
        document.body.style.cursor = ''
        document.body.style.userSelect = ''
      }
    }

    document.addEventListener('mousemove', handleMouseMove)
    document.addEventListener('mouseup', handleMouseUp)
    return () => {
      document.removeEventListener('mousemove', handleMouseMove)
      document.removeEventListener('mouseup', handleMouseUp)
    }
  }, [])

  return (
    <div ref={containerRef} className="flex h-full w-full">
      {/* Left: Ledger list — flex-1 so it auto-fills available space */}
      <div
        className={cn(
          'thin-scrollbar min-w-0 overflow-y-auto',
          showDetail
            ? 'hidden lg:block lg:overflow-y-auto'
            : 'w-full'
        )}
        style={showDetail ? { flex: `0 0 ${leftWidth}%` } : undefined}
      >
        <Ledger type={type} />
      </div>

      {/* Draggable divider */}
      {showDetail && (
        <div
          onMouseDown={handleMouseDown}
          className="hidden lg:block w-1 bg-border hover:bg-primary/40 cursor-col-resize flex-shrink-0 transition-colors relative group"
        >
          <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-0.5 h-10 bg-muted-foreground/20 group-hover:bg-primary/60 rounded-full transition-colors" />
        </div>
      )}

      {/* Right: Transaction detail — flex-1 so it auto-fills remaining space */}
      {showDetail && (
        <div
          className="fixed inset-0 z-50 bg-background lg:sticky lg:top-0 lg:z-auto lg:inset-auto thin-scrollbar lg:overflow-y-auto lg:h-[calc(100vh-3.5rem)]"
          style={{ flex: '1 1 0%' }}
          ref={detailRef}
        >
          {/* Close button bar */}
          <div className="sticky top-0 z-10 flex justify-end p-2 bg-background/80 backdrop-blur-sm border-b border-border/50">
            <button
              onClick={() => {
                setSelectedTransactionId(null)
                setPreviousView(null)
              }}
              className="p-1.5 rounded-lg hover:bg-muted text-muted-foreground"
              aria-label="Close detail"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
          <div className="p-4 pb-8">
            <TransactionDetail />
          </div>
        </div>
      )}
    </div>
  )
}
