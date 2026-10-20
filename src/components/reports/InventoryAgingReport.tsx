'use client'

/**
 * InventoryAgingReport — how long the stock you hold has sat unsold.
 *
 * Age = days since the item last sold, or since it was added if it never sold
 * (lib/stock-aging.ts — the same rule as Insights → Items, "not sold in 90
 * days"). Buckets: under 30 days, 30–89, 90 or more (dead stock). Only items
 * in stock are aged: an item with none on the shelf ties up nothing.
 *
 * 5c-4 (19 Oct): it aged by the created date, which the stock data never
 * carried — every item read "Fresh" and dead stock was always empty.
 */
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Notice } from '@/components/ui/notice'
import { formatINR, cn } from '@/lib/utils'
import { ReportRows } from '@/components/reports/ReportRows'
import { ageBucket, stockAgeDays, type AgeBucket } from '@/lib/stock-aging'
import { Package } from 'lucide-react'

interface AgedRow { id: string; name: string; category?: string | null; unit?: string | null; currentStock: number; stockValue?: number; ageDays: number | null; bucket: AgeBucket | null; neverSold: boolean }

/** The rows the report shows, aged and bucketed. Exported for the guard. */
export function agedStock(products: any[], now: Date): AgedRow[] {
  return (products || []).filter((p) => p.currentStock > 0).map((p) => {
    const ageDays = stockAgeDays(p.lastSoldAt, p.createdAt, now)
    return { ...p, ageDays, bucket: ageBucket(ageDays), neverSold: !p.lastSoldAt }
  })
}

export function InventoryAgingReport({ data }: { data: any }) {
  const agedProducts = agedStock(data?.products, new Date())
  const of = (b: AgeBucket) => agedProducts.filter((p) => p.bucket === b)
  const buckets = { fresh: of('fresh'), slow: of('slow'), dead: of('dead') }
  const value = (rows: AgedRow[]) => rows.reduce((s, p) => s + (p.stockValue || 0), 0)
  const bucketValues = { fresh: value(buckets.fresh), slow: value(buckets.slow), dead: value(buckets.dead) }
  const totalValue = bucketValues.fresh + bucketValues.slow + bucketValues.dead

  if (agedProducts.length === 0) {
    return (
      <Card className="shadow-card border-border/60">
        <CardContent className="py-12 text-center">
          <div className="w-14 h-14 rounded-full bg-muted flex items-center justify-center mx-auto mb-3">
            <Package className="w-7 h-7 text-muted-foreground" />
          </div>
          <p className="text-sm font-medium">No products in stock</p>
        </CardContent>
      </Card>
    )
  }

  const bucketConfig = [
    { key: 'fresh', label: 'Sold in the last 30 days', sublabel: 'Fresh', color: 'text-good', bg: 'bg-good', lightBg: 'bg-good-soft', count: buckets.fresh.length, value: bucketValues.fresh },
    { key: 'slow', label: '30–89 days since a sale', sublabel: 'Slow', color: 'text-check', bg: 'bg-check', lightBg: 'bg-check-soft', count: buckets.slow.length, value: bucketValues.slow },
    { key: 'dead', label: 'Not sold in 90 days', sublabel: 'Dead stock', color: 'text-bad', bg: 'bg-bad', lightBg: 'bg-bad-soft', count: buckets.dead.length, value: bucketValues.dead },
  ]

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-3 gap-3">
        {bucketConfig.map(bucket => (
          <Card key={bucket.key} className={cn('shadow-card border-border/60 overflow-hidden', bucket.lightBg)}>
            <CardContent className="p-4">
              <div className="flex items-center gap-2 mb-1">
                <div className={cn('w-2.5 h-2.5 rounded-full', bucket.bg)} />
                <p className="text-xs text-muted-foreground font-semibold">{bucket.sublabel}</p>
              </div>
              <p className="text-xs text-muted-foreground mb-1">{bucket.label}</p>
              <p className={cn('text-lg font-bold', bucket.color)}>{totalValue > 0 ? formatINR(bucket.value) : bucket.count}</p>
              <p className="text-xs text-muted-foreground mt-0.5">
                {bucket.count} product{bucket.count !== 1 ? 's' : ''}
                {totalValue > 0 ? ` · ${((bucket.value / totalValue) * 100).toFixed(0)}%` : ''}
              </p>
            </CardContent>
          </Card>
        ))}
      </div>

      {buckets.dead.length > 0 && (
        <Notice
          level="act"
          title={bucketValues.dead > 0 ? `${formatINR(bucketValues.dead)} in stock not sold in 90 days` : `${buckets.dead.length} products not sold in 90 days`}
          info="Money tied up in stock that is not selling. A discount, a return to the supplier or not reordering frees it."
        />
      )}

      <Card className="shadow-card border-border/60">
        <CardHeader className="pb-2">
          <CardTitle className="text-base flex items-center gap-2">
            <Package className="w-4 h-4" /> Product-wise Aging
          </CardTitle>
          <p className="text-xs text-muted-foreground">{agedProducts.length} products in stock</p>
        </CardHeader>
        <CardContent>
          {/* #241: on a phone each item is one row — days since a sale, the rest on tap; the table from sm up. */}
          <ReportRows
            className="sm:hidden"
            rows={[...agedProducts].sort((a, b) => (b.ageDays ?? -1) - (a.ageDays ?? -1)).map((p) => ({
              key: p.id,
              title: p.name,
              sub: `${p.currentStock} ${p.unit}${p.bucket === 'dead' ? ' · Dead stock' : p.bucket === 'slow' ? ' · Slow' : ''}`,
              value: p.ageDays === null ? '—' : p.neverSold ? `${p.ageDays} days, never sold` : `${p.ageDays} days`,
              tone: p.bucket === 'dead' ? 'bad' : p.bucket === 'slow' ? 'check' : undefined,
              details: [
                { label: 'Category', value: p.category || '—' },
                { label: 'Stock', value: `${p.currentStock} ${p.unit}` },
                ...(totalValue > 0 ? [{ label: 'Stock value', value: formatINR(p.stockValue || 0) }] : []),
              ],
            }))}
            total={totalValue > 0 ? { label: 'Stock value', value: formatINR(totalValue) } : undefined}
          />
          <div className="hidden sm:block overflow-auto max-h-[60vh] thin-scrollbar">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-card z-10">
                <tr className="border-b border-border text-left">
                  <th className="py-2 px-2 font-medium text-muted-foreground">Product</th>
                  <th className="py-2 px-2 font-medium text-muted-foreground">Category</th>
                  <th className="py-2 px-2 font-medium text-muted-foreground text-right">Stock</th>
                  {totalValue > 0 && <th className="py-2 px-2 font-medium text-muted-foreground text-right">Stock Value</th>}
                  <th className="py-2 px-2 font-medium text-muted-foreground text-right">Days since sale</th>
                  <th className="py-2 px-2 font-medium text-muted-foreground text-center">Status</th>
                </tr>
              </thead>
              <tbody>
                {[...agedProducts].sort((a, b) => (b.ageDays ?? -1) - (a.ageDays ?? -1)).map((p) => (
                  <tr key={p.id} className="border-b border-border/50 hover:bg-muted/30">
                    <td className="py-2 px-2 font-medium">{p.name}</td>
                    <td className="py-2 px-2 text-muted-foreground">{p.category || '—'}</td>
                    <td className="py-2 px-2 text-right">{p.currentStock} {p.unit}</td>
                    {totalValue > 0 && <td className="py-2 px-2 text-right font-medium">{formatINR(p.stockValue || 0)}</td>}
                    <td className="py-2 px-2 text-right text-muted-foreground">{p.ageDays === null ? '—' : p.neverSold ? `${p.ageDays} (never sold)` : p.ageDays}</td>
                    <td className="py-2 px-2 text-center">
                      {p.bucket === 'fresh' && <Badge className="text-xs bg-good-soft text-good">Fresh</Badge>}
                      {p.bucket === 'slow' && <Badge className="text-xs bg-check-soft text-check">Slow</Badge>}
                      {p.bucket === 'dead' && <Badge variant="destructive" className="text-xs">Dead stock</Badge>}
                    </td>
                  </tr>
                ))}
              </tbody>
              {totalValue > 0 && (
                <tfoot>
                  <tr className="border-t-2 border-border font-semibold">
                    <td className="py-2 px-2" colSpan={3}>Total</td>
                    <td className="py-2 px-2 text-right font-bold">{formatINR(totalValue)}</td>
                    <td className="py-2 px-2" colSpan={2}></td>
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
