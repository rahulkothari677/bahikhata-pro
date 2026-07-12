'use client'

import { useEffect, useState, useRef } from 'react'

/**
 * Premium Splash Screen (V20-019)
 *
 * Redesigned for a premium, interactive feel — not an ordinary app vibe.
 *
 * Visual design:
 * - Animated gradient background (saffron → amber, slowly shifting)
 * - 3 floating particle accents (subtle, premium ambiance)
 * - Logo assembly: book pages scale in with blur-to-focus, checkmark draws
 *   last via SVG stroke-dashoffset animation
 * - Continuous shimmer sweep across the logo (light reflection effect)
 * - Glow pulse behind the logo (breathing effect)
 * - Brand name "EkBook" — letters rise into place with stagger (premium reveal)
 * - Tagline fade-in
 * - Progress bar at the bottom (data-driven, not time-driven)
 *
 * Data-driven dismissal (auditor §2.4):
 * - Old: fixed 1.1s timer (800ms display + 300ms fade)
 * - New: dismiss as soon as `ready` prop is true (session + dashboard loaded)
 *   OR after a 1.8s max fallback (whichever comes first)
 * - The `ready` prop is passed from page.tsx, which knows when status ===
 *   'authenticated' AND dashboardData !== undefined
 * - Min display time: 900ms (ensures the logo animation completes — dismissing
 *   mid-animation looks broken)
 * - Exit animation: scale up + fade out (feels like the app "opens" from splash)
 *
 * Performance:
 * - All animations are CSS-only (no JS animation loops)
 * - Respects prefers-reduced-motion (disables non-essential animations)
 * - No external libraries (no framer-motion for the splash — keeps it lightweight)
 *
 * 🔒 V20-019 FIX: Combines the auditor's §2.4 data-driven recommendation
 * with a premium visual redesign. The old splash was a flat gradient + static
 * SVG + fixed timer. This version is multi-stage, interactive, and dismisses
 * the moment the app is ready.
 */

const MIN_DISPLAY_MS = 900   // minimum time before dismiss (lets logo animation complete)
const MAX_DISPLAY_MS = 1800  // hard fallback — never wait longer than this
const EXIT_ANIMATION_MS = 400

export function SplashScreen({
  onFinish,
  ready = false,
}: {
  onFinish: () => void
  /**
   * `ready` = true when the app is ready to show (session resolved + dashboard
   * data loaded). The splash dismisses as soon as ready=true AND the minimum
   * display time has elapsed. If ready never becomes true, the max fallback
   * kicks in.
   */
  ready?: boolean
}) {
  const [exiting, setExiting] = useState(false)
  const startTimeRef = useRef(Date.now())
  const finishedRef = useRef(false)

  // ─── Exit handler ─────────────────────────────────────────────────────
  // Triggers the exit animation, then calls onFinish after it completes.
  // Guarded by finishedRef so it can only run once (prevents double-exit
  // if both the minTimer and the ready-listener try to fire).
  function triggerExit() {
    if (finishedRef.current) return
    finishedRef.current = true
    setExiting(true)
    // Call onFinish after the exit animation completes
    setTimeout(() => {
      onFinish()
    }, EXIT_ANIMATION_MS)
  }

  useEffect(() => {
    startTimeRef.current = Date.now()

    // ─── Min display timer ──────────────────────────────────────────────
    // Ensures the logo assembly animation (1s) completes before dismissal.
    // Dismissing mid-animation looks broken/janky.
    const minTimer = setTimeout(() => {
      if (ready && !finishedRef.current) {
        triggerExit()
      }
    }, MIN_DISPLAY_MS)

    // ─── Max fallback timer ─────────────────────────────────────────────
    // If the app takes longer than 1.8s to load (slow network, cold Neon),
    // dismiss anyway. The user shouldn't wait indefinitely for a splash.
    const maxTimer = setTimeout(() => {
      if (!finishedRef.current) {
        triggerExit()
      }
    }, MAX_DISPLAY_MS)

    return () => {
      clearTimeout(minTimer)
      clearTimeout(maxTimer)
    }
  }, [])

  // ─── Ready listener ───────────────────────────────────────────────────
  // When `ready` becomes true (app loaded), check if min display time has
  // elapsed. If yes, dismiss immediately. If no, the minTimer above will
  // dismiss when it fires.
  useEffect(() => {
    if (ready && !exiting && !finishedRef.current) {
      const elapsed = Date.now() - startTimeRef.current
      if (elapsed >= MIN_DISPLAY_MS) {
        triggerExit()
      }
      // else: minTimer will handle it
    }
  }, [ready])

  // ─── Split "EkBook" into letters for staggered reveal ─────────────────
  const brandLetters = 'EkBook'.split('')

  return (
    <div
      className={`fixed inset-0 z-[9999] flex flex-col items-center justify-center overflow-hidden animate-splash-gradient ${
        exiting ? 'animate-splash-exit' : ''
      }`}
      style={{
        background: 'linear-gradient(135deg, #FF9933 0%, #D97706 40%, #B45309 80%, #92400E 100%)',
      }}
      aria-label="EkBook loading"
      role="status"
    >
      {/* ─── Floating particles (ambient ambiance) ─────────────────────── */}
      <div className="absolute inset-0 pointer-events-none" aria-hidden="true">
        <div className="absolute bottom-1/4 left-1/3 w-1.5 h-1.5 rounded-full bg-white/40 animate-splash-particle-1" />
        <div className="absolute bottom-1/3 right-1/3 w-1 h-1 rounded-full bg-white/30 animate-splash-particle-2" />
        <div className="absolute bottom-1/4 left-2/5 w-2 h-2 rounded-full bg-amber-200/30 animate-splash-particle-3" />
      </div>

      {/* ─── Glow halo behind the logo ─────────────────────────────────── */}
      <div className="absolute w-48 h-48 rounded-full bg-white/20 blur-3xl animate-splash-glow" aria-hidden="true" />

      {/* ─── Logo assembly ─────────────────────────────────────────────── */}
      <div className="relative mb-8 animate-splash-logo-premium">
        {/* Shimmer sweep overlay (light reflection effect) */}
        <div className="absolute inset-0 overflow-hidden rounded-full pointer-events-none" aria-hidden="true">
          <div className="absolute top-0 left-0 w-1/3 h-full bg-gradient-to-r from-transparent via-white/40 to-transparent animate-splash-shimmer" />
        </div>

        <svg
          width="128"
          height="128"
          viewBox="0 0 512 512"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
          className="relative z-10 drop-shadow-2xl"
        >
          {/* Left page — opens from center */}
          <path
            d="M256 160 L256 376 L160 340 L160 124 Z"
            fill="#FFFFFF"
            opacity="0.95"
          />
          {/* Right page — opens from center */}
          <path
            d="M256 160 L256 376 L352 340 L352 124 Z"
            fill="#FFFFFF"
            opacity="0.95"
          />
          {/* Book spine */}
          <line
            x1="256"
            y1="160"
            x2="256"
            y2="376"
            stroke="#D97706"
            strokeWidth="4"
            opacity="0.3"
          />
          {/* Ledger lines left */}
          <line x1="180" y1="160" x2="240" y2="170" stroke="#D97706" strokeWidth="3" opacity="0.4" />
          <line x1="180" y1="180" x2="240" y2="190" stroke="#D97706" strokeWidth="3" opacity="0.4" />
          <line x1="180" y1="200" x2="240" y2="210" stroke="#D97706" strokeWidth="3" opacity="0.4" />
          {/* Ledger lines right */}
          <line x1="272" y1="170" x2="332" y2="160" stroke="#D97706" strokeWidth="3" opacity="0.4" />
          <line x1="272" y1="190" x2="332" y2="180" stroke="#D97706" strokeWidth="3" opacity="0.4" />
          <line x1="272" y1="210" x2="332" y2="200" stroke="#D97706" strokeWidth="3" opacity="0.4" />
          {/* Rupee symbol */}
          <text
            x="200"
            y="290"
            fontFamily="Arial, sans-serif"
            fontSize="48"
            fontWeight="bold"
            fill="#D97706"
            opacity="0.6"
          >
            ₹
          </text>
          {/* Checkmark — draws in last via stroke-dashoffset animation */}
          <path
            d="M285 280 L300 295 L330 265"
            stroke="#10B981"
            strokeWidth="6"
            strokeLinecap="round"
            strokeLinejoin="round"
            fill="none"
            className="animate-splash-checkmark"
          />
        </svg>
      </div>

      {/* ─── Brand name — letters rise into place with stagger ─────────── */}
      <h1 className="text-5xl font-bold text-white tracking-tight flex" aria-label="EkBook">
        {brandLetters.map((letter, i) => (
          <span
            key={i}
            className="animate-splash-letter"
            style={{
              animationDelay: `${0.4 + i * 0.08}s`,
              textShadow: '0 4px 20px rgba(0,0,0,0.25)',
            }}
          >
            {letter}
          </span>
        ))}
      </h1>

      {/* ─── Tagline ───────────────────────────────────────────────────── */}
      <p className="text-sm text-white/85 mt-3 animate-splash-tagline tracking-wide font-medium">
        India&apos;s Smartest Ledger App
      </p>

      {/* ─── Progress bar (data-driven, not time-driven) ───────────────── */}
      <div className="absolute bottom-20 left-1/2 -translate-x-1/2 w-48 h-1 bg-white/20 rounded-full overflow-hidden">
        <div
          className="h-full bg-white/80 rounded-full animate-splash-progress"
          style={{
            width: ready ? '100%' : undefined,
          }}
        />
      </div>

      {/* ─── Status text ───────────────────────────────────────────────── */}
      <p className="absolute bottom-12 left-1/2 -translate-x-1/2 text-xs text-white/60 tracking-wider">
        {ready ? 'Ready' : 'Loading…'}
      </p>
    </div>
  )
}
