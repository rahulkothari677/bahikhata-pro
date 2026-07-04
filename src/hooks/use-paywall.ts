'use client'

import { useState, useCallback } from 'react'
import { PaywallModal } from '@/components/common/PaywallModal'

/**
 * usePaywall — reusable hook for handling 402 subscription limit errors.
 *
 * Usage:
 *   const { paywallOpen, paywallReason, checkPaywall, Paywall } = usePaywall()
 *
 *   // After any API call that might return 402:
 *   const r = await offlineFetch('/api/transactions', { method: 'POST', ... })
 *   if (checkPaywall(r)) return // shows paywall modal, stops execution
 *
 *   // Render the modal at the bottom of your component:
 *   <Paywall />
 *
 * The hook handles:
 * - 402 'limit_reached' → shows paywall with reason message
 * - 402 'feature_locked' → shows paywall with feature name
 * - Other statuses → no-op (returns false)
 */

export function usePaywall() {
  const [open, setOpen] = useState(false)
  const [reason, setReason] = useState<string | undefined>()
  const [feature, setFeature] = useState<string | undefined>()

  const checkPaywall = useCallback(async (response: Response): Promise<boolean> => {
    if (response.status !== 402) return false

    try {
      const data = await response.json()
      if (data.error === 'limit_reached' || data.error === 'feature_locked') {
        setReason(data.message)
        setFeature(data.feature || data.field)
        setOpen(true)
        return true
      }
    } catch {
      // Can't parse response — show generic paywall
      setReason('You\'ve reached your plan limit. Upgrade to continue.')
      setFeature(undefined)
      setOpen(true)
      return true
    }
    return false
  }, [])

  const close = useCallback(() => {
    setOpen(false)
    setReason(undefined)
    setFeature(undefined)
  }, [])

  const Paywall = () => (
    <PaywallModal
      open={open}
      onClose={close}
      reason={reason}
      feature={feature}
    />
  )

  return { paywallOpen: open, paywallReason: reason, checkPaywall, Paywall }
}
