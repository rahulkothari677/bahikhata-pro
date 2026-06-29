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
  const [value, setValue] = useState(0)
  const hasAnimatedRef = useRef(false)

  useEffect(() => {
    if (hasAnimatedRef.current) return
    hasAnimatedRef.current = true

    // If end is 0 or negative, skip animation
    if (end <= 0) {
      setValue(end)
      return
    }

    let rafId: number
    let startTime: number | null = null
    let started = false

    const startAnimation = () => {
      if (started) return
      started = true

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
          setValue(end) // ensure exact final value
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
    }
  }, [end, duration, startDelay])

  return value
}
