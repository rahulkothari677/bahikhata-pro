'use client'

import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog'
import { formatINR, cn } from '@/lib/utils'
import {
  Wallet, ArrowDownCircle, ArrowUpCircle, HandCoins,
  Receipt, TrendingUp, TrendingDown, Calculator, Loader2, MessageCircle,
} from 'lucide-react'
import { offlineFetch } from '@/lib/offline-fetch'
import { toast as sonnerToast } from 'sonner'
import { haptic } from '@/lib/haptic'
import { readError } from '@/lib/read-error'

/**
 * 🔒 V17-Ext §5.4: Daily "Close the Drawer" summary.
 *
 * A 10-second end-of-day ritual. Shows today's cash flow breakdown so the
 * shopkeeper can reconcile their cash drawer. They can optionally count
 * their actual cash and see if it matches the expected amount.
 *
 * Designed to be a habit: open it at end of day, count the cash, see if
 * it ties out. If there's a big variance, something's wrong (missed sale,
 * wrong change, theft). If it ties out, peace of mind.
 */
export function DayEndSummary({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const [actualCash, setActualCash] = useState('')
  const [showVariance, setShowVariance] = useState(false)

  const { data, isLoading } = useQuery({
    queryKey: ['day-summary'],
    queryFn: async () => {
      const r = await offlineFetch('/api/day-summary')
      if (!r.ok) throw new Error(await readError(r))
      return r.json()
    },
    enabled: open, // only fetch when the dialog is open
  })

  const expectedCash = data?.expectedCash ?? 0
  const actual = parseFloat(actualCash) || 0
  const variance = Math.round((actual - expectedCash) * 100) / 100

  const handleShare = async () => {
    if (!data) return
    const lines: string[] = []
    // 🔒 R9-3 v2 (Verification Ledger): Was `new Date().toLocaleDateString('en-IN')`
    // which uses the server's UTC timezone on Vercel → shows yesterday's date
    // between midnight IST and 5:30 AM IST. Now: force IST timezone.
    lines.push(`📋 Day Summary — ${new Date().toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata' })}`)
    lines.push('')
    lines.push(`💰 Cash Sales: ${formatINR(data.cashSales)}`)
    if (data.upiSales > 0) lines.push(`📱 UPI Sales: ${formatINR(data.upiSales)}`)
    if (data.cardSales > 0) lines.push(`💳 Card Sales: ${formatINR(data.cardSales)}`)
    if (data.bankSales > 0) lines.push(`🏦 Bank Sales: ${formatINR(data.bankSales)}`)
    if (data.creditSales > 0) lines.push(`📝 Udhaar Sales: ${formatINR(data.creditSales)}`)
    lines.push(`📊 Total Sales: ${formatINR(data.totalSales)}`)
    lines.push('')
    if (data.cashPurchases > 0) lines.push(`🛒 Cash Purchases: ${formatINR(data.cashPurchases)}`)
    if (data.expenses > 0) lines.push(`💸 Expenses: ${formatINR(data.expenses)}`)
    if (data.udhaarCollected > 0) lines.push(`✅ Udhaar Collected: ${formatINR(data.udhaarCollected)}`)
    if (data.udhaarPaid > 0) lines.push(`📤 Udhaar Paid: ${formatINR(data.udhaarPaid)}`)
    lines.push('')
    lines.push(`🟢 Expected Cash: ${formatINR(data.expectedCash)}`)
    if (showVariance) {
      lines.push(`🔵 Counted Cash: ${formatINR(actual)}`)
      const v = variance >= 0 ? `+${formatINR(variance)}` : formatINR(variance)
      lines.push(`${variance >= 0 ? '✅' : '⚠️'} Variance: ${v}`)
    }
    lines.push('')
    lines.push(`${data.transactionCount} transactions today`)

    const message = encodeURIComponent(lines.join('\n'))
    window.open(`https://wa.me/?text=${message}`, '_blank')
    haptic.success()
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Wallet className="w-5 h-5 text-primary" />
            Close the Drawer
          </DialogTitle>
        </DialogHeader>

        {isLoading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
          </div>
        ) : data ? (
          <div className="space-y-4">
            {/* Date + transaction count */}
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              {/* 🔒 R9-3 v2: Force IST so the date matches the user's local day. */}
              <span>{new Date().toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata' })}</span>
              <Badge variant="secondary">{data.transactionCount} transactions</Badge>
            </div>

            {/* Sales breakdown */}
            <div className="space-y-2">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Sales Today</p>
              <SummaryRow icon={<TrendingUp className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />} label="Cash" value={data.cashSales} highlight />
              {data.upiSales > 0 && (
                <SummaryRow icon={<TrendingUp className="w-4 h-4 text-blue-600" />} label="UPI" value={data.upiSales} />
              )}
              {data.cardSales > 0 && (
                <SummaryRow icon={<TrendingUp className="w-4 h-4 text-purple-600" />} label="Card" value={data.cardSales} />
              )}
              {data.bankSales > 0 && (
                <SummaryRow icon={<TrendingUp className="w-4 h-4 text-indigo-600" />} label="Bank" value={data.bankSales} />
              )}
              {data.creditSales > 0 && (
                <SummaryRow icon={<HandCoins className="w-4 h-4 text-amber-600 dark:text-amber-400" />} label="Udhaar (credit)" value={data.creditSales} />
              )}
              <div className="flex items-center justify-between border-t border-border pt-2 mt-1">
                <span className="text-sm font-semibold">Total Sales</span>
                <span className="text-sm font-bold tabular-nums">{formatINR(data.totalSales)}</span>
              </div>
              {/* 🔒 V17 Audit Phase 1 P0.4: Show credit-note refunds as a separate line
                  so the shopkeeper can reconcile the drawer. Without this, the net
                  cash sales number was opaque — the shopkeeper didn't know a refund
                  was subtracted. */}
              {data.creditNoteRefunds > 0 && (
                <SummaryRow
                  icon={<TrendingDown className="w-4 h-4 text-violet-600" />}
                  label="Credit Note Refunds"
                  value={-data.creditNoteRefunds}
                />
              )}
            </div>

            {/* Cash out */}
            {(data.cashPurchases > 0 || data.expenses > 0 || data.udhaarPaid > 0) && (
              <div className="space-y-2">
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Cash Out Today</p>
                {data.cashPurchases > 0 && (
                  <SummaryRow icon={<TrendingDown className="w-4 h-4 text-rose-600" />} label="Cash Purchases" value={-data.cashPurchases} />
                )}
                {data.expenses > 0 && (
                  <SummaryRow icon={<ArrowDownCircle className="w-4 h-4 text-rose-600" />} label="Expenses" value={-data.expenses} />
                )}
                {data.udhaarPaid > 0 && (
                  <SummaryRow icon={<ArrowUpCircle className="w-4 h-4 text-rose-600" />} label="Udhaar Paid" value={-data.udhaarPaid} />
                )}
              </div>
            )}

            {/* Udhaar collected */}
            {data.udhaarCollected > 0 && (
              <div className="space-y-2">
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Udhaar Collected</p>
                <SummaryRow icon={<HandCoins className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />} label="Payments Received" value={data.udhaarCollected} highlight />
              </div>
            )}

            {/* Expected cash */}
            <div className="rounded-lg bg-primary/10 border border-primary/20 p-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Wallet className="w-4 h-4 text-primary" />
                  <span className="text-sm font-semibold">Expected Cash in Drawer</span>
                </div>
                <span className="text-lg font-bold tabular-nums text-primary">{formatINR(expectedCash)}</span>
              </div>
              <p className="text-xs text-muted-foreground mt-1">
                Cash sales + income + udhaar collected − cash purchases − expenses − udhaar paid
              </p>
            </div>

            {/* Cash counting (optional) */}
            {!showVariance ? (
              <Button
                variant="outline"
                className="w-full gap-2"
                onClick={() => setShowVariance(true)}
              >
                <Calculator className="w-4 h-4" />
                Count Cash Drawer
              </Button>
            ) : (
              <div className="space-y-3 rounded-lg border border-border p-3">
                <div>
                  <Label className="text-xs" htmlFor="field-counted-cash-in-drawer">Counted Cash in Drawer</Label>
                  <Input id="field-counted-cash-in-drawer"
                    inputMode="decimal" type="number"
                    value={actualCash}
                    onChange={(e) => setActualCash(e.target.value)}
                    placeholder="0"
                    className="mt-1 text-lg font-bold tabular-nums"
                    autoFocus
                  />
                </div>
                {actualCash && (
                  <div className={cn(
                    'flex items-center justify-between rounded-md p-2 text-sm font-medium',
                    Math.abs(variance) < 1
                      ? 'bg-emerald-100 text-emerald-700 dark:text-emerald-300'
                      : variance > 0
                      ? 'bg-blue-100 text-blue-700'
                      : 'bg-rose-100 text-rose-700'
                  )}>
                    <span>
                      {Math.abs(variance) < 1
                        ? '✓ Cash matches!'
                        : variance > 0
                        ? `₹${variance.toFixed(2)} extra`
                        : `₹${Math.abs(variance).toFixed(2)} short`}
                    </span>
                    <span className="text-xs opacity-70">
                      Expected: {formatINR(expectedCash)}
                    </span>
                  </div>
                )}
                <Button
                  variant="ghost"
                  size="sm"
                  className="w-full text-xs"
                  onClick={() => { setShowVariance(false); setActualCash('') }}
                >
                  Hide cash counter
                </Button>
              </div>
            )}
          </div>
        ) : (
          <p className="text-center py-8 text-sm text-muted-foreground">Couldn't load the summary</p>
        )}

        <DialogFooter className="gap-2">
          <Button variant="outline" className="gap-2" onClick={handleShare} disabled={!data}>
            <MessageCircle className="w-4 h-4" />
            Share
          </Button>
          <Button onClick={() => onOpenChange(false)} className="gap-2 bg-gradient-saffron">
            Done
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function SummaryRow({ icon, label, value, highlight }: {
  icon: React.ReactNode
  label: string
  value: number
  highlight?: boolean
}) {
  const isPositive = value >= 0
  return (
    <div className={cn(
      'flex items-center justify-between py-1',
      highlight && 'font-medium',
    )}>
      <div className="flex items-center gap-2">
        {icon}
        <span className="text-sm text-muted-foreground">{label}</span>
      </div>
      <span className={cn(
        'text-sm tabular-nums',
        isPositive ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600',
        highlight && 'font-bold',
      )}>
        {isPositive ? '+' : ''}{formatINR(value)}
      </span>
    </div>
  )
}
