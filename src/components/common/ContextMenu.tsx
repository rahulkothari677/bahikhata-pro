'use client'

/**
 * ContextMenu — right-click context menu for desktop.
 *
 * Shows a menu at cursor position with configurable actions.
 * Falls back to nothing on mobile (touch devices don't have right-click).
 *
 * Usage:
 *   <ContextMenu
 *     items={[
 *       { label: 'Edit', icon: Edit2, onClick: () => handleEdit() },
 *       { label: 'Delete', icon: Trash2, onClick: () => handleDelete(), danger: true },
 *     ]}
 *   >
 *     <div onContextMenu>...</div>
 *   </ContextMenu>
 *
 * Or use the useContextMenu hook + ContextMenuPortal for more control.
 */

import { useState, useEffect, useRef, type ReactNode } from 'react'
import { cn } from '@/lib/utils'

export interface ContextMenuItem {
  label: string
  icon?: any
  onClick: () => void
  danger?: boolean
  separator?: boolean
}

export function ContextMenu({
  items,
  children,
}: {
  items: ContextMenuItem[]
  children: ReactNode
}) {
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null)
  const ref = useRef<HTMLDivElement>(null)

  const handleContextMenu = (e: React.MouseEvent) => {
    // Only on non-touch devices (desktop)
    if (window.matchMedia('(pointer: coarse)').matches) return
    e.preventDefault()
    setMenu({ x: e.clientX, y: e.clientY })
  }

  // Close on outside click, scroll, or Escape
  useEffect(() => {
    if (!menu) return
    const close = () => setMenu(null)
    const handleEsc = (e: KeyboardEvent) => { if (e.key === 'Escape') setMenu(null) }
    document.addEventListener('click', close)
    document.addEventListener('scroll', close, true)
    document.addEventListener('keydown', handleEsc)
    return () => {
      document.removeEventListener('click', close)
      document.removeEventListener('scroll', close, true)
      document.removeEventListener('keydown', handleEsc)
    }
  }, [menu])

  // Adjust position if menu would go off-screen
  const adjustedX = menu ? Math.min(menu.x, window.innerWidth - 200) : 0
  const adjustedY = menu ? Math.min(menu.y, window.innerHeight - items.length * 40 - 20) : 0

  return (
    <div ref={ref} onContextMenu={handleContextMenu} className="contents">
      {children}
      {menu && (
        <div
          className="fixed z-[200] min-w-[180px] bg-popover border border-border rounded-lg shadow-lg overflow-hidden py-1"
          style={{ left: adjustedX, top: adjustedY }}
          onClick={(e) => e.stopPropagation()}
        >
          {items.map((item, i) => {
            if (item.separator) {
              return <div key={i} className="h-px bg-border my-1" />
            }
            const Icon = item.icon
            return (
              <button
                key={i}
                onClick={() => {
                  item.onClick()
                  setMenu(null)
                }}
                className={cn(
                  'w-full flex items-center gap-2.5 px-3 py-2 text-sm text-left transition hover:bg-muted',
                  item.danger && 'text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/30'
                )}
              >
                {Icon && <Icon className="w-4 h-4 flex-shrink-0" />}
                <span>{item.label}</span>
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}
