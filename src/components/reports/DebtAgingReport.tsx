'use client'

/**
 * DebtAgingReport — shows how long customers have owed money.
 *
 * Buckets:
 *   0-30 days (Current) → Green
 *   31-60 days (Overdue) → Amber
 *   61-90 days (Serious) → Orange
 *   90+ days (Critical) → Red
 *
 * Shows total per bucket + per-party breakdown.
 */

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { formatINR, cn } from '@/lib/utils'
import { roundMoney } from '@/lib/money'
import { AlertTriangle, Clock, User } from 'lucide-react'

export function DebtAgingReport({ data }: { data: any }) {
  const parties = data?.parties || []
  const now = new Date()

  // 🔒 AUDIT V24 §6.1 REWORK. The old code aged per-invoice dues from
  // `p.transactions` — an array the party report has returned EMPTY since the
  // SQL-aggregation refactor. Every bucket summed to 0, so this report told
  // every shop "No outstanding dues — all customers have paid" regardless of
  // reality. The most dangerous possible failure for a udhaar-tracking app.
  //
  // Now: each party's NET balance (canonical — includes payments & credit
  // notes) is aged by their OLDEST not-fully-paid invoice date, which the
  // party report supplies as `oldestUnpaidSaleDate`. This is deliberately
  // conservative (the whole balance ages by the oldest debt) and labeled
  // approximate — true per-invoice aging needs payment-to-invoice allocation,
  // which this app's single Payment stream doesn't record.
  const agedParties = parties
    .filter((p: any) => p.balance > 0)
    .map((p: any) => {
      const oldest = p.oldestUnpaidSaleDate ? new Date(p.oldestUnpaidSaleDate) : null
      const days = oldest
        ? Math.max(0, Math.floor((now.getTime() - oldest.getTime()) / (1000 * 60 * 60 * 24)))
        : 0 // balance from opening balance / no unpaid invoice on record → treat as current
      const due = roundMoney(p.balance)
      const buckets = { current: 0, overdue: 0, serious: 0, critical: 0 }
      if (days <= 30) buckets.current = due
      else if (days <= 60) buckets.overdue = due
      else if (days <= 90) buckets.serious = due
      else buckets.critical = due
      return { ...p, buckets, totalDue: due, oldestDays: days }
    })
    .filter((p: any) => p.totalDue > 0)
    .sort((a: any, b: any) => b.totalDue - a.totalDue)

  // Totals per bucket
  const totals = agedParties.reduce((acc: any, p: any) => ({
    current: acc.current + p.buckets.current,
    overdue: acc.overdue + p.buckets.overdue,
    serious: acc.serious + p.buckets.serious,
    critical: acc.critical + p.buckets.critical,
  }), { current: 0, overdue: 0, serious: 0, critical: 0 })

  const totalDue = totals.current + totals.overdue + totals.serious + totals.critical

  if (totalDue === 0) {
    return (
      <Card className="shadow-card border-border/60">
        <CardContent className="py-12 text-center">
          <div className="w-14 h-14 rounded-full bg-emerald-100 dark:bg-emerald-950/40 flex items-center justify-center mx-auto mb-3">
            <User className="w-7 h-7 text-emerald-600 dark:text-emerald-400" />
          </div>
          <p className="text-sm font-medium">No outstanding dues</p>
          <p className="text-xs text-muted-foreground mt-1">All customers have paid their bills. Great job!</p>
        </CardContent>
      </Card>
    )
  }

  const bucketConfig = [
    { key: 'current', label: '0-30 Days', sublabel: 'Current', color: 'text-emerald-600 dark:text-emerald-400', bg: 'bg-emerald-500', lightBg: 'bg-emerald-50 dark:bg-emerald-950/30' },
    { key: 'overdue', label: '31-60 Days', sublabel: 'Overdue', color: 'text-amber-600 dark:text-amber-400', bg: 'bg-amber-500', lightBg: 'bg-amber-50 dark:bg-amber-950/30' },
    { key: 'serious', label: '61-90 Days', sublabel: 'Serious', color: 'text-orange-600', bg: 'bg-orange-500', lightBg: 'bg-orange-50 dark:bg-orange-950/30' },
    { key: 'critical', label: '90+ Days', sublabel: 'Critical', color: 'text-rose-600', bg: 'bg-rose-500', lightBg: 'bg-rose-50 dark:bg-rose-950/30' },
  ]

  return (
    <div className="space-y-4">
      {/* Summary cards — one per bucket */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {bucketConfig.map(bucket => (
          <Card key={bucket.key} className={cn('shadow-card border-border/60 overflow-hidden', bucket.lightBg)}>
            <CardContent className="p-4">
              <div className="flex items-center gap-2 mb-1">
                <div className={cn('w-2.5 h-2.5 rounded-full', bucket.bg)} />
                <p className="text-3xs text-muted-foreground uppercase tracking-wide font-semibold">{bucket.sublabel}</p>
              </div>
              <p className="text-2xs text-muted-foreground mb-1">{bucket.label}</p>
              <p className={cn('text-lg font-bold', bucket.color)}>{formatINR(totals[bucket.key])}</p>
              <p className="text-3xs text-muted-foreground mt-0.5">
                {totalDue > 0 ? `${((totals[bucket.key] / totalDue) * 100).toFixed(0)}% of total` : ''}
              </p>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Per-party breakdown */}
      <Card className="shadow-card border-border/60">
        <CardHeader className="pb-2">
          <CardTitle className="text-base flex items-center gap-2">
            <Clock className="w-4 h-4" /> Customer-wise Debt Aging
          </CardTitle>
          <p className="text-xs text-muted-foreground">
            {agedParties.length} customers with outstanding dues · aged by each customer&apos;s oldest unpaid invoice (approximate — part-payments settle oldest first)
          </p>
        </CardHeader>
        <CardContent>
          <div className="overflow-auto max-h-[60vh] thin-scrollbar">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-card z-10">
                <tr className="border-b border-border text-left">
                  <th className="py-2 px-2 font-medium text-muted-foreground">Customer</th>
                  <th className="py-2 px-2 font-medium text-muted-foreground text-right">0-30d</th>
                  <th className="py-2 px-2 font-medium text-muted-foreground text-right">31-60d</th>
                  <th className="py-2 px-2 font-medium text-muted-foreground text-right">61-90d</th>
                  <th className="py-2 px-2 font-medium text-muted-foreground text-right">90+d</th>
                  <th className="py-2 px-2 font-medium text-muted-foreground text-right">Total Due</th>
                </tr>
              </thead>
              <tbody>
                {agedParties.map((p: any) => (
                  <tr key={p.party.id} className="border-b border-border/50 hover:bg-muted/30">
                    <td className="py-2 px-2 font-medium">{p.party.name}</td>
                    <td className="py-2 px-2 text-right text-emerald-600 dark:text-emerald-400">{p.buckets.current > 0 ? formatINR(p.buckets.current) : '—'}</td>
                    <td className="py-2 px-2 text-right text-amber-600 dark:text-amber-400">{p.buckets.overdue > 0 ? formatINR(p.buckets.overdue) : '—'}</td>
                    <td className="py-2 px-2 text-right text-orange-600">{p.buckets.serious > 0 ? formatINR(p.buckets.serious) : '—'}</td>
                    <td className="py-2 px-2 text-right text-rose-600">{p.buckets.critical > 0 ? formatINR(p.buckets.critical) : '—'}</td>
                    <td className="py-2 px-2 text-right font-bold">{formatINR(p.totalDue)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-border font-semibold">
                  <td className="py-2 px-2">Total</td>
                  <td className="py-2 px-2 text-right text-emerald-600 dark:text-emerald-400">{formatINR(totals.current)}</td>
                  <td className="py-2 px-2 text-right text-amber-600 dark:text-amber-400">{formatINR(totals.overdue)}</td>
                  <td className="py-2 px-2 text-right text-orange-600">{formatINR(totals.serious)}</td>
                  <td className="py-2 px-2 text-right text-rose-600">{formatINR(totals.critical)}</td>
                  <td className="py-2 px-2 text-right font-bold">{formatINR(totalDue)}</td>
                </tr>
              </tfoot>
            </table>
          </div>

          {/* Alert for critical dues */}
          {totals.critical > 0 && (
            <div className="mt-3 flex items-start gap-2 p-3 rounded-lg bg-rose-50 dark:bg-rose-950/30 border border-rose-200 dark:border-rose-900/50">
              <AlertTriangle className="w-4 h-4 text-rose-600 flex-shrink-0 mt-0.5" />
              <div>
                <p className="text-xs font-medium text-rose-700 dark:text-rose-400">
                  {formatINR(totals.critical)} is overdue by 90+ days
                </p>
                <p className="text-2xs text-rose-600 dark:text-rose-500 mt-0.5">
                  Consider sending payment reminders or following up with these customers. Long-overdue dues may need to be written off.
                </p>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
