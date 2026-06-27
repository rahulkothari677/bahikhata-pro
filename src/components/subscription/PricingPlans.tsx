'use client'

import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { offlineFetch } from '@/lib/offline-fetch'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Crown, Check, X, Sparkles } from 'lucide-react'
import { cn } from '@/lib/utils'
import { CheckoutButton } from '@/components/subscription/CheckoutButton'

export function PricingPlans() {
  const [billingCycle, setBillingCycle] = useState<'monthly' | 'yearly'>('monthly')

  const { data, isLoading } = useQuery({
    queryKey: ['subscription-status'],
    queryFn: async () => {
      const r = await offlineFetch('/api/subscription/status')
      return r.json()
    },
  })

  if (isLoading) {
    return <div className="space-y-3">{[...Array(3)].map((_, i) => <div key={i} className="h-48 bg-muted animate-pulse rounded-2xl" />)}</div>
  }

  const currentPlan = data?.current?.plan || 'free'
  const plans = data?.plans || []
  const displayPlans = plans.filter((p: any) => p.id !== 'enterprise')

  return (
    <div>
      <div className="flex items-center justify-center gap-2 mb-6">
        <button onClick={() => setBillingCycle('monthly')} className={cn('px-4 py-2 rounded-lg text-sm font-medium transition', billingCycle === 'monthly' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-muted')}>Monthly</button>
        <button onClick={() => setBillingCycle('yearly')} className={cn('px-4 py-2 rounded-lg text-sm font-medium transition flex items-center gap-1.5', billingCycle === 'yearly' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-muted')}>Yearly <span className="text-xs bg-emerald-500 text-white px-1.5 py-0.5 rounded-full">Save 16%</span></button>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {displayPlans.map((plan: any) => {
          const isCurrentPlan = currentPlan === plan.id
          const price = billingCycle === 'monthly' ? plan.price : plan.yearlyPrice
          const period = plan.price === 0 ? '' : billingCycle === 'monthly' ? '/month' : '/year'
          return (
            <Card key={plan.id} className={cn('relative overflow-hidden transition', plan.popular && 'border-primary shadow-lg md:scale-105', isCurrentPlan && 'ring-2 ring-emerald-500')}>
              {plan.popular && <div className="absolute top-0 right-0 bg-gradient-saffron text-white text-xs font-bold px-3 py-1 rounded-bl-lg">POPULAR</div>}
              {isCurrentPlan && <div className="absolute top-0 left-0 bg-emerald-500 text-white text-xs font-bold px-3 py-1 rounded-br-lg">CURRENT</div>}
              <CardContent className="p-6">
                <h3 className={cn('text-lg font-bold', plan.color)}>{plan.name}</h3>
                <div className="mt-2 mb-4">
                  {plan.price === 0 ? <p className="text-3xl font-bold">Free</p> : <p className="text-3xl font-bold">Rs.{price}<span className="text-sm font-normal text-muted-foreground">{period}</span></p>}
                </div>
                <div className="w-full mb-4">
                  {plan.id === 'free' ? (
                    <Button className="w-full" variant="outline" disabled={isCurrentPlan}>{isCurrentPlan ? 'Current Plan' : 'Free Forever'}</Button>
                  ) : (
                    <CheckoutButton planId={plan.id} planName={plan.name} price={price} billingCycle={billingCycle} currentPlan={isCurrentPlan} />
                  )}
                </div>
                <div className="space-y-2 text-sm">
                  {plan.limits.transactions === 0 ? <FeatureItem text="Unlimited transactions" included /> : <FeatureItem text={`${plan.limits.transactions} transactions/month`} included />}
                  {plan.limits.products === 0 ? <FeatureItem text="Unlimited products" included /> : <FeatureItem text={`Up to ${plan.limits.products} products`} included />}
                  {plan.limits.aiScans === 0 ? <FeatureItem text="Unlimited AI scans" included /> : <FeatureItem text={`${plan.limits.aiScans} AI scans${plan.id === 'free' ? ' total' : '/month'}`} included />}
                </div>
                <div className="border-t border-border my-3" />
                <div className="space-y-2 text-sm">
                  <FeatureItem text="AI Bill Scanner" included={plan.features.aiScanner} />
                  <FeatureItem text="Voice Entry" included={plan.features.voiceEntry} />
                  <FeatureItem text="GSTR-1 Export" included={plan.features.gstrExport} />
                  <FeatureItem text="WhatsApp Sharing" included={plan.features.whatsappSharing} />
                  <FeatureItem text="Smart Insights" included={plan.features.smartInsights} />
                  <FeatureItem text="Recurring Entries" included={plan.features.recurringEntries} />
                  <FeatureItem text="Advanced Reports" included={plan.features.advancedReports} />
                  <FeatureItem text="Multi-Shop" included={plan.features.multiShop} />
                  <FeatureItem text="Staff Access" included={plan.features.staffAccess} />
                  <FeatureItem text="Priority Support" included={plan.features.prioritySupport} />
                </div>
              </CardContent>
            </Card>
          )
        })}
      </div>
      <div className="mt-6 bg-gradient-to-r from-blue-50 to-indigo-50 dark:from-blue-950/20 dark:to-indigo-950/20 rounded-2xl p-6 text-center border border-blue-200 dark:border-blue-900">
        <div className="flex items-center justify-center gap-2 mb-2"><Sparkles className="w-5 h-5 text-blue-600" /><h3 className="font-bold text-blue-900 dark:text-blue-400">Enterprise</h3></div>
        <p className="text-sm text-blue-700 dark:text-blue-300 mb-3">For large chains with 10+ shops. Custom pricing, API access, dedicated account manager.</p>
        <Button variant="outline" className="border-blue-300 text-blue-700 hover:bg-blue-100">Contact Sales</Button>
      </div>
    </div>
  )
}

function FeatureItem({ text, included }: { text: string; included: boolean }) {
  return (
    <div className="flex items-center gap-2">
      {included ? <Check className="w-4 h-4 text-emerald-600 flex-shrink-0" /> : <X className="w-4 h-4 text-muted-foreground/40 flex-shrink-0" />}
      <span className={cn(included ? 'text-foreground' : 'text-muted-foreground/60 line-through')}>{text}</span>
    </div>
  )
}
