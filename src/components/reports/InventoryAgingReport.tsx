'use client'

/**
 * InventoryAgingReport — shows how long products have been in stock.
 *
 * Buckets:
 *   <30 days (Fresh) → Green
 *   30-90 days (Slow) → Amber
 *   90+ days (Dead Stock) → Red
 *
 * Helps identify dead stock that ties up capital.
 */

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { formatINR, cn } from '@/lib/utils'
import { Package, AlertTriangle, TrendingDown } from 'lucide-react'

export function InventoryAgingReport({ data }: { data: any }) {
  const products = (data?.products || []).filter((p: any) => p.currentStock > 0)
  const now = new Date()

  // Age each product based on createdAt
  const agedProducts = products.map((p: any) => {
    const days = Math.floor((now.getTime() - new Date(p.createdAt).getTime()) / (1000 * 60 * 60 * 24))
    let bucket = 'fresh'
    if (days >= 90) bucket = 'dead'
    else if (days >= 30) bucket = 'slow'
    return { ...p, ageDays: days, bucket }
  })

  const buckets = {
    fresh: agedProducts.filter(p => p.bucket === 'fresh'),
    slow: agedProducts.filter(p => p.bucket === 'slow'),
    dead: agedProducts.filter(p => p.bucket === 'dead'),
  }

  const bucketValues = {
    fresh: buckets.fresh.reduce((s, p) => s + (p.stockValue || 0), 0),
    slow: buckets.slow.reduce((s, p) => s + (p.stockValue || 0), 0),
    dead: buckets.dead.reduce((s, p) => s + (p.stockValue || 0), 0),
  }

  const totalValue = bucketValues.fresh + bucketValues.slow + bucketValues.dead

  if (products.length === 0) {
    return (
      <Card className="shadow-card border-border/60">
        <CardContent className="py-12 text-center">
          <div className="w-14 h-14 rounded-full bg-muted flex items-center justify-center mx-auto mb-3">
            <Package className="w-7 h-7 text-muted-foreground" />
          </div>
          <p className="text-sm font-medium">No products in stock</p>
          <p className="text-xs text-muted-foreground mt-1">Add products to inventory to see aging analysis.</p>
        </CardContent>
      </Card>
    )
  }

  const bucketConfig = [
    { key: 'fresh', label: '< 30 Days', sublabel: 'Fresh Stock', color: 'text-emerald-600 dark:text-emerald-400', bg: 'bg-emerald-500', lightBg: 'bg-emerald-50 dark:bg-emerald-950/30', count: buckets.fresh.length, value: bucketValues.fresh },
    { key: 'slow', label: '30-90 Days', sublabel: 'Slow Moving', color: 'text-amber-600 dark:text-amber-400', bg: 'bg-amber-500', lightBg: 'bg-amber-50 dark:bg-amber-950/30', count: buckets.slow.length, value: bucketValues.slow },
    { key: 'dead', label: '90+ Days', sublabel: 'Dead Stock', color: 'text-rose-600', bg: 'bg-rose-500', lightBg: 'bg-rose-50 dark:bg-rose-950/30', count: buckets.dead.length, value: bucketValues.dead },
  ]

  return (
    <div className="space-y-4">
      {/* Summary cards */}
      <div className="grid grid-cols-3 gap-3">
        {bucketConfig.map(bucket => (
          <Card key={bucket.key} className={cn('shadow-card border-border/60 overflow-hidden', bucket.lightBg)}>
            <CardContent className="p-4">
              <div className="flex items-center gap-2 mb-1">
                <div className={cn('w-2.5 h-2.5 rounded-full', bucket.bg)} />
                <p className="text-3xs text-muted-foreground uppercase tracking-wide font-semibold">{bucket.sublabel}</p>
              </div>
              <p className="text-2xs text-muted-foreground mb-1">{bucket.label}</p>
              <p className={cn('text-lg font-bold', bucket.color)}>{formatINR(bucket.value)}</p>
              <p className="text-3xs text-muted-foreground mt-0.5">
                {bucket.count} product{bucket.count !== 1 ? 's' : ''}
                {totalValue > 0 ? ` · ${((bucket.value / totalValue) * 100).toFixed(0)}%` : ''}
              </p>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Dead stock alert */}
      {bucketValues.dead > 0 && (
        <div className="flex items-start gap-2 p-3 rounded-lg bg-rose-50 dark:bg-rose-950/30 border border-rose-200 dark:border-rose-900/50">
          <AlertTriangle className="w-4 h-4 text-rose-600 flex-shrink-0 mt-0.5" />
          <div>
            <p className="text-xs font-medium text-rose-700 dark:text-rose-400">
              {formatINR(bucketValues.dead)} tied up in dead stock (90+ days)
            </p>
            <p className="text-2xs text-rose-600 dark:text-rose-500 mt-0.5">
              Consider discounting or liquidating these products to free up capital. Dead stock reduces your business health score.
            </p>
          </div>
        </div>
      )}

      {/* Detailed table */}
      <Card className="shadow-card border-border/60">
        <CardHeader className="pb-2">
          <CardTitle className="text-base flex items-center gap-2">
            <Package className="w-4 h-4" /> Product-wise Aging
          </CardTitle>
          <p className="text-xs text-muted-foreground">{products.length} products in stock</p>
        </CardHeader>
        <CardContent>
          <div className="overflow-auto max-h-[60vh] thin-scrollbar">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-card z-10">
                <tr className="border-b border-border text-left">
                  <th className="py-2 px-2 font-medium text-muted-foreground">Product</th>
                  <th className="py-2 px-2 font-medium text-muted-foreground">Category</th>
                  <th className="py-2 px-2 font-medium text-muted-foreground text-right">Stock</th>
                  <th className="py-2 px-2 font-medium text-muted-foreground text-right">Stock Value</th>
                  <th className="py-2 px-2 font-medium text-muted-foreground text-right">Age (days)</th>
                  <th className="py-2 px-2 font-medium text-muted-foreground text-center">Status</th>
                </tr>
              </thead>
              <tbody>
                {agedProducts.sort((a, b) => b.ageDays - a.ageDays).map((p: any) => (
                  <tr key={p.id} className="border-b border-border/50 hover:bg-muted/30">
                    <td className="py-2 px-2 font-medium">{p.name}</td>
                    <td className="py-2 px-2 text-muted-foreground">{p.category || '—'}</td>
                    <td className="py-2 px-2 text-right">{p.currentStock} {p.unit}</td>
                    <td className="py-2 px-2 text-right font-medium">{formatINR(p.stockValue || 0)}</td>
                    <td className="py-2 px-2 text-right text-muted-foreground">{p.ageDays}</td>
                    <td className="py-2 px-2 text-center">
                      {p.bucket === 'fresh' && <Badge className="text-3xs bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-400">Fresh</Badge>}
                      {p.bucket === 'slow' && <Badge className="text-3xs bg-amber-100 text-amber-700 dark:bg-amber-950/40 dark:text-amber-400">Slow</Badge>}
                      {p.bucket === 'dead' && <Badge variant="destructive" className="text-3xs">Dead Stock</Badge>}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-border font-semibold">
                  <td className="py-2 px-2" colSpan={3}>Total</td>
                  <td className="py-2 px-2 text-right font-bold">{formatINR(totalValue)}</td>
                  <td className="py-2 px-2" colSpan={2}></td>
                </tr>
              </tfoot>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
