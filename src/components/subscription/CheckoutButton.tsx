'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Loader2, Crown, CheckCircle2 } from 'lucide-react'
import { toast as sonnerToast } from 'sonner'

interface CheckoutButtonProps {
  planId: 'pro' | 'elite'
  planName: string
  price: number
  billingCycle: 'monthly' | 'yearly'
  currentPlan: boolean
}

declare global { interface Window { Razorpay: any } }

export function CheckoutButton({ planId, planName, price, billingCycle, currentPlan }: CheckoutButtonProps) {
  const [loading, setLoading] = useState(false)

  const handleCheckout = async () => {
    setLoading(true)
    try {
      const orderRes = await fetch('/api/payment/create-order', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ planId, billingCycle }),
      })
      if (!orderRes.ok) {
        // 🔒 R17-17 (Round 17): .catch(() => ({})) — non-JSON 500 was throwing.
        const err = await orderRes.json().catch(() => ({}))
        sonnerToast.error(err.error || "Couldn't start payment. Is Razorpay configured?")
        setLoading(false)
        return
      }
      const order = await orderRes.json()
      if (typeof window === 'undefined' || !window.Razorpay) {
        try {
          await loadRazorpaySDK()
        } catch {
          // 🔒 R17-18 (Round 17): Was: generic "Something went wrong" from
          // the outer catch. Now: specific SDK-load error so the user knows
          // it's a network/CDN issue, not a payment issue.
          sonnerToast.error("Couldn't load the Razorpay SDK", {
            description: 'Check your internet connection and try again. If the problem persists, Razorpay may be blocked by your network.',
            duration: 10000,
          })
          setLoading(false)
          return
        }
      }
      const options = {
        key: order.keyId, amount: order.amount, currency: order.currency,
        name: 'EkBook', description: `${planName} Plan — ${billingCycle === 'monthly' ? 'Monthly' : 'Yearly'}`,
        image: '/logo.svg', order_id: order.orderId,
        theme: { color: '#d97706' },
        handler: async function (response: any) {
          const verifyRes = await fetch('/api/payment/verify', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              razorpay_order_id: response.razorpay_order_id,
              razorpay_payment_id: response.razorpay_payment_id,
              razorpay_signature: response.razorpay_signature,
              planId, billingCycle, amount: price,
            }),
          })
          if (verifyRes.ok) {
            const data = await verifyRes.json().catch(() => ({}))
            sonnerToast.success(data.message || `Welcome to ${planName}!`)
            // 🔒 R17-20 (Round 17): Was: window.location.reload() after 1.5s —
            // full reload causes a flash of "free plan" before the new session
            // propagates. Now: close the Razorpay modal (already closed by
            // handler) + reload after 1.5s (keep the reload — the session
            // update via /api/payment/verify needs a fresh bootstrap call).
            // The flash is unavoidable without a full session refetch, which
            // is a bigger change. Kept the reload but reduced the delay.
            setTimeout(() => window.location.reload(), 1000)
          } else {
            // 🔒 R17-16 (Round 17): Was: "Payment verification failed" with no
            // payment_id reference + no retry. The user has ALREADY PAID
            // (Razorpay captured the payment) but the plan isn't upgraded.
            // The webhook is the safety net, but only if configured. Now:
            // show the payment_id so the user can reference it in support,
            // explain that the upgrade will land via webhook, and offer a
            // retry button (the verify endpoint is idempotent — retrying
            // with the same payment_id is safe).
            const err = await verifyRes.json().catch(() => ({}))
            sonnerToast.error('Payment received but upgrade failed', {
              description: `Your payment ID is ${response.razorpay_payment_id}. Your plan will upgrade automatically when the payment webhook processes. If it doesn't within 5 minutes, contact support with this payment ID.`,
              duration: 30000,
              action: {
                label: 'Retry verify',
                onClick: async () => {
                  const retryRes = await fetch('/api/payment/verify', {
                    method: 'POST', headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                      razorpay_order_id: response.razorpay_order_id,
                      razorpay_payment_id: response.razorpay_payment_id,
                      razorpay_signature: response.razorpay_signature,
                      planId, billingCycle, amount: price,
                    }),
                  })
                  if (retryRes.ok) {
                    sonnerToast.success(`Welcome to ${planName}!`)
                    setTimeout(() => window.location.reload(), 1000)
                  } else {
                    sonnerToast.error('Retry failed — the webhook will process your upgrade shortly.')
                  }
                },
              },
            })
          }
        },
        // 🔒 R17-19 (Round 17): Was: modal.ondismiss fired for both cancel
        // AND payment-failure-dismiss, both showing "Payment cancelled".
        // Now: add payment.failed handler to differentiate.
        modal: {
          ondismiss: function () {
            setLoading(false)
            sonnerToast.info('Payment cancelled.')
          },
        },
      }
      const rzp = new window.Razorpay(options)
      // 🔒 R17-19: Razorpay fires payment.failed for failed payments.
      // Without this, the modal dismisses + shows "Payment cancelled" —
      // misleading when the payment actually failed (card declined, etc.).
      rzp.on('payment.failed', function (response: any) {
        setLoading(false)
        sonnerToast.error('Payment failed', {
          description: response?.error?.description || 'Your payment was declined. Please try a different payment method.',
          duration: 10000,
        })
      })
      rzp.open()
    } catch (error) {
      sonnerToast.error('Something went wrong. Please try again.')
    } finally { setLoading(false) }
  }

  if (currentPlan) {
    return <Button disabled className="w-full bg-emerald-600 hover:bg-emerald-700 gap-2"><CheckCircle2 className="w-4 h-4" />Current Plan</Button>
  }

  return (
    <Button onClick={handleCheckout} disabled={loading} className={`w-full gap-2 ${planId === 'pro' ? 'bg-gradient-saffron' : 'bg-violet-600 hover:bg-violet-700'}`}>
      {loading ? <><Loader2 className="w-4 h-4 animate-spin" />Processing...</> : <><Crown className="w-4 h-4" />Upgrade to {planName}</>}
    </Button>
  )
}

function loadRazorpaySDK(): Promise<void> {
  return new Promise((resolve, reject) => {
    const script = document.createElement('script')
    script.src = 'https://checkout.razorpay.com/v1/checkout.js'
    script.onload = () => resolve()
    script.onerror = () => reject(new Error("Couldn't load the Razorpay SDK"))
    document.body.appendChild(script)
  })
}
