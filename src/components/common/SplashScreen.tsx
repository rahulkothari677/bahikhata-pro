'use client'

import { useEffect, useState, useRef } from 'react'

/**
 * Premium Splash Screen V2 (V20-020)
 *
 * Redesigned for a world-class premium feel — inspired by Stripe, Linear,
 * Cash App, and Apple's native apps. Not an ordinary app vibe.
 *
 * ─── Animation Stages (2.8s min, 3.8s max) ────────────────────────────
 *
 * Stage 1 (0-500ms):    Background gradient mesh fades in
 * Stage 2 (300-1200ms): Logo badge draws (circle stroke), book opens,
 *                       rupee symbol fades in, checkmark draws last
 * Stage 3 (800-1600ms): Brand letters "EkBook" rise with 80ms stagger
 * Stage 4 (1400-2000ms): Tagline fades in with upward motion
 * Stage 5 (2000-2800ms): Hold + subtle breathing (logo glow pulses)
 * Stage 6 (2800-3200ms): Exit — scale up + fade + blur (app "opens")
 *
 * ─── Continuous Animations (premium ambiance) ─────────────────────────
 * - 5 floating particles (different sizes, speeds, drift directions)
 * - Gradient mesh shift (background slowly breathes)
 * - Glow halo pulse behind logo
 * - Shimmer sweep across logo badge (light reflection)
 * - Subtle scale breathing on the logo (1.0 → 1.02 → 1.0)
 *
 * ─── New Logo Design ──────────────────────────────────────────────────
 * - Circular badge with saffron→amber gradient stroke
 * - Book with 2 pages that "open" from center
 * - ₹ rupee symbol in center (draws in after book opens)
 * - Green checkmark accent (draws in last)
 * - Drop shadow + inner glow for depth
 *
 * ─── Data-Driven Dismissal ────────────────────────────────────────────
 * - Dismisses when `ready` is true (session + dashboard loaded)
 *   AND min display time (2.8s) has elapsed
 * - Max fallback 3.8s (never wait longer)
 * - On warm Neon + fast network: ~2.8s (full premium experience)
 * - On cold Neon: up to 3.8s (still premium, progress bar shows)
 *
 * ─── Performance ──────────────────────────────────────────────────────
 * - All CSS animations (no JS animation loops)
 * - Respects prefers-reduced-motion
 * - No external libraries
 */

const MIN_DISPLAY_MS = 2800  // 2.8s — full premium experience
const MAX_DISPLAY_MS = 3800  // 3.8s — hard fallback
const EXIT_ANIMATION_MS = 500

export function SplashScreen({
  onFinish,
  ready = false,
}: {
  onFinish: () => void
  ready?: boolean
}) {
  const [exiting, setExiting] = useState(false)
  const startTimeRef = useRef(Date.now())
  const finishedRef = useRef(false)

  function triggerExit() {
    if (finishedRef.current) return
    finishedRef.current = true
    setExiting(true)
    setTimeout(() => {
      onFinish()
    }, EXIT_ANIMATION_MS)
  }

  useEffect(() => {
    startTimeRef.current = Date.now()

    const minTimer = setTimeout(() => {
      if (ready && !finishedRef.current) {
        triggerExit()
      }
    }, MIN_DISPLAY_MS)

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

  useEffect(() => {
    if (ready && !exiting && !finishedRef.current) {
      const elapsed = Date.now() - startTimeRef.current
      if (elapsed >= MIN_DISPLAY_MS) {
        triggerExit()
      }
    }
  }, [ready])

  const brandLetters = 'EkBook'.split('')

  return (
    <div
      className={`fixed inset-0 z-[9999] flex flex-col items-center justify-center overflow-hidden ${
        exiting ? 'animate-splash2-exit' : ''
      }`}
      style={{
        background: 'radial-gradient(circle at 30% 20%, #FFB347 0%, transparent 50%), radial-gradient(circle at 70% 80%, #B45309 0%, transparent 50%), linear-gradient(135deg, #FF9933 0%, #D97706 50%, #92400E 100%)',
        backgroundSize: '200% 200%, 200% 200%, 200% 200%',
        animation: 'splash2-gradient-shift 8s ease-in-out infinite',
      }}
      aria-label="EkBook loading"
      role="status"
    >
      {/* ─── Floating particles (premium ambiance) ────────────────────── */}
      <div className="absolute inset-0 pointer-events-none" aria-hidden="true">
        <div className="absolute bottom-1/4 left-1/4 w-2 h-2 rounded-full bg-white/40 animate-splash2-particle-1" />
        <div className="absolute bottom-1/3 right-1/4 w-1.5 h-1.5 rounded-full bg-amber-200/50 animate-splash2-particle-2" />
        <div className="absolute bottom-1/5 left-2/5 w-1 h-1 rounded-full bg-white/30 animate-splash2-particle-3" />
        <div className="absolute bottom-1/3 left-1/3 w-1.5 h-1.5 rounded-full bg-yellow-200/30 animate-splash2-particle-4" />
        <div className="absolute bottom-1/4 right-1/3 w-1 h-1 rounded-full bg-white/40 animate-splash2-particle-5" />
      </div>

      {/* ─── Glow halo behind the logo (breathing pulse) ──────────────── */}
      <div
        className="absolute w-64 h-64 rounded-full blur-3xl animate-splash2-glow"
        aria-hidden="true"
        style={{
          background: 'radial-gradient(circle, rgba(255,255,255,0.3) 0%, transparent 70%)',
        }}
      />

      {/* ─── Logo assembly ────────────────────────────────────────────── */}
      <div className="relative mb-10 animate-splash2-logo-enter">
        {/* Shimmer sweep overlay */}
        <div className="absolute inset-0 overflow-hidden rounded-full pointer-events-none" aria-hidden="true">
          <div className="absolute top-0 left-0 w-1/3 h-full bg-gradient-to-r from-transparent via-white/50 to-transparent animate-splash2-shimmer" />
        </div>

        <svg
          width="140"
          height="140"
          viewBox="0 0 200 200"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
          className="relative z-10 drop-shadow-2xl"
        >
          {/* ─── Circular badge with gradient stroke (draws in first) ─── */}
          <defs>
            <linearGradient id="badgeGradient" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor="#FEF3C7" />
              <stop offset="50%" stopColor="#FBBF24" />
              <stop offset="100%" stopColor="#D97706" />
            </linearGradient>
            <linearGradient id="bookGradient" x1="0%" y1="0%" x2="0%" y2="100%">
              <stop offset="0%" stopColor="#FFFFFF" />
              <stop offset="100%" stopColor="#FEF3C7" />
            </linearGradient>
            <filter id="logoGlow" x="-50%" y="-50%" width="200%" height="200%">
              <feGaussianBlur stdDeviation="3" result="coloredBlur" />
              <feMerge>
                <feMergeNode in="coloredBlur" />
                <feMergeNode in="SourceGraphic" />
              </feMerge>
            </filter>
          </defs>

          {/* Badge circle — draws in via stroke-dashoffset */}
          <circle
            cx="100"
            cy="100"
            r="90"
            stroke="url(#badgeGradient)"
            strokeWidth="3"
            fill="rgba(255,255,255,0.08)"
            className="animate-splash2-badge-draw"
            style={{
              strokeDasharray: 565,
              strokeDashoffset: 565,
            }}
          />

          {/* Inner glow circle */}
          <circle
            cx="100"
            cy="100"
            r="82"
            stroke="rgba(255,255,255,0.2)"
            strokeWidth="1"
            fill="none"
          />

          {/* ─── Book (opens from center) ─────────────────────────────── */}
          <g className="animate-splash2-book-open" filter="url(#logoGlow)">
            {/* Left page */}
            <path
              d="M100 65 L100 140 L60 128 L60 55 Z"
              fill="url(#bookGradient)"
              opacity="0.95"
            />
            {/* Right page */}
            <path
              d="M100 65 L100 140 L140 128 L140 55 Z"
              fill="url(#bookGradient)"
              opacity="0.95"
            />
            {/* Book spine shadow */}
            <line x1="100" y1="65" x2="100" y2="140" stroke="#92400E" strokeWidth="1.5" opacity="0.3" />

            {/* Ledger lines left */}
            <line x1="68" y1="70" x2="94" y2="76" stroke="#D97706" strokeWidth="1.5" opacity="0.5" />
            <line x1="68" y1="85" x2="94" y2="91" stroke="#D97706" strokeWidth="1.5" opacity="0.5" />
            <line x1="68" y1="100" x2="94" y2="106" stroke="#D97706" strokeWidth="1.5" opacity="0.5" />

            {/* Ledger lines right */}
            <line x1="106" y1="76" x2="132" y2="70" stroke="#D97706" strokeWidth="1.5" opacity="0.5" />
            <line x1="106" y1="91" x2="132" y2="85" stroke="#D97706" strokeWidth="1.5" opacity="0.5" />
            <line x1="106" y1="106" x2="132" y2="100" stroke="#D97706" strokeWidth="1.5" opacity="0.5" />
          </g>

          {/* ─── Rupee symbol (fades in after book opens) ─────────────── */}
          <text
            x="100"
            y="115"
            textAnchor="middle"
            fontFamily="Arial, sans-serif"
            fontSize="32"
            fontWeight="bold"
            fill="#92400E"
            opacity="0"
            className="animate-splash2-rupee"
          >
            ₹
          </text>

          {/* ─── Checkmark (draws in last) ────────────────────────────── */}
          <path
            d="M130 100 L140 110 L155 90"
            stroke="#10B981"
            strokeWidth="4"
            strokeLinecap="round"
            strokeLinejoin="round"
            fill="none"
            className="animate-splash2-checkmark"
            style={{
              strokeDasharray: 50,
              strokeDashoffset: 50,
            }}
          />
        </svg>
      </div>

      {/* ─── Brand name — letters rise with stagger ───────────────────── */}
      <h1
        className="text-5xl font-bold text-white tracking-tight flex mb-3"
        aria-label="EkBook"
        style={{ textShadow: '0 4px 24px rgba(0,0,0,0.3)' }}
      >
        {brandLetters.map((letter, i) => (
          <span
            key={i}
            className="animate-splash2-letter inline-block"
            style={{
              animationDelay: `${0.8 + i * 0.08}s`,
            }}
          >
            {letter}
          </span>
        ))}
      </h1>

      {/* ─── Tagline ──────────────────────────────────────────────────── */}
      <p className="text-sm text-white/80 tracking-wider font-medium animate-splash2-tagline">
        India&apos;s Smartest Ledger App
      </p>

      {/* ─── Progress bar (data-driven) ──────────────────────────────── */}
      <div className="absolute bottom-24 left-1/2 -translate-x-1/2 w-56 h-1 bg-white/15 rounded-full overflow-hidden">
        <div
          className="h-full rounded-full transition-all duration-700 ease-out"
          style={{
            width: ready ? '100%' : '60%',
            background: 'linear-gradient(90deg, rgba(255,255,255,0.6) 0%, rgba(255,255,255,0.95) 100%)',
          }}
        />
      </div>

      {/* ─── Status text ─────────────────────────────────────────────── */}
      <p className="absolute bottom-14 left-1/2 -translate-x-1/2 text-xs text-white/50 tracking-[0.2em] uppercase font-medium">
        {ready ? 'Ready' : 'Loading'}
      </p>

      {/* ─── Version badge (subtle, premium) ─────────────────────────── */}
      <p className="absolute bottom-6 left-1/2 -translate-x-1/2 text-[10px] text-white/30 tracking-wider">
        v2.0
      </p>
    </div>
  )
}
