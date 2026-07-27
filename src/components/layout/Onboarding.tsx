'use client'

import { useState } from 'react'
import { useAppStore } from '@/store/app-store'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { toast as sonnerToast } from 'sonner'
import { BookOpenText, ScanLine, ShoppingCart, Package, Wallet, FileBarChart, Sparkles, Loader2, ArrowRight, Plus, Store, User, Phone } from 'lucide-react'
import { offlineFetch } from '@/lib/offline-fetch'

/**
 * Onboarding — first-run welcome dialog.
 *
 * 🐛 UI/UX Phase 1 Fix 2: The previous primary CTA was "Record your first sale"
 * which sent users to the New Sale form with NO products — a dead-end. Now the
 * primary CTA is "Set up your shop" which collects 3 quick fields (shop name,
 * owner name, phone) and then navigates to Inventory to add the first product.
 *
 * Three CTAs (in priority order):
 *   1. "Set up your shop" (primary) — 3-field quick setup → Inventory
 *   2. "Load Demo Data" (secondary) — seeds 15 products + 7 parties + 60 days
 *   3. "Explore first" (tertiary) — just dismisses, no data written
 *
 * The progressive disclosure part (guiding the user through first product →
 * first sale) is handled by the Dashboard's welcome card (see Fix 6).
 */
export function Onboarding({ open, onDone }: { open: boolean; onDone: () => void }) {
  const { triggerRefresh, setView } = useAppStore()
  const [seeding, setSeeding] = useState(false)
  const [skipping, setSkipping] = useState(false)

  // 🐛 Fix 2: Setup mode state
  const [setupMode, setSetupMode] = useState(false)
  const [setupForm, setSetupForm] = useState({ shopName: '', ownerName: '', phone: '' })
  const [setupLoading, setSetupLoading] = useState(false)

  const handleSeed = async () => {
    setSeeding(true)
    try {
      const r = await offlineFetch('/api/seed', { method: 'POST', offline: { queueable: false, invalidate: ['/api/products', '/api/parties', '/api/transactions', '/api/dashboard'] } })
      if (!r.ok) throw new Error('seed failed')
      const data = await r.json()
      if (data.skipped) {
        sonnerToast.info('Demo data already exists')
      } else {
        sonnerToast.success(`Added ${data.products} products, ${data.parties} parties, ${data.sales + data.purchases} transactions!`)
      }
      triggerRefresh()
      onDone()
    } catch {
      sonnerToast.error("Couldn't set up demo data")
    } finally {
      setSeeding(false)
    }
  }

  // 🐛 Fix 4: Outside-click / X button should NOT write 'My Shop' to the DB.
  // Just dismiss. The onboarding will re-show on next load (Fix 3 makes this
  // persistent via localStorage), which is the correct behavior — the user
  // hasn't set up their shop yet.
  const handleSkip = () => {
    onDone()
  }

  // 🐛 Fix 2: The primary CTA — set up shop with 3 quick fields.
  // After saving, navigate to Inventory so the user can add their first product.
  // This avoids the dead-end of sending them to New Sale with no products.
  const handleSetupSubmit = async () => {
    if (!setupForm.shopName.trim()) {
      sonnerToast.error('Please enter your shop name')
      return
    }
    setSetupLoading(true)
    try {
      await offlineFetch('/api/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          shopName: setupForm.shopName.trim(),
          ownerName: setupForm.ownerName.trim() || undefined,
          phone: setupForm.phone.trim() || undefined,
        }),
        offline: { invalidate: ['/api/settings', '/api/dashboard'] },
      })
      triggerRefresh()
      onDone()
      // Navigate to Inventory so the user can add their first product.
      // The Dashboard's welcome card will then guide them to record their first sale.
      setView('inventory')
      sonnerToast.success('Shop details saved! Now add your first product.')
    } catch {
      sonnerToast.error('Could not save shop details. Please try again.')
    } finally {
      setSetupLoading(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && handleSkip()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <div className="flex items-center justify-center w-16 h-16 rounded-2xl bg-gradient-saffron mx-auto mb-2 shadow-lg">
            <BookOpenText className="w-8 h-8 text-white" />
          </div>
          <DialogTitle className="text-center text-2xl">Welcome to EkBook</DialogTitle>
          <DialogDescription className="text-center">
            India&apos;s smartest ledger app for small shop owners
          </DialogDescription>
        </DialogHeader>

        {!setupMode ? (
          /* Welcome screen — feature overview + 3 CTAs */
          <div className="space-y-4 py-2">
            <p className="text-center text-sm text-muted-foreground">
              Let&apos;s get you started! Here&apos;s what you can do:
            </p>

            <div className="grid grid-cols-2 gap-3">
              <FeatureBox icon={ScanLine} title="AI Bill Scanner" desc="Snap a bill, we auto-fill everything" color="text-amber-600 dark:text-amber-400 bg-amber-100" />
              <FeatureBox icon={Package} title="Smart Inventory" desc="Track stock, prices, low-stock alerts" color="text-violet-600 bg-violet-100" />
              <FeatureBox icon={ShoppingCart} title="Sales & Purchase" desc="Record transactions with auto profit calc" color="text-emerald-600 dark:text-emerald-400 bg-emerald-100" />
              <FeatureBox icon={FileBarChart} title="Reports & GST" desc="P&L, GST returns, stock valuation" color="text-rose-600 bg-rose-100" />
            </div>

            <div className="rounded-xl bg-gradient-saffron/10 border border-primary/30 p-4">
              <div className="flex items-start gap-3">
                <Sparkles className="w-5 h-5 text-primary flex-shrink-0 mt-0.5" />
                <div>
                  <p className="font-semibold text-sm">Try with demo data</p>
                  <p className="text-xs text-muted-foreground mt-1">
                    We&apos;ll add a sample kirana store with 15 products, 7 customers/suppliers, and 60 days of transactions. You can reset anytime.
                  </p>
                </div>
              </div>
            </div>

            <div className="flex flex-col gap-3">
              {/* 🐛 UI/UX Phase 1 Fix 2: Primary CTA is now "Set up your shop"
                  — collects 3 quick fields, then navigates to Inventory.
                  Was: "Record your first sale" which dead-ended users with no products. */}
              <Button
                className="w-full bg-gradient-saffron gap-2 shadow-md"
                onClick={() => setSetupMode(true)}
                disabled={seeding || skipping}
              >
                <Store className="w-4 h-4" />
                Set up your shop
                <ArrowRight className="w-4 h-4" />
              </Button>
              <div className="flex flex-col sm:flex-row gap-3">
                <Button
                  variant="outline"
                  className="flex-1 gap-2"
                  onClick={handleSeed}
                  disabled={seeding || skipping}
                >
                  {seeding ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      Setting up demo data...
                    </>
                  ) : (
                    <>
                      <Sparkles className="w-4 h-4" />
                      Load Demo Data
                    </>
                  )}
                </Button>
                <Button
                  variant="ghost"
                  className="flex-1"
                  onClick={handleSkip}
                  disabled={seeding || skipping}
                >
                  Explore first
                </Button>
              </div>
            </div>
          </div>
        ) : (
          /* Setup screen — 3 quick fields */
          <div className="space-y-4 py-2">
            <p className="text-center text-sm text-muted-foreground">
              Let&apos;s set up your shop. This takes 30 seconds — you can change everything later.
            </p>

            <div className="space-y-3">
              <div>
                <Label htmlFor="shopName" className="text-sm font-medium">Shop Name *</Label>
                <div className="relative mt-1">
                  <Store className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                  <Input
                    id="shopName"
                    value={setupForm.shopName}
                    onChange={(e) => setSetupForm({ ...setupForm, shopName: e.target.value })}
                    placeholder="e.g. Sharma Kirana Store"
                    className="pl-9"
                    autoFocus
                    onKeyDown={(e) => e.key === 'Enter' && handleSetupSubmit()}
                  />
                </div>
              </div>

              <div>
                <Label htmlFor="ownerName" className="text-sm font-medium">Your Name (optional)</Label>
                <div className="relative mt-1">
                  <User className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                  <Input
                    id="ownerName"
                    value={setupForm.ownerName}
                    onChange={(e) => setSetupForm({ ...setupForm, ownerName: e.target.value })}
                    placeholder="e.g. Rajesh Sharma"
                    className="pl-9"
                    onKeyDown={(e) => e.key === 'Enter' && handleSetupSubmit()}
                  />
                </div>
              </div>

              <div>
                <Label htmlFor="phone" className="text-sm font-medium">Phone (optional)</Label>
                <div className="relative mt-1">
                  <Phone className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                  <Input
                    id="phone"
                    type="tel"
                    value={setupForm.phone}
                    onChange={(e) => setSetupForm({ ...setupForm, phone: e.target.value })}
                    placeholder="e.g. 9876543210"
                    className="pl-9"
                    onKeyDown={(e) => e.key === 'Enter' && handleSetupSubmit()}
                  />
                </div>
              </div>
            </div>

            <div className="flex flex-col sm:flex-row gap-3 pt-2">
              <Button
                variant="ghost"
                onClick={() => setSetupMode(false)}
                disabled={setupLoading}
                className="sm:flex-1"
              >
                Back
              </Button>
              <Button
                className="sm:flex-1 bg-gradient-saffron gap-2"
                onClick={handleSetupSubmit}
                disabled={setupLoading || !setupForm.shopName.trim()}
              >
                {setupLoading ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Saving...
                  </>
                ) : (
                  <>
                    <Plus className="w-4 h-4" />
                    Save & Add Products
                    <ArrowRight className="w-4 h-4" />
                  </>
                )}
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}

function FeatureBox({ icon: Icon, title, desc, color }: { icon: any; title: string; desc: string; color: string }) {
  return (
    <div className="rounded-lg border border-border p-3">
      <div className={`w-8 h-8 rounded-lg flex items-center justify-center mb-2 ${color}`}>
        <Icon className="w-4 h-4" />
      </div>
      <p className="text-sm font-semibold">{title}</p>
      <p className="text-2xs text-muted-foreground mt-0.5">{desc}</p>
    </div>
  )
}
