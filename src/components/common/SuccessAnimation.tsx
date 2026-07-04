'use client'

import { useEffect, useState } from 'react'
import { CheckCircle2 } from 'lucide-react'

/**
 * SuccessAnimation — shows a brief checkmark overlay on save.
 *
 * Usage:
 *   const { show, trigger } = useSuccessAnimation()
 *   trigger() // shows checkmark for 1.5s
 *   <SuccessAnimation show={show} />
 *
 * Or simpler:
 *   <SuccessAnimation show={show} /> where show is a boolean state
 */
export function SuccessAnimation({ show }: { show: boolean }) {
  if (!show) return null

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center pointer-events-none">
      <div className="bg-card/95 backdrop-blur-sm rounded-3xl p-8 shadow-2xl border border-border animate-in zoom-in-50 duration-300">
        <CheckCircle2 className="w-20 h-20 text-emerald-500 animate-in zoom-in-50 duration-500" strokeWidth={2} />
      </div>
    </div>
  )
}

/** Hook to manage success animation state */
export function useSuccessAnimation() {
  const [show, setShow] = useState(false)

  const trigger = () => {
    setShow(true)
    setTimeout(() => setShow(false), 1500)
  }

  return { show, trigger }
}
