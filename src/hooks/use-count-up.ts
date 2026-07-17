'use client'

import { useEffect, useRef, useState } from 'react'

/**
 * useCountUp — animates a number from 0 to `end` over `duration` ms.
 *
 * Uses requestAnimationFrame for smooth 60fps animation.
 * Easing: ease-out-cubic (decelerates toward the end — feels natural).
 *
 * The animation only runs ONCE on mount. If `end` changes later, the
 * number jumps to the new value without re-animating (to avoid annoying
 * re-animations on every data refresh).
 *
 * 🔒 AUDIT V25 FIX BUG-028 (Batch 5): rAF is paused when the tab is
 * backgrounded (document.visibilityState === 'hidden') or when the
 * compositor is throttled (battery-saver, embedded webviews). In those
 * cases, the animation never progresses — `value` stays at 0 forever.
 * Observed: dashboard "Today's Revenue" showed ₹0 while the hero text
 * showed ₹700 (the hero didn't use this hook). Now: if the tab is hidden
 * OR rAF hasn't fired within 2x the expected duration, jump straight to
 * the final value. Animation is cosmetic; the final number is the truth.
 *
 * @param end - final value to count up to
 * @param duration - animation duration in ms (default 800)
 * @param startDelay - delay before animation starts in ms (default 0)
 *
 * @returns current animated value (number)
 *
 * Usage:
 *   const animatedValue = useCountUp(1500)
 *   // animatedValue goes 0 → 1500 over 800ms
 *   // Use with formatINR: formatINR(animatedValue)
 */
export function useCountUp(end: number, duration = 800, startDelay = 0): number {
  // 🔒 AUDIT V25 FIX BUG-028: If the tab is hidden when the hook mounts,
  // skip animation entirely — render the final value. rAF won't fire
  // reliably in a backgrounded tab, so the user would see ₹0 forever.
  const [value, setValue] = useState(() => {
    if (typeof document !== 'undefined' && document.visibilityState === 'hidden') {
      return end
    }
    return 0
  })
  const hasAnimatedRef = useRef(false)

  useEffect(() => {
    if (hasAnimatedRef.current) return
    hasAnimatedRef.current = true

    // If end is 0 or negative, skip animation
    if (end <= 0) {
      setValue(end)
      return
    }

    // 🔒 AUDIT V25 FIX BUG-028: If the tab is hidden, skip animation.
    if (typeof document !== 'undefined' && document.visibilityState === 'hidden') {
      setValue(end)
      return
    }

    let rafId: number
    let startTime: number | null = null
    let started = false
    let fallbackTimer: number | undefined

    const startAnimation = () => {
      if (started) return
      started = true

      // 🔒 AUDIT V25 FIX BUG-028: Fallback timer — if rAF hasn't completed
      // the animation within 2x the expected duration, jump to the final
      // value. Covers rAF starvation (throttled compositor, battery-saver,
      // embedded webviews, automation). 2x is generous — normal animation
      // completes in `duration` ms; we allow 2x before giving up.
      fallbackTimer = window.setTimeout(() => {
        if (rafId) cancelAnimationFrame(rafId)
        setValue(end)
      }, duration * 2 + startDelay + 100)

      const animate = (timestamp: number) => {
        if (startTime === null) startTime = timestamp
        const progress = Math.min((timestamp - startTime) / duration, 1)
        // Ease-out-cubic: 1 - (1 - t)^3
        // Starts fast, decelerates toward the end — feels natural
        const eased = 1 - Math.pow(1 - progress, 3)
        const current = Math.round(end * eased)
        setValue(current)

        if (progress < 1) {
          rafId = requestAnimationFrame(animate)
        } else {
          // Animation completed — clear the fallback timer + set exact final value
          if (fallbackTimer) window.clearTimeout(fallbackTimer)
          setValue(end)
        }
      }

      rafId = requestAnimationFrame(animate)
    }

    let timeoutId: number | undefined
    if (startDelay > 0) {
      timeoutId = window.setTimeout(startAnimation, startDelay)
    } else {
      startAnimation()
    }

    return () => {
      if (rafId) cancelAnimationFrame(rafId)
      if (timeoutId) window.clearTimeout(timeoutId)
      if (fallbackTimer) window.clearTimeout(fallbackTimer)
    }
  }, [end, duration, startDelay])

  return value
}
