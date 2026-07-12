'use client'

/**
 * PaywallModal — shows when a user tries to access a gated feature
 * without the required plan, OR when they've hit their monthly quota.
 *
 * Shows:
 * - The feature name they tried to access
 * - Which plan is required (Pro or Elite)
 * - Current usage ("You've used 5/5 free scans this month")
 * - What else is included in that plan
 * - Upgrade button (links to Pricing page)
 */

import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Crown, Lock, Check, Sparkles, TrendingUp } from 'lucide-react'
import { FEATURE_LABELS, type GatedFeature, useSubscription } from '@/hooks/use-subscription'
import { useAppStore } from '@/store/app-store'
import { track, EVENTS } from '@/lib/analytics'
import { useEffect, useRef } from 'react'

export function PaywallModal({
  feature,
  open,
  onClose,
}: {
  feature: GatedFeature | null
  open: boolean
  onClose: () => void
}) {
  const { setView } = useAppStore()
  const { usage, plan: currentPlan } = useSubscription()
  // 🔒 V20-025: Track paywall shown (only once per open, not on every render)
  const trackedRef = useRef<string | null>(null)
  useEffect(() => {
    if (open && feature && trackedRef.current !== feature) {
      trackedRef.current = feature
      track(EVENTS.PAYWALL_SHOWN, { feature, currentPlan })
    }
    if (!open) {
      trackedRef.current = null
    }
  }, [open, feature, currentPlan])

  if (!feature) return null

  const info = FEATURE_LABELS[feature]
  const requiredPlan = info.plan
  const isElite = requiredPlan === 'elite'

  // Determine which usage stat to show based on the feature
  const usageStat = feature === 'ai_scanner' ? usage?.aiScans : feature === 'voice_entry' ? usage?.voiceEntries : null
  const usageLabel = feature === 'ai_scanner' ? 'AI scans' : feature === 'voice_entry' ? 'voice entries' : ''
  const periodLabel = usageStat?.period === 'daily' ? 'today' : 'this month'

  const planFeatures = isElite
    ? ['Everything in Pro', 'Smart AI Insights', 'Advanced Reports', 'Staff Accounts', 'Priority Support']
    : ['AI Bill Scanner', 'Barcode Scanner', 'GSTR-1 Export', 'WhatsApp Sharing', 'Voice Entry', 'Recurring Entries', 'Split View (Desktop)', 'Customer Statements', 'Expense Budgets', 'Repeat Last Sale']

  const handleUpgrade = () => {
    // 🔒 V20-025: Track paywall upgrade click (user showed intent to upgrade)
    track(EVENTS.PAYWALL_DISMISSED, { feature, action: 'upgrade', currentPlan })
    onClose()
    setView('pricing')
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <div className="flex items-center justify-center w-16 h-16 rounded-2xl bg-gradient-to-br from-amber-400 to-orange-600 mx-auto mb-2 shadow-lg">
            <Lock className="w-8 h-8 text-white" />
          </div>
          <DialogTitle className="text-center text-xl">{info.label}</DialogTitle>
          <p className="text-center text-sm text-muted-foreground mt-1">
            This feature is available on the <span className="font-bold text-primary">{isElite ? 'Elite' : 'Pro'}</span> plan.
            Upgrade to unlock it and {planFeatures.length} more features.
          </p>
        </DialogHeader>

        {/* Usage stats — only show if the user has a relevant quota */}
        {usageStat && (
          <div className="rounded-xl bg-muted/50 border border-border p-3 my-2">
            <div className="flex items-center gap-2 mb-1.5">
              <TrendingUp className="w-4 h-4 text-muted-foreground" />
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                Your usage {periodLabel}
              </p>
            </div>
            <div className="flex items-center justify-between text-sm">
              <span className="text-foreground">
                {usageStat.used} / {usageStat.limit === Infinity ? '∞' : usageStat.limit} {usageLabel}
              </span>
              <span className={`font-bold ${usageStat.remaining === 0 ? 'text-red-600 dark:text-red-400' : 'text-emerald-600 dark:text-emerald-400'}`}>
                {usageStat.remaining === 0 ? 'Limit reached' : `${usageStat.remaining} left`}
              </span>
            </div>
            {/* Progress bar */}
            <div className="mt-2 h-2 bg-background rounded-full overflow-hidden">
              <div
                className={`h-full transition-all ${
                  usageStat.remaining === 0
                    ? 'bg-red-500'
                    : usageStat.used / usageStat.limit > 0.8
                    ? 'bg-amber-500'
                    : 'bg-emerald-500'
                }`}
                style={{
                  width: usageStat.limit === Infinity ? '20%' : `${Math.min(100, (usageStat.used / usageStat.limit) * 100)}%`,
                }}
              />
            </div>
            {usageStat.remaining === 0 && (
              <p className="text-[11px] text-muted-foreground mt-1.5">
                Resets on {new Date(usageStat.resetAt).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' })}.
                {currentPlan === 'free' ? ' Upgrade to Pro for 50 scans/day (Unlimited).' : ' Upgrade to Elite for 100/day.'}
              </p>
            )}
          </div>
        )}

        <div className="rounded-xl bg-gradient-to-br from-amber-50 to-orange-50 dark:from-amber-950/20 dark:to-orange-950/20 border border-amber-200 dark:border-amber-900/40 p-4 my-2">
          <div className="flex items-center gap-2 mb-3">
            <Crown className="w-5 h-5 text-amber-600 dark:text-amber-400" />
            <p className="font-bold text-base">{isElite ? 'Elite Plan' : 'Pro Plan'} includes:</p>
          </div>
          <div className="grid grid-cols-1 gap-1.5">
            {planFeatures.map((f) => (
              <div key={f} className="flex items-center gap-2 text-sm">
                <Check className="w-4 h-4 text-emerald-600 dark:text-emerald-400 flex-shrink-0" />
                <span>{f}</span>
              </div>
            ))}
          </div>
        </div>

        <DialogFooter className="flex-col gap-2">
          <Button onClick={handleUpgrade} className="w-full bg-gradient-to-r from-amber-500 to-orange-600 gap-2 shadow-lg">
            <Crown className="w-4 h-4" />
            {currentPlan === 'free' ? `Upgrade to ${isElite ? 'Elite' : 'Pro'}` : 'Manage Subscription'}
          </Button>
          <Button variant="ghost" onClick={onClose} className="w-full text-muted-foreground">
            Maybe later
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
