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
import { ReportUnavailable } from '@/components/reports/ReportUnavailable'
import { Badge } from '@/components/ui/badge'
import { formatINR, cn, formatDate } from '@/lib/utils'
import { ReportRows } from '@/components/reports/ReportRows'
import { TotalsStrip } from '@/components/insights/InsightsKit'
import { NoCostNote, UnmatchedNote, marginText } from '@/components/reports/NoCostNote'
import { TrendingUp, TrendingDown, FileText, AlertTriangle } from 'lucide-react'

interface BillWiseProfitProps {
  data: any
}

export function BillWiseProfit({ data }: BillWiseProfitProps) {
  // No invented zeros — see ReportUnavailable for why a blank beats a wrong total.
  if (!data?.summary) return <ReportUnavailable what="profit report" />
  const summary = data.summary
  const bills = data?.bills || []
  // 🔒 AUDIT V23 FIX §8.5: Show truncation warning when data is truncated.
  const truncated = data?.truncated === true
  const truncatedHint = data?.truncatedHint || 'Showing the latest 500 bills. Narrow the date range to see older bills.'
  // #254: a column for sales with no cost price, only when there are some — so revenue = cost + it + profit on every row.
  const showNoCost = bills.some((b: any) => b.noCost)
  // 6a-2: a bill saved under an older rule may not add up by a little; that amount gets its own column.
  const showUnmatched = bills.some((b: any) => b.unmatched)

  return (
    <div className="space-y-4">
      {/* 🔒 AUDIT V23 FIX §8.5: Truncation warning banner */}
      {truncated && (
        <div className="rounded-lg bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 p-3 flex items-start gap-2">
          <AlertTriangle className="w-4 h-4 text-amber-600 dark:text-amber-400 flex-shrink-0 mt-0.5" />
          <div>
            <p className="text-xs font-semibold text-amber-800 dark:text-amber-300">Incomplete data — summary covers only shown bills</p>
            <p className="text-xs text-amber-700 dark:text-amber-400 mt-0.5">{truncatedHint}</p>
          </div>
        </div>
      )}

      {/* #280 (7h): the totals in one strip (Insights’ TotalsStrip) — the four icon cards filled a phone’s first screen. */}
      <TotalsStrip cells={[
        { label: 'Revenue (excl. GST)', value: formatINR(summary.totalRevenue), sub: `${summary.totalBills} bills` },
        { label: 'Cost', value: formatINR(summary.totalCogs) },
        { label: 'Profit', value: formatINR(summary.totalProfit), tone: summary.totalProfit < 0 ? 'bad' : 'good' },
      ]} />

      {/* Bills table */}
      <Card className="shadow-card border-border/60 border-t-2 border-t-primary/10">
        <CardHeader className="pb-2">
          <CardTitle className="text-base flex items-center gap-2">
            <FileText className="w-4 h-4 text-primary" />
            Bill-wise Profit Breakdown
          </CardTitle>
          <p className="text-xs text-muted-foreground flex items-center gap-1 flex-wrap">
            Avg margin: {marginText(summary.avgMargin)}
            {summary.totalNoCost ? <NoCostNote amount={summary.totalNoCost} /> : null}
            {summary.totalUnmatched ? <UnmatchedNote amount={summary.totalUnmatched} /> : null}
          </p>
        </CardHeader>
        <CardContent>
          {/* #241: on a phone each bill is one row — its profit, the rest on tap; the table from sm up. */}
          <ReportRows
            className="sm:hidden"
            empty="No sales in this period"
            rows={bills.map((bill: any) => ({
              key: bill.id,
              title: `${bill.type === 'credit-note' ? 'Return · ' : ''}${bill.invoiceNo ?? '—'}`,
              sub: `${formatDate(bill.date)} · ${bill.partyName ?? '—'}`,
              value: formatINR(bill.profit),
              tone: bill.profit < 0 ? 'bad' : undefined,
              details: [
                { label: 'Items', value: String(bill.itemCount ?? 0) },
                { label: 'Revenue (excl. GST)', value: formatINR(bill.revenue) },
                { label: 'Cost', value: formatINR(bill.cogs) },
                ...(bill.noCost ? [{ label: 'No cost price', value: formatINR(bill.noCost) }] : []),
                ...(bill.unmatched ? [{ label: 'Not matched to items', value: formatINR(bill.unmatched) }] : []),
                { label: 'Margin', value: bill.type === 'credit-note' ? '—' : marginText(bill.margin) },
              ],
            }))}
            total={{ label: 'Total profit', value: formatINR(summary.totalProfit) }}
          />
          <div className="hidden sm:block overflow-auto max-h-[60vh]">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-card z-10">
                <tr className="border-b border-border text-left">
                  <th className="py-2 px-2 font-medium text-muted-foreground">Invoice</th>
                  <th className="py-2 px-2 font-medium text-muted-foreground">Date</th>
                  <th className="py-2 px-2 font-medium text-muted-foreground">Party</th>
                  <th className="py-2 px-2 font-medium text-muted-foreground text-right">Items</th>
                  <th className="py-2 px-2 font-medium text-muted-foreground text-right">Revenue</th>
                  <th className="py-2 px-2 font-medium text-muted-foreground text-right">Cost</th>
                  {showNoCost && <th className="py-2 px-2 font-medium text-muted-foreground text-right">No cost price</th>}
                  {showUnmatched && <th className="py-2 px-2 font-medium text-muted-foreground text-right">Not matched</th>}
                  <th className="py-2 px-2 font-medium text-muted-foreground text-right">Profit</th>
                  <th className="py-2 px-2 font-medium text-muted-foreground text-right">Margin</th>
                </tr>
              </thead>
              <tbody>
                {bills.length === 0 ? (
                  <tr>
                    <td colSpan={8 + (showNoCost ? 1 : 0) + (showUnmatched ? 1 : 0)} className="py-8 text-center text-muted-foreground">No sales in this period</td>
                  </tr>
                ) : (
                  bills.map((bill: any) => (
                    <tr key={bill.id} className="border-b border-border/50 hover:bg-muted/30">
                      <td className="py-2 px-2 font-medium">
                        <div className="flex items-center gap-1.5">
                          {bill.invoiceNo}
                          {bill.type === 'credit-note' && (
                            <Badge variant="outline" className="text-xs text-rose-600 border-rose-300">CN</Badge>
                          )}
                        </div>
                      </td>
                      <td className="py-2 px-2 text-muted-foreground text-xs">{formatDate(bill.date)}</td>
                      <td className="py-2 px-2 truncate max-w-[150px]">{bill.partyName}</td>
                      <td className="py-2 px-2 text-right text-muted-foreground">{bill.itemCount}</td>
                      <td className="py-2 px-2 text-right">{formatINR(bill.revenue)}</td>
                      <td className="py-2 px-2 text-right text-rose-600 dark:text-rose-400">{formatINR(bill.cogs)}</td>
                      {showNoCost && <td className="py-2 px-2 text-right text-muted-foreground">{bill.noCost ? formatINR(bill.noCost) : '—'}</td>}
                      {showUnmatched && <td className="py-2 px-2 text-right text-muted-foreground">{bill.unmatched ? formatINR(bill.unmatched) : '—'}</td>}
                      <td className={cn(
                        'py-2 px-2 text-right font-semibold',
                        bill.profit > 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600',
                      )}>
                        {bill.profit > 0 ? '+' : ''}{formatINR(bill.profit)}
                      </td>
                      <td className="py-2 px-2 text-right">
                        {/* A return gives back the sale's profit; it has no margin of its own. */}
                        {bill.type === 'credit-note' ? (
                          <span className="text-xs text-muted-foreground">—</span>
                        ) : bill.margin === null ? (
                          <span className="text-xs font-semibold px-1.5 py-0.5 rounded bg-muted text-muted-foreground">No cost price</span>
                        ) : (
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
                        )}
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
                    {showNoCost && <td className="py-2 px-2 text-right text-muted-foreground">{formatINR(summary.totalNoCost ?? 0)}</td>}
                    {showUnmatched && <td className="py-2 px-2 text-right text-muted-foreground">{formatINR(summary.totalUnmatched ?? 0)}</td>}
                    <td className="py-2 px-2 text-right text-emerald-600 dark:text-emerald-400">{formatINR(summary.totalProfit)}</td>
                    <td className="py-2 px-2 text-right">{marginText(summary.avgMargin)}</td>
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
