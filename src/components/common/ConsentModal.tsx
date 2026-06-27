'use client'

import { useState, useEffect } from 'react'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Shield, Check, X } from 'lucide-react'
import { setAnalyticsConsent, initAnalytics, track, EVENTS } from '@/lib/analytics'

const STORAGE_KEY = 'bahikhata-analytics-consent'

export function ConsentModal() {
  const [open, setOpen] = useState(false)

  useEffect(() => {
    if (typeof window === 'undefined') return
    try {
      const consent = localStorage.getItem(STORAGE_KEY)
      if (consent === null) {
        const timer = setTimeout(() => setOpen(true), 2000)
        return () => clearTimeout(timer)
      }
    } catch {}
  }, [])

  const handleAccept = () => {
    setAnalyticsConsent(true)
    initAnalytics()
    track(EVENTS.ONBOARDING_COMPLETED, { consent: true })
    setOpen(false)
  }

  const handleDecline = () => {
    setAnalyticsConsent(false)
    track(EVENTS.ONBOARDING_COMPLETED, { consent: false })
    setOpen(false)
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <div className="flex items-center gap-3 mb-2">
            <div className="w-10 h-10 rounded-full bg-emerald-100 flex items-center justify-center">
              <Shield className="w-5 h-5 text-emerald-600" />
            </div>
            <div>
              <DialogTitle className="text-lg">Your Privacy Matters</DialogTitle>
              <DialogDescription>Help us improve BahiKhata Pro</DialogDescription>
            </div>
          </div>
        </DialogHeader>
        <div className="py-2 space-y-3 text-sm">
          <p className="text-muted-foreground">
            We collect <b>anonymous usage data</b> to understand which features you love and fix bugs faster.
          </p>
          <div className="bg-muted/50 rounded-lg p-3 space-y-2">
            <p className="font-semibold text-xs">What we collect:</p>
            <ul className="space-y-1 text-xs text-muted-foreground">
              <li className="flex items-start gap-2"><Check className="w-3.5 h-3.5 text-emerald-600 mt-0.5 flex-shrink-0" /> Which features you use</li>
              <li className="flex items-start gap-2"><Check className="w-3.5 h-3.5 text-emerald-600 mt-0.5 flex-shrink-0" /> App performance and crashes</li>
              <li className="flex items-start gap-2"><Check className="w-3.5 h-3.5 text-emerald-600 mt-0.5 flex-shrink-0" /> Your state/region (not GPS)</li>
            </ul>
          </div>
          <div className="bg-rose-50 dark:bg-rose-950/20 rounded-lg p-3 space-y-2">
            <p className="font-semibold text-xs text-rose-700 dark:text-rose-400">What we NEVER collect:</p>
            <ul className="space-y-1 text-xs text-rose-600 dark:text-rose-400">
              <li className="flex items-start gap-2"><X className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" /> Your customers' personal data</li>
              <li className="flex items-start gap-2"><X className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" /> Your transaction amounts (only aggregates)</li>
              <li className="flex items-start gap-2"><X className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" /> GPS, contacts, or browsing history</li>
            </ul>
          </div>
        </div>
        <DialogFooter className="gap-2 flex-col sm:flex-row">
          <Button variant="outline" onClick={handleDecline} className="sm:flex-1">No thanks</Button>
          <Button onClick={handleAccept} className="sm:flex-1 bg-gradient-saffron gap-2">
            <Check className="w-4 h-4" /> Allow anonymous tracking
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
