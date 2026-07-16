'use client'

/**
 * 🔒 V22-9 (Phase 7) — Bill-wise Profit Report
 *
 * Shows per-invoice profit breakdown: invoice no, party, date, revenue, COGS,
 * profit, and margin %. Color-coded margin (green >15%, amber 5-15%, red <5%).
 *
 * Self-contained: receives data as prop from Reports.tsx.
 */

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { formatINR, cn, formatDate } from '@/lib/utils'
import { TrendingUp, TrendingDown, FileText, AlertTriangle } from 'lucide-react'

interface BillWiseProfitProps {
  data: any
}

export function BillWiseProfit({ data }: BillWiseProfitProps) {
  const summary = data?.summary || { totalBills: 0, totalRevenue: 0, totalCogs: 0, totalProfit: 0, avgMargin: 0 }
  const bills = data?.bills || []
  // 🔒 AUDIT V23 FIX §8.5: Show truncation warning when data is truncated.
  const truncated = data?.truncated === true
  const truncatedHint = data?.truncatedHint || 'Showing the latest 500 bills. Narrow the date range to see older bills.'

  return (
    <div className="space-y-4">
      {/* 🔒 AUDIT V23 FIX §8.5: Truncation warning banner */}
      {truncated && (
        <div className="rounded-lg bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 p-3 flex items-start gap-2">
          <AlertTriangle className="w-4 h-4 text-amber-600 dark:text-amber-400 flex-shrink-0 mt-0.5" />
          <div>
            <p className="text-xs font-semibold text-amber-800 dark:text-amber-300">Incomplete data — summary covers only shown bills</p>
            <p className="text-[11px] text-amber-700 dark:text-amber-400 mt-0.5">{truncatedHint}</p>
          </div>
        </div>
      )}

      {/* Summary stat cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <StatCard label="Total Bills" value={String(summary.totalBills)} color="text-blue-600 dark:text-blue-400" bg="bg-blue-100 dark:bg-blue-950" />
        <StatCard label="Total Revenue" value={formatINR(summary.totalRevenue)} color="text-amber-600 dark:text-amber-400" bg="bg-amber-100 dark:bg-amber-950" />
        <StatCard label="Total COGS" value={formatINR(summary.totalCogs)} color="text-rose-600 dark:text-rose-400" bg="bg-rose-100 dark:bg-rose-950" />
        <StatCard label="Total Profit" value={formatINR(summary.totalProfit)} color="text-emerald-600 dark:text-emerald-400" bg="bg-emerald-100 dark:bg-emerald-950" />
      </div>

      {/* Bills table */}
      <Card className="shadow-card border-border/60 border-t-2 border-t-primary/10">
        <CardHeader className="pb-2">
          <CardTitle className="text-base flex items-center gap-2">
            <FileText className="w-4 h-4 text-primary" />
            Bill-wise Profit Breakdown
          </CardTitle>
          <p className="text-xs text-muted-foreground">Avg margin: {summary.avgMargin}%</p>
        </CardHeader>
        <CardContent>
          <div className="overflow-auto max-h-[60vh]">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-card z-10">
                <tr className="border-b border-border text-left">
                  <th className="py-2 px-2 font-medium text-muted-foreground">Invoice</th>
                  <th className="py-2 px-2 font-medium text-muted-foreground">Date</th>
                  <th className="py-2 px-2 font-medium text-muted-foreground">Party</th>
                  <th className="py-2 px-2 font-medium text-muted-foreground text-right">Items</th>
                  <th className="py-2 px-2 font-medium text-muted-foreground text-right">Revenue</th>
                  <th className="py-2 px-2 font-medium text-muted-foreground text-right">COGS</th>
                  <th className="py-2 px-2 font-medium text-muted-foreground text-right">Profit</th>
                  <th className="py-2 px-2 font-medium text-muted-foreground text-right">Margin</th>
                </tr>
              </thead>
              <tbody>
                {bills.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="py-8 text-center text-muted-foreground">No sales in this period</td>
                  </tr>
                ) : (
                  bills.map((bill: any) => (
                    <tr key={bill.id} className="border-b border-border/50 hover:bg-muted/30">
                      <td className="py-2 px-2 font-medium">
                        <div className="flex items-center gap-1.5">
                          {bill.invoiceNo}
                          {bill.type === 'credit-note' && (
                            <Badge variant="outline" className="text-[9px] text-rose-600 border-rose-300">CN</Badge>
                          )}
                        </div>
                      </td>
                      <td className="py-2 px-2 text-muted-foreground text-xs">{formatDate(bill.date)}</td>
                      <td className="py-2 px-2 truncate max-w-[150px]">{bill.partyName}</td>
                      <td className="py-2 px-2 text-right text-muted-foreground">{bill.itemCount}</td>
                      <td className="py-2 px-2 text-right">{formatINR(bill.revenue)}</td>
                      <td className="py-2 px-2 text-right text-rose-600 dark:text-rose-400">{formatINR(bill.cogs)}</td>
                      <td className={cn(
                        'py-2 px-2 text-right font-semibold',
                        bill.profit > 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600',
                      )}>
                        {bill.profit > 0 ? '+' : ''}{formatINR(bill.profit)}
                      </td>
                      <td className="py-2 px-2 text-right">
                        <span className={cn(
                          'inline-flex items-center gap-0.5 text-xs font-semibold px-1.5 py-0.5 rounded',
                          bill.margin >= 15
                            ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-400'
                            : bill.margin >= 5
                              ? 'bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-400'
                              : 'bg-rose-100 text-rose-700 dark:bg-rose-950 dark:text-rose-400',
                        )}>
                          {bill.margin >= 0 ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
                          {bill.margin}%
                        </span>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
              {bills.length > 0 && (
                <tfoot>
                  <tr className="border-t-2 border-border font-semibold">
                    <td className="py-2 px-2" colSpan={4}>Total</td>
                    <td className="py-2 px-2 text-right">{formatINR(summary.totalRevenue)}</td>
                    <td className="py-2 px-2 text-right text-rose-600">{formatINR(summary.totalCogs)}</td>
                    <td className="py-2 px-2 text-right text-emerald-600 dark:text-emerald-400">{formatINR(summary.totalProfit)}</td>
                    <td className="py-2 px-2 text-right">{summary.avgMargin}%</td>
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}

function StatCard({ label, value, color, bg }: { label: string; value: string; color: string; bg: string }) {
  return (
    <div className="rounded-2xl bg-card border border-border/60 shadow-card p-4">
      <div className={cn('w-9 h-9 rounded-lg flex items-center justify-center mb-2', bg)}>
        <FileText className={cn('w-4 h-4', color)} />
      </div>
      <p className="text-[10px] text-muted-foreground uppercase tracking-wide font-semibold">{label}</p>
      <p className={cn('text-lg font-bold tabular-nums mt-0.5', color)}>{value}</p>
    </div>
  )
}
