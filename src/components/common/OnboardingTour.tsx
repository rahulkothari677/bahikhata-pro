'use client'

/**
 * OnboardingTour — first-time user tour that highlights 3 key features.
 *
 * Shows automatically on first login (when no Setting.shopName is set, or
 * when 'onboarding-tour-seen' flag is not in localStorage).
 *
 * Tour steps:
 *   1. New Sale button (top right) — record your first sale
 *   2. AI Bill Scanner — snap a bill, we auto-fill
 *   3. Dashboard insights — track revenue, profit, stock
 *
 * Uses a spotlight overlay + tooltip. Dismissed with 'Skip tour' or
 * 'Got it' buttons. Persisted in localStorage so it never shows again.
 */

import { useState, useEffect, useRef } from 'react'
import { Button } from '@/components/ui/button'
import { ArrowRight, X, ScanLine, Plus, BarChart3 } from 'lucide-react'

const STORAGE_KEY = 'bahikhata-tour-seen'

interface TourStep {
  title: string
  description: string
  icon: typeof Plus
  // CSS selector for the element to highlight (informational — we don't actually
  // move the tooltip to point at it for simplicity; instead we show a centered
  // modal with the icon and a hint about where to find the feature)
  hint: string
}

const STEPS: TourStep[] = [
  {
    title: 'Record Your First Sale',
    description: 'Tap "New Sale" (top right) to record a sale in seconds. Add products, customer, and payment — all done.',
    icon: Plus,
    hint: 'Find this button at the top right of any page',
  },
  {
    title: 'Scan Bills with AI',
    description: 'Tap "Scan Bill" and snap a photo of any bill or handwritten note. Our AI extracts products, prices, and GST automatically — no manual entry.',
    icon: ScanLine,
    hint: 'Find this button next to "New Sale"',
  },
  {
    title: 'Track Your Business',
    description: 'The dashboard shows your daily revenue, profit, top products, low stock alerts, and GST summary — all updated in real time as you record sales.',
    icon: BarChart3,
    hint: 'You\'re already here! Scroll down to see all charts',
  },
]

export function OnboardingTour() {
  const [visible, setVisible] = useState(false)
  const [step, setStep] = useState(0)
  const mountedRef = useRef(false)

  useEffect(() => {
    if (mountedRef.current) return
    mountedRef.current = true

    // Check if user has seen the tour
    try {
      const seen = localStorage.getItem(STORAGE_KEY)
      if (seen === 'true') return

      // Delay slightly so the app finishes loading
      const timer = setTimeout(() => setVisible(true), 1500)
      return () => clearTimeout(timer)
    } catch {
      // localStorage might not be available — skip tour
    }
  }, [])

  const handleDismiss = () => {
    setVisible(false)
    try {
      localStorage.setItem(STORAGE_KEY, 'true')
    } catch {}
  }

  const handleNext = () => {
    if (step < STEPS.length - 1) {
      setStep(step + 1)
    } else {
      handleDismiss()
    }
  }

  if (!visible) return null

  const current = STEPS[step]
  const Icon = current.icon
  const isLast = step === STEPS.length - 1

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
      <div className="relative bg-card rounded-2xl shadow-2xl border border-border max-w-md w-full overflow-hidden">
        {/* Top accent bar */}
        <div className="h-1.5 bg-gradient-saffron" />

        {/* Close button */}
        <button
          onClick={handleDismiss}
          className="absolute top-3 right-3 p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted transition"
          aria-label="Skip tour"
        >
          <X className="w-4 h-4" />
        </button>

        <div className="p-6 pt-7">
          {/* Step indicator */}
          <div className="flex gap-1.5 mb-5">
            {STEPS.map((_, i) => (
              <div
                key={i}
                className={`h-1.5 rounded-full transition-all ${
                  i === step ? 'w-8 bg-primary' : i < step ? 'w-4 bg-primary/40' : 'w-4 bg-muted'
                }`}
              />
            ))}
          </div>

          {/* Icon */}
          <div className="w-16 h-16 rounded-2xl bg-gradient-saffron flex items-center justify-center mb-4 shadow-lg">
            <Icon className="w-8 h-8 text-white" />
          </div>

          {/* Content */}
          <h3 className="text-lg font-bold text-foreground mb-2">{current.title}</h3>
          <p className="text-sm text-muted-foreground leading-relaxed mb-3">{current.description}</p>
          <p className="text-xs text-primary font-medium mb-5 flex items-center gap-1.5">
            <ArrowRight className="w-3 h-3" />
            {current.hint}
          </p>

          {/* Actions */}
          <div className="flex gap-2 justify-between items-center">
            <button
              onClick={handleDismiss}
              className="text-xs text-muted-foreground hover:text-foreground transition"
            >
              Skip tour
            </button>
            <Button onClick={handleNext} className="bg-gradient-saffron gap-2">
              {isLast ? 'Got it!' : 'Next'}
              {!isLast && <ArrowRight className="w-4 h-4" />}
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}
