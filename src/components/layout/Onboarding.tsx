'use client'

import { useState } from 'react'
import { useAppStore } from '@/store/app-store'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { toast as sonnerToast } from 'sonner'
import { BookOpenText, ScanLine, ShoppingCart, Package, Wallet, FileBarChart, Sparkles, Loader2, ArrowRight } from 'lucide-react'
import { offlineFetch } from '@/lib/offline-fetch'

export function Onboarding({ open, onDone }: { open: boolean; onDone: () => void }) {
  const { triggerRefresh, setView } = useAppStore()
  const [seeding, setSeeding] = useState(false)
  const [skipping, setSkipping] = useState(false)

  const handleSeed = async () => {
    setSeeding(true)
    try {
      const r = await offlineFetch('/api/seed', { method: 'POST', offline: { queueable: false, invalidate: ['/api/products', '/api/parties', '/api/transactions', '/api/dashboard'] } })
      const data = await r.json()
      if (data.skipped) {
        sonnerToast.info('Demo data already exists')
      } else {
        sonnerToast.success(`Added ${data.products} products, ${data.parties} parties, ${data.sales + data.purchases} transactions!`)
      }
      triggerRefresh()
      onDone()
    } catch {
      sonnerToast.error('Failed to seed demo data')
    } finally {
      setSeeding(false)
    }
  }

  const handleSkip = async () => {
    setSkipping(true)
    // Create empty setting so the app doesn't keep showing onboarding
    try {
      await offlineFetch('/api/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ shopName: 'My Shop' }),
        offline: { invalidate: ['/api/settings', '/api/dashboard'] },
      })
    } catch {}
    onDone()
    setSkipping(false)
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

        <div className="space-y-4 py-2">
          <p className="text-center text-sm text-muted-foreground">
            Let&apos;s get you started! Here&apos;s what you can do:
          </p>

          <div className="grid grid-cols-2 gap-3">
            <FeatureBox icon={ScanLine} title="AI Bill Scanner" desc="Snap a bill, we auto-fill everything" color="text-amber-600 bg-amber-100" />
            <FeatureBox icon={Package} title="Smart Inventory" desc="Track stock, prices, low-stock alerts" color="text-violet-600 bg-violet-100" />
            <FeatureBox icon={ShoppingCart} title="Sales & Purchase" desc="Record transactions with auto profit calc" color="text-emerald-600 bg-emerald-100" />
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

          <div className="flex flex-col sm:flex-row gap-3">
            <Button
              variant="outline"
              className="flex-1"
              onClick={handleSkip}
              disabled={seeding || skipping}
            >
              {skipping ? 'Starting...' : 'Start Fresh (Empty)'}
            </Button>
            <Button
              className="flex-1 bg-gradient-saffron gap-2 shadow-md"
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
                  <ArrowRight className="w-4 h-4" />
                </>
              )}
            </Button>
          </div>
        </div>
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
      <p className="text-[11px] text-muted-foreground mt-0.5">{desc}</p>
    </div>
  )
}
