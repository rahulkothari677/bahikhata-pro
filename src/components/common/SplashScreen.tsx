'use client'

import { useEffect, useState, useRef } from 'react'

/**
 * Premium Splash Screen V3 (V20-021)
 *
 * Inspired by world-class apps: CRED (India), Stripe, Cash App, Linear, Apple.
 * Clean, iconic, properly composed — not cluttered.
 *
 * ─── Logo Design (clean, iconic) ──────────────────────────────────────
 * - Circular badge with gradient border (complete on load, no broken draw)
 * - ₹ rupee symbol as the HERO (large, centered, bold)
 * - Subtle ledger lines below the ₹ (suggesting a book, not a full book)
 * - Small green checkmark badge on bottom-right of circle (verification seal)
 * - Everything properly centered, no overlap
 *
 * ─── Animation Choreography (3.8s min, 5.0s max) ──────────────────────
 *
 * Stage 1 (0-600ms):    Background gradient mesh fades in
 * Stage 2 (200-1000ms): Badge circle scales in (full circle, no draw)
 * Stage 3 (600-1400ms): ₹ symbol types/fades in with scale
 * Stage 4 (1000-1600ms): Ledger lines draw in (stroke animation)
 * Stage 5 (1400-2000ms): Checkmark badge pops in (spring)
 * Stage 6 (1200-2000ms): "EkBook" letters rise with stagger
 * Stage 7 (1800-2600ms): Tagline fades in
 * Stage 8 (2600-3800ms): Hold + breathing
 * Stage 9 (3800-4300ms): Exit — scale + fade + blur
 *
 * ─── Continuous Animations ────────────────────────────────────────────
 * - Gradient mesh shift (premium background breathing)
 * - 5 floating particles (varied sizes, speeds, drifts)
 * - Glow halo pulse behind badge
 * - Shimmer sweep across badge
 * - Subtle ₹ breathing (scale 1.0 → 1.03 → 1.0)
 * - Rotating accent ring (subtle, slow)
 */

const MIN_DISPLAY_MS = 3800  // 3.8s — full premium experience
const MAX_DISPLAY_MS = 5000  // 5.0s — hard fallback
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
        exiting ? 'animate-splash3-exit' : ''
      }`}
      style={{
        background: `
          radial-gradient(ellipse at 20% 10%, rgba(255, 179, 71, 0.6) 0%, transparent 40%),
          radial-gradient(ellipse at 80% 90%, rgba(180, 83, 9, 0.5) 0%, transparent 40%),
          radial-gradient(ellipse at 50% 50%, rgba(255, 153, 51, 0.3) 0%, transparent 60%),
          linear-gradient(135deg, #FF9933 0%, #D97706 50%, #92400E 100%)
        `,
        backgroundSize: '200% 200%, 200% 200%, 200% 200%, 200% 200%',
        animation: 'splash3-gradient-shift 8s ease-in-out infinite',
      }}
      aria-label="EkBook loading"
      role="status"
    >
      {/* ─── Floating particles (premium ambiance) ────────────────────── */}
      <div className="absolute inset-0 pointer-events-none" aria-hidden="true">
        <div className="absolute bottom-1/4 left-1/4 w-2 h-2 rounded-full bg-white/40 animate-splash3-particle-1" />
        <div className="absolute bottom-1/3 right-1/4 w-1.5 h-1.5 rounded-full bg-amber-200/50 animate-splash3-particle-2" />
        <div className="absolute bottom-1/5 left-2/5 w-1 h-1 rounded-full bg-white/30 animate-splash3-particle-3" />
        <div className="absolute bottom-1/3 left-1/3 w-1.5 h-1.5 rounded-full bg-yellow-200/30 animate-splash3-particle-4" />
        <div className="absolute bottom-1/4 right-1/3 w-1 h-1 rounded-full bg-white/40 animate-splash3-particle-5" />
      </div>

      {/* ─── Glow halo behind the badge ──────────────────────────────── */}
      <div
        className="absolute w-72 h-72 rounded-full blur-3xl animate-splash3-glow"
        aria-hidden="true"
        style={{
          background: 'radial-gradient(circle, rgba(255,255,255,0.35) 0%, transparent 70%)',
        }}
      />

      {/* ─── Rotating accent ring (subtle, slow) ──────────────────────── */}
      <div
        className="absolute w-44 h-44 rounded-full border border-white/10 animate-splash3-ring-rotate"
        aria-hidden="true"
        style={{
          borderStyle: 'dashed',
        }}
      />

      {/* ─── Logo Badge ──────────────────────────────────────────────── */}
      <div className="relative mb-10 animate-splash3-badge-enter">
        {/* Shimmer sweep overlay */}
        <div className="absolute inset-0 overflow-hidden rounded-full pointer-events-none" aria-hidden="true">
          <div className="absolute top-0 left-0 w-1/3 h-full bg-gradient-to-r from-transparent via-white/50 to-transparent animate-splash3-shimmer" />
        </div>

        <svg
          width="150"
          height="150"
          viewBox="0 0 200 200"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
          className="relative z-10 drop-shadow-2xl"
        >
          <defs>
            {/* Gradient for the badge border */}
            <linearGradient id="badgeGrad3" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor="#FEF3C7" />
              <stop offset="50%" stopColor="#FBBF24" />
              <stop offset="100%" stopColor="#D97706" />
            </linearGradient>
            {/* Gradient for the ₹ symbol */}
            <linearGradient id="rupeeGrad3" x1="0%" y1="0%" x2="0%" y2="100%">
              <stop offset="0%" stopColor="#FFFFFF" />
              <stop offset="100%" stopColor="#FEF3C7" />
            </linearGradient>
            {/* Glow filter */}
            <filter id="glow3" x="-50%" y="-50%" width="200%" height="200%">
              <feGaussianBlur stdDeviation="2" result="coloredBlur" />
              <feMerge>
                <feMergeNode in="coloredBlur" />
                <feMergeNode in="SourceGraphic" />
              </feMerge>
            </filter>
          </defs>

          {/* ─── Badge circle (scales in complete, no stroke-draw) ──── */}
          <circle
            cx="100"
            cy="100"
            r="88"
            stroke="url(#badgeGrad3)"
            strokeWidth="3"
            fill="rgba(255,255,255,0.12)"
          />

          {/* Inner accent ring */}
          <circle
            cx="100"
            cy="100"
            r="80"
            stroke="rgba(255,255,255,0.15)"
            strokeWidth="1"
            fill="none"
          />

          {/* ─── ₹ Rupee symbol (HERO — large, centered, bold) ──────── */}
          <g className="animate-splash3-rupee-enter" filter="url(#glow3)">
            <text
              x="100"
              y="118"
              textAnchor="middle"
              fontFamily="Arial, Helvetica, sans-serif"
              fontSize="64"
              fontWeight="900"
              fill="url(#rupeeGrad3)"
            >
              ₹
            </text>
          </g>

          {/* ─── Ledger lines (subtle, below ₹ — suggests a book) ────── */}
          <g className="animate-splash3-lines-draw" stroke="rgba(255,255,255,0.4)" strokeWidth="2" strokeLinecap="round">
            <line x1="70" y1="140" x2="130" y2="140" className="animate-splash3-line-1" />
            <line x1="75" y1="148" x2="125" y2="148" className="animate-splash3-line-2" />
          </g>

          {/* ─── Checkmark verification badge (bottom-right, like a seal) ── */}
          <g className="animate-splash3-checkmark-badge">
            {/* Green circle background */}
            <circle cx="155" cy="155" r="18" fill="#10B981" stroke="#FFFFFF" strokeWidth="3" />
            {/* White checkmark inside */}
            <path
              d="M148 155 L153 160 L162 150"
              stroke="#FFFFFF"
              strokeWidth="3"
              strokeLinecap="round"
              strokeLinejoin="round"
              fill="none"
            />
          </g>
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
            className="animate-splash3-letter inline-block"
            style={{
              animationDelay: `${1.2 + i * 0.08}s`,
            }}
          >
            {letter}
          </span>
        ))}
      </h1>

      {/* ─── Tagline ──────────────────────────────────────────────────── */}
      <p className="text-sm text-white/80 tracking-[0.15em] font-medium animate-splash3-tagline">
        India&apos;s Smartest Ledger App
      </p>

      {/* ─── Progress bar (data-driven) ──────────────────────────────── */}
      <div className="absolute bottom-24 left-1/2 -translate-x-1/2 w-56 h-1 bg-white/15 rounded-full overflow-hidden">
        <div
          className="h-full rounded-full transition-all duration-700 ease-out"
          style={{
            width: ready ? '100%' : '70%',
            background: 'linear-gradient(90deg, rgba(255,255,255,0.6) 0%, rgba(255,255,255,0.95) 100%)',
          }}
        />
      </div>

      {/* ─── Status text ─────────────────────────────────────────────── */}
      <p className="absolute bottom-14 left-1/2 -translate-x-1/2 text-xs text-white/50 tracking-[0.2em] uppercase font-medium">
        {ready ? 'Ready' : 'Loading'}
      </p>

      {/* ─── Version badge ───────────────────────────────────────────── */}
      <p className="absolute bottom-6 left-1/2 -translate-x-1/2 text-3xs text-white/30 tracking-wider">
        v2.0
      </p>
    </div>
  )
}
