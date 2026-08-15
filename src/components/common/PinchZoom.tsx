'use client'

/**
 * Pinch, drag and double-tap to zoom — for content the page will not zoom for you.
 *
 * 🎨 2026-08-15. Rahul: "there should be pinch zoom feature … in the preview
 * section too so user can see properly."
 *
 * WHY THIS HAS TO BE WRITTEN BY HAND. The app sets `userScalable: false` and
 * `maximumScale: 1` in its viewport meta (app/layout.tsx), which is the right
 * call for an app shell — it stops a mistimed double-tap zooming the whole UI
 * on Android. But it also switches off the browser's own pinch everywhere,
 * including on the one thing a shopkeeper genuinely needs to look at closely: a
 * scaled-down page of numbers.
 *
 * So this implements the gesture for one element rather than re-enabling it for
 * the entire app.
 *
 * WHAT IT HANDLES, and why each one is here:
 *   · two-finger pinch — the gesture people reach for
 *   · one-finger drag while zoomed — otherwise you can magnify a corner and
 *     never reach the rest
 *   · double-tap — the shortcut most people actually use on a phone
 *   · ctrl/⌘ + wheel, and plain wheel-to-pan — because this screen is used on
 *     desktop too, where there is no pinch at all
 *
 * It deliberately does NOT capture ordinary one-finger drags at rest, so the
 * page behind it still scrolls normally. Zoom in first, then pan.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { ZoomIn, RotateCcw } from 'lucide-react'
import { cn } from '@/lib/utils'

const MIN_SCALE = 1
const MAX_SCALE = 4
const DOUBLE_TAP_SCALE = 2.2
const DOUBLE_TAP_MS = 300

interface Point { x: number; y: number }

export function PinchZoom({
  children,
  className,
  /** Announced to screen readers, e.g. "invoice preview". */
  label = 'content',
}: {
  children: React.ReactNode
  className?: string
  label?: string
}) {
  const hostRef = useRef<HTMLDivElement>(null)
  const [scale, setScale] = useState(1)
  const [offset, setOffset] = useState<Point>({ x: 0, y: 0 })

  /** Live pointers, so a pinch can be told from a drag without guessing. */
  const pointers = useRef(new Map<number, Point>())
  const pinchStart = useRef<{ dist: number; scale: number } | null>(null)
  const dragStart = useRef<{ p: Point; offset: Point } | null>(null)
  const lastTap = useRef(0)
  /*
   * Whether a gesture is in flight, as STATE rather than a ref read during
   * render. Reading `pinchStart.current` in the style below was a real lint
   * error ("Cannot access refs during render") and a real bug underneath it:
   * a ref mutation does not re-render, so the transition would have been
   * whatever the previous render happened to see.
   */
  const [gesturing, setGesturing] = useState(false)

  const zoomed = scale > 1.01

  /**
   * Keep the content from being dragged off screen.
   *
   * The travel available in each axis is however much the scaled content
   * overflows its box; at scale 1 that is zero, which is what pins it home.
   */
  const clamp = useCallback((next: Point, atScale: number): Point => {
    const el = hostRef.current
    if (!el) return next
    const { width, height } = el.getBoundingClientRect()
    const maxX = Math.max(0, (width * atScale - width) / 2)
    const maxY = Math.max(0, (height * atScale - height) / 2)
    return {
      x: Math.min(maxX, Math.max(-maxX, next.x)),
      y: Math.min(maxY, Math.max(-maxY, next.y)),
    }
  }, [])

  const reset = useCallback(() => {
    setScale(1)
    setOffset({ x: 0, y: 0 })
  }, [])

  const applyScale = useCallback((next: number) => {
    const clamped = Math.min(MAX_SCALE, Math.max(MIN_SCALE, next))
    setScale(clamped)
    setOffset(o => clamp(o, clamped))
  }, [clamp])

  // ── pointer handling ───────────────────────────────────────────────
  const onPointerDown = (e: React.PointerEvent) => {
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY })

    if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()]
      pinchStart.current = { dist: Math.hypot(a.x - b.x, a.y - b.y), scale }
      dragStart.current = null
      setGesturing(true)
      return
    }

    // Double tap. Checked before the drag branch so a quick second tap is not
    // read as the start of a pan.
    const now = Date.now()
    if (now - lastTap.current < DOUBLE_TAP_MS) {
      lastTap.current = 0
      if (zoomed) reset()
      else applyScale(DOUBLE_TAP_SCALE)
      return
    }
    lastTap.current = now

    // Only claim the drag once zoomed — at rest the page must still scroll.
    if (zoomed) {
      dragStart.current = { p: { x: e.clientX, y: e.clientY }, offset }
      setGesturing(true)
      ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
    }
  }

  const onPointerMove = (e: React.PointerEvent) => {
    if (!pointers.current.has(e.pointerId)) return
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY })

    if (pointers.current.size === 2 && pinchStart.current) {
      const [a, b] = [...pointers.current.values()]
      const dist = Math.hypot(a.x - b.x, a.y - b.y)
      if (pinchStart.current.dist > 0) {
        applyScale(pinchStart.current.scale * (dist / pinchStart.current.dist))
      }
      e.preventDefault()
      return
    }

    if (dragStart.current) {
      const dx = e.clientX - dragStart.current.p.x
      const dy = e.clientY - dragStart.current.p.y
      setOffset(clamp(
        { x: dragStart.current.offset.x + dx, y: dragStart.current.offset.y + dy },
        scale,
      ))
      e.preventDefault()
    }
  }

  const endPointer = (e: React.PointerEvent) => {
    pointers.current.delete(e.pointerId)
    if (pointers.current.size < 2) pinchStart.current = null
    if (pointers.current.size === 0) {
      dragStart.current = null
      setGesturing(false)
    }
  }

  /*
   * Desktop. Registered natively rather than as a React prop because the
   * listener has to be non-passive to preventDefault the browser's own
   * ctrl+wheel page zoom, and React attaches wheel handlers passively.
   */
  useEffect(() => {
    const el = hostRef.current
    if (!el) return
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return
      e.preventDefault()
      applyScale(scale * (e.deltaY < 0 ? 1.12 : 1 / 1.12))
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [scale, applyScale])

  return (
    <div className={cn('relative', className)}>
      <div
        ref={hostRef}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endPointer}
        onPointerCancel={endPointer}
        onPointerLeave={endPointer}
        role="img"
        aria-label={`${label} — pinch or double-tap to zoom`}
        className="overflow-hidden select-none"
        style={{
          // `pinch-zoom` lets the browser help where it can; `none` while
          // zoomed stops the page scrolling under a pan.
          touchAction: zoomed ? 'none' : 'pinch-zoom',
          cursor: zoomed ? 'grab' : 'zoom-in',
        }}
      >
        <div
          style={{
            transform: `translate(${offset.x}px, ${offset.y}px) scale(${scale})`,
            transformOrigin: 'center center',
            // No transition during a gesture: the content must track the
            // fingers, not lag behind them.
            transition: gesturing ? 'none' : 'transform 160ms ease-out',
          }}
        >
          {children}
        </div>
      </div>

      {/* The hint, and the way back. A gesture nobody knows about is a feature
          nobody has — but the hint disappears once they have used it. */}
      {zoomed ? (
        <button
          type="button"
          onClick={reset}
          className="absolute top-2 right-2 inline-flex items-center gap-1.5 rounded-full bg-background/90 backdrop-blur border border-border px-3 h-9 text-2xs font-medium shadow-sm"
        >
          <RotateCcw className="w-3.5 h-3.5" /> Reset
        </button>
      ) : (
        <span className="pointer-events-none absolute bottom-2 right-2 inline-flex items-center gap-1 rounded-full bg-background/80 backdrop-blur border border-border/60 px-2 py-1 text-3xs text-muted-foreground">
          <ZoomIn className="w-3 h-3" /> Pinch to zoom
        </span>
      )}
    </div>
  )
}
