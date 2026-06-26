'use client'

/**
 * SwipeToDelete — mobile-friendly swipe-to-delete wrapper.
 *
 * On touch devices: swipe left to reveal a red "Delete" button.
 * On desktop: shows a small trash icon button on hover (top-right corner).
 *
 * Usage:
 *   <SwipeToDelete onDelete={() => handleDelete(item.id)}>
 *     <YourCardContent />
 *   </SwipeToDelete>
 *
 * The wrapper takes the full width of its parent. The child content should
 * be a Card or similar block element.
 */

import { useState, useRef, type ReactNode } from 'react'
import { Trash2 } from 'lucide-react'
import { cn } from '@/lib/utils'

interface SwipeToDeleteProps {
  children: ReactNode
  onDelete: () => void
  /** Confirmation message before delete. If omitted, deletes immediately. */
  confirmMessage?: string
  className?: string
}

export function SwipeToDelete({
  children,
  onDelete,
  confirmMessage,
  className,
}: SwipeToDeleteProps) {
  const [dragX, setDragX] = useState(0)
  const [showDesktopDelete, setShowDesktopDelete] = useState(false)
  const startX = useRef<number | null>(null)
  const dragging = useRef(false)

  const DELETE_THRESHOLD = 80 // px to swipe before delete action triggers

  const handleTouchStart = (e: React.TouchEvent) => {
    startX.current = e.touches[0].clientX
    dragging.current = true
  }

  const handleTouchMove = (e: React.TouchEvent) => {
    if (!dragging.current || startX.current === null) return
    const delta = e.touches[0].clientX - startX.current
    // Only allow left swipe (negative delta)
    if (delta < 0) {
      setDragX(Math.max(delta, -120))
    }
  }

  const handleTouchEnd = () => {
    dragging.current = false
    if (dragX < -DELETE_THRESHOLD) {
      // Snap to delete position (show button)
      setDragX(-80)
    } else {
      // Snap back
      setDragX(0)
    }
  }

  const handleDelete = () => {
    if (confirmMessage) {
      if (!confirm(confirmMessage)) {
        setDragX(0)
        return
      }
    }
    onDelete()
  }

  return (
    <div
      className={cn('relative overflow-hidden rounded-xl', className)}
      onMouseEnter={() => setShowDesktopDelete(true)}
      onMouseLeave={() => setShowDesktopDelete(false)}
    >
      {/* Delete button behind content (revealed on swipe left) */}
      <button
        onClick={handleDelete}
        className="absolute inset-y-0 right-0 flex items-center justify-center bg-red-600 text-white px-6 transition-opacity"
        style={{ opacity: dragX < -20 ? 1 : 0 }}
        aria-label="Delete"
      >
        <Trash2 className="w-5 h-5" />
      </button>

      {/* Desktop hover delete button (top-right corner, doesn't need swipe) */}
      {showDesktopDelete && (
        <button
          onClick={handleDelete}
          className="absolute top-2 right-2 z-10 p-1.5 rounded-lg bg-red-600 text-white shadow-md hover:bg-red-700 transition lg:flex hidden items-center gap-1 text-xs"
          aria-label="Delete"
        >
          <Trash2 className="w-3.5 h-3.5" />
        </button>
      )}

      {/* Draggable content */}
      <div
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
        style={{
          transform: `translateX(${dragX}px)`,
          transition: dragging.current ? 'none' : 'transform 0.2s ease-out',
        }}
        className="relative z-0 bg-card"
      >
        {children}
      </div>
    </div>
  )
}
