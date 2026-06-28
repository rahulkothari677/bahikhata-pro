'use client'

/**
 * PaywallModal — shows when a user tries to access a gated feature
 * without the required plan.
 *
 * Shows:
 * - The feature name they tried to access
 * - Which plan is required (Pro or Elite)
 * - What else is included in that plan
 * - Upgrade button (links to Pricing page)
 */

import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Crown, Lock, Check, Sparkles } from 'lucide-react'
import { FEATURE_LABELS, type GatedFeature } from '@/hooks/use-subscription'
import { useAppStore } from '@/store/app-store'

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

  if (!feature) return null

  const info = FEATURE_LABELS[feature]
  const requiredPlan = info.plan
  const isElite = requiredPlan === 'elite'

  const planFeatures = isElite
    ? ['Everything in Pro', 'Smart AI Insights', 'Advanced Reports', 'Staff Accounts', 'Priority Support']
    : ['AI Bill Scanner', 'Barcode Scanner', 'GSTR-1 Export', 'WhatsApp Sharing', 'Voice Entry', 'Recurring Entries', 'Split View (Desktop)', 'Customer Statements', 'Expense Budgets', 'Repeat Last Sale']

  const handleUpgrade = () => {
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

        <div className="rounded-xl bg-gradient-to-br from-amber-50 to-orange-50 dark:from-amber-950/20 dark:to-orange-950/20 border border-amber-200 dark:border-amber-900/40 p-4 my-2">
          <div className="flex items-center gap-2 mb-3">
            <Crown className="w-5 h-5 text-amber-600" />
            <p className="font-bold text-base">{isElite ? 'Elite Plan' : 'Pro Plan'} includes:</p>
          </div>
          <div className="grid grid-cols-1 gap-1.5">
            {planFeatures.map((f) => (
              <div key={f} className="flex items-center gap-2 text-sm">
                <Check className="w-4 h-4 text-emerald-600 flex-shrink-0" />
                <span>{f}</span>
              </div>
            ))}
          </div>
        </div>

        <DialogFooter className="flex-col gap-2">
          <Button onClick={handleUpgrade} className="w-full bg-gradient-to-r from-amber-500 to-orange-600 gap-2 shadow-lg">
            <Crown className="w-4 h-4" />
            Upgrade to {isElite ? 'Elite' : 'Pro'}
          </Button>
          <Button variant="ghost" onClick={onClose} className="w-full text-muted-foreground">
            Maybe later
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
