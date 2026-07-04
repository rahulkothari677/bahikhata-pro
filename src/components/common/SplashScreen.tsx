'use client'

import { useEffect, useState } from 'react'

/**
 * Premium Splash Screen
 * 
 * Shows when the app first opens — like the best apps in the world.
 * Features:
 * - Saffron gradient background (Indian flag inspired)
 * - Animated logo (book with checkmark)
 * - App name "EkBook" with fade-in animation
 * - Caption "India's Smartest Ledger App"
 * - Smooth transition to main app
 * 
 * Shows for 2 seconds, then fades out.
 */
export function SplashScreen({ onFinish }: { onFinish: () => void }) {
  const [fadingOut, setFadingOut] = useState(false)

  useEffect(() => {
    // Start fade out after 1.5s
    const fadeTimer = setTimeout(() => setFadingOut(true), 1500)
    // Complete after fade animation (500ms)
    const finishTimer = setTimeout(onFinish, 2000)

    return () => {
      clearTimeout(fadeTimer)
      clearTimeout(finishTimer)
    }
  }, [onFinish])

  return (
    <div
      className={`fixed inset-0 z-[9999] flex flex-col items-center justify-center transition-opacity duration-500 ${
        fadingOut ? 'opacity-0' : 'opacity-100'
      }`}
      style={{
        background: 'linear-gradient(135deg, #FF9933 0%, #D97706 50%, #B45309 100%)',
      }}
    >
      {/* Animated logo */}
      <div className="relative mb-8 animate-splash-logo">
        <svg width="120" height="120" viewBox="0 0 512 512" fill="none" xmlns="http://www.w3.org/2000/svg">
          {/* Book/Ledger icon */}
          {/* Left page */}
          <path d="M256 160 L256 376 L160 340 L160 124 Z" fill="#FFFFFF" opacity="0.95"/>
          {/* Right page */}
          <path d="M256 160 L256 376 L352 340 L352 124 Z" fill="#FFFFFF" opacity="0.95"/>
          {/* Book spine */}
          <line x1="256" y1="160" x2="256" y2="376" stroke="#D97706" stroke-width="4" opacity="0.3"/>
          {/* Ledger lines left */}
          <line x1="180" y1="160" x2="240" y2="170" stroke="#D97706" stroke-width="3" opacity="0.4"/>
          <line x1="180" y1="180" x2="240" y2="190" stroke="#D97706" stroke-width="3" opacity="0.4"/>
          <line x1="180" y1="200" x2="240" y2="210" stroke="#D97706" stroke-width="3" opacity="0.4"/>
          {/* Ledger lines right */}
          <line x1="272" y1="170" x2="332" y2="160" stroke="#D97706" stroke-width="3" opacity="0.4"/>
          <line x1="272" y1="190" x2="332" y2="180" stroke="#D97706" stroke-width="3" opacity="0.4"/>
          <line x1="272" y1="210" x2="332" y2="200" stroke="#D97706" stroke-width="3" opacity="0.4"/>
          {/* Rupee symbol */}
          <text x="200" y="290" font-family="Arial, sans-serif" font-size="48" font-weight="bold" fill="#D97706" opacity="0.6">₹</text>
          {/* Checkmark */}
          <path d="M285 280 L300 295 L330 265" stroke="#10B981" stroke-width="6" stroke-linecap="round" stroke-linejoin="round" fill="none"/>
        </svg>

        {/* Glow effect behind logo */}
        <div className="absolute inset-0 -z-10 blur-2xl opacity-30">
          <div className="w-full h-full bg-white rounded-full" />
        </div>
      </div>

      {/* App name */}
      <h1 className="text-4xl font-bold text-white tracking-tight animate-splash-text">
        EkBook
      </h1>

      {/* Caption */}
      <p className="text-sm text-white/70 mt-2 animate-splash-text-delay">
        India&apos;s Smartest Ledger App
      </p>

      {/* Loading dots */}
      <div className="flex gap-1.5 mt-8">
        <div className="w-2 h-2 rounded-full bg-white/50 animate-splash-dot-1" />
        <div className="w-2 h-2 rounded-full bg-white/50 animate-splash-dot-2" />
        <div className="w-2 h-2 rounded-full bg-white/50 animate-splash-dot-3" />
      </div>
    </div>
  )
}
