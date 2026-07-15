'use client'

/**
 * 🔒 V22-12 (Batch B, Phase 7e) — Item-wise Profit Report
 *
 * Shows per-product profit breakdown: product name, qty sold, revenue, COGS,
 * profit, and margin %. Different from Bill-wise Profit (which is per-invoice).
 * This answers "which product makes me the most money?"
 *
 * Color-coded margin (green >15%, amber 5-15%, red <5%, gray for negative).
 * Self-contained: receives data as prop from Reports.tsx.
 */

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { formatINR, cn } from '@/lib/utils'
import { TrendingUp, TrendingDown, Package } from 'lucide-react'

interface ItemWiseProfitProps {
  data: any
}

export function ItemWiseProfit({ data }: ItemWiseProfitProps) {
  const summary = data?.summary || { totalProducts: 0, totalRevenue: 0, totalCogs: 0, totalProfit: 0, avgMargin: 0 }
  const items = data?.items || []

  return (
    <div className="space-y-4">
      {/* Summary stat cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <StatCard label="Products Sold" value={String(summary.totalProducts)} color="text-blue-600 dark:text-blue-400" bg="bg-blue-100 dark:bg-blue-950" />
        <StatCard label="Total Revenue" value={formatINR(summary.totalRevenue)} color="text-amber-600 dark:text-amber-400" bg="bg-amber-100 dark:bg-amber-950" />
        <StatCard label="Total COGS" value={formatINR(summary.totalCogs)} color="text-rose-600 dark:text-rose-400" bg="bg-rose-100 dark:bg-rose-950" />
        <StatCard label="Total Profit" value={formatINR(summary.totalProfit)} color="text-emerald-600 dark:text-emerald-400" bg="bg-emerald-100 dark:bg-emerald-950" />
      </div>

      {/* Items table */}
      <Card className="shadow-card border-border/60 border-t-2 border-t-primary/10">
        <CardHeader className="pb-2">
          <CardTitle className="text-base flex items-center gap-2">
            <Package className="w-4 h-4 text-primary" />
            Product-wise Profit Breakdown
          </CardTitle>
          <p className="text-xs text-muted-foreground">Avg margin: {summary.avgMargin}% • Sorted by revenue (high to low)</p>
        </CardHeader>
        <CardContent>
          <div className="overflow-auto max-h-[60vh]">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-card z-10">
                <tr className="border-b border-border text-left">
                  <th className="py-2 px-2 font-medium text-muted-foreground">#</th>
                  <th className="py-2 px-2 font-medium text-muted-foreground">Product</th>
                  <th className="py-2 px-2 font-medium text-muted-foreground text-right">Qty Sold</th>
                  <th className="py-2 px-2 font-medium text-muted-foreground text-right">Revenue</th>
                  <th className="py-2 px-2 font-medium text-muted-foreground text-right">COGS</th>
                  <th className="py-2 px-2 font-medium text-muted-foreground text-right">Profit</th>
                  <th className="py-2 px-2 font-medium text-muted-foreground text-right">Margin</th>
                </tr>
              </thead>
              <tbody>
                {items.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="py-8 text-center text-muted-foreground">
                      No products sold in this period
                    </td>
                  </tr>
                ) : (
                  items.map((item: any, idx: number) => (
                    <tr key={idx} className="border-b border-border/50 hover:bg-muted/30">
                      <td className="py-2 px-2 text-muted-foreground text-xs">{idx + 1}</td>
                      <td className="py-2 px-2 font-medium truncate max-w-[200px]">{item.productName}</td>
                      <td className="py-2 px-2 text-right text-muted-foreground tabular-nums">{item.totalQty}</td>
                      <td className="py-2 px-2 text-right tabular-nums">{formatINR(item.revenue)}</td>
                      <td className="py-2 px-2 text-right text-rose-600 dark:text-rose-400 tabular-nums">{formatINR(item.cogs)}</td>
                      <td className={cn(
                        'py-2 px-2 text-right font-semibold tabular-nums',
                        item.profit > 0 ? 'text-emerald-600 dark:text-emerald-400' : item.profit < 0 ? 'text-rose-600' : 'text-muted-foreground',
                      )}>
                        {item.profit > 0 ? '+' : ''}{formatINR(item.profit)}
                      </td>
                      <td className="py-2 px-2 text-right">
                        <span className={cn(
                          'inline-flex items-center gap-0.5 text-xs font-semibold px-1.5 py-0.5 rounded',
                          item.margin >= 15
                            ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-400'
                            : item.margin >= 5
                              ? 'bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-400'
                              : item.margin >= 0
                                ? 'bg-rose-100 text-rose-700 dark:bg-rose-950 dark:text-rose-400'
                                : 'bg-muted text-muted-foreground',
                        )}>
                          {item.margin >= 0 ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
                          {item.margin}%
                        </span>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
              {items.length > 0 && (
                <tfoot>
                  <tr className="border-t-2 border-border font-semibold">
                    <td className="py-2 px-2" colSpan={2}>Total ({summary.totalProducts} products)</td>
                    <td className="py-2 px-2"></td>
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
        <Package className={cn('w-4 h-4', color)} />
      </div>
      <p className="text-[10px] text-muted-foreground uppercase tracking-wide font-semibold">{label}</p>
      <p className={cn('text-lg font-bold tabular-nums mt-0.5', color)}>{value}</p>
    </div>
  )
}
