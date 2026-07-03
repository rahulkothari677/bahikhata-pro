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
        const err = await orderRes.json()
        sonnerToast.error(err.error || 'Failed to start payment. Is Razorpay configured?')
        setLoading(false)
        return
      }
      const order = await orderRes.json()
      if (typeof window === 'undefined' || !window.Razorpay) {
        await loadRazorpaySDK()
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
            const data = await verifyRes.json()
            sonnerToast.success(data.message || `Welcome to ${planName}!`)
            setTimeout(() => window.location.reload(), 1500)
          } else {
            const err = await verifyRes.json()
            sonnerToast.error(err.error || 'Payment verification failed.')
          }
        },
        modal: { ondismiss: function () { setLoading(false); sonnerToast.info('Payment cancelled.') } },
      }
      const rzp = new window.Razorpay(options)
      rzp.open()
    } catch (error) {
      sonnerToast.error('Something went wrong.')
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
    script.onerror = () => reject(new Error('Failed to load Razorpay SDK'))
    document.body.appendChild(script)
  })
}
