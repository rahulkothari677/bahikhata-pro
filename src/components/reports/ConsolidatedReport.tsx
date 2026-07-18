'use client'

/**
 * 🔒 V17 Audit Phase 7 — Multi-Shop Consolidated Reports UI.
 *
 * Shows a per-shop breakdown + consolidated total for P&L, GST, and Stock.
 * The owner can see which shop is performing best and compare across shops.
 *
 * Self-contained: own data fetching, own date range, all hooks before early return.
 */

import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { Button } from '@/components/ui/button'
import { formatINR, cn } from '@/lib/utils'
import { offlineFetch } from '@/lib/offline-fetch'
import { DateRangePicker, getPresetRange, type DateRange, type DatePreset } from '@/components/common/DateRangePicker'
import {
  TrendingUp, TrendingDown, Store, Package, Receipt, Wallet,
  ChevronDown, ChevronUp, ShoppingBag,
} from 'lucide-react'
import { format } from 'date-fns'

type ViewMode = 'pl' | 'gst' | 'stock'

export function ConsolidatedReport() {
  const [viewMode, setViewMode] = useState<ViewMode>('pl')
  const [dateRange, setDateRange] = useState<DateRange>(() => getPresetRange('thisMonth'))
  const [expandedShops, setExpandedShops] = useState<Set<string>>(new Set())

  const { data, isLoading } = useQuery({
    queryKey: ['consolidated-report', dateRange.from.toISOString(), dateRange.to.toISOString()],
    queryFn: async () => {
      const r = await offlineFetch(
        `/api/reports/consolidated?from=${dateRange.from.toISOString()}&to=${dateRange.to.toISOString()}`
      )
      if (!r.ok) throw new Error('Failed to load consolidated report')
      return r.json()
    },
  })

  const toggleShop = (shopId: string) => {
    setExpandedShops(prev => {
      const next = new Set(prev)
      if (next.has(shopId)) next.delete(shopId)
      else next.add(shopId)
      return next
    })
  }

  if (isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-16 w-full rounded-xl" />
        <Skeleton className="h-64 w-full rounded-xl" />
      </div>
    )
  }

  if (!data?.shops?.length) {
    return (
      <Card className="shadow-card border-border/60">
        <CardContent className="py-8 text-center">
          <Store className="w-10 h-10 mx-auto mb-3 text-muted-foreground/40" />
          <p className="text-sm font-medium">No shops found</p>
          <p className="text-xs text-muted-foreground mt-1">
            Create a shop in Settings to start using consolidated reports.
          </p>
        </CardContent>
      </Card>
    )
  }

  const shops = data.shops
  const total = data.total

  return (
    <div className="space-y-4">
      {/* Date range + view mode toggle */}
      <div className="flex flex-col sm:flex-row gap-3 items-start sm:items-center justify-between">
        <DateRangePicker
          value={dateRange}
          preset="thisMonth"
          onChange={(range: DateRange, _preset: DatePreset) => { setDateRange(range) }}
          onPresetChange={() => {}}
        />
        <div className="flex gap-1 bg-muted rounded-lg p-1">
          <Button
            size="sm"
            variant={viewMode === 'pl' ? 'default' : 'ghost'}
            onClick={() => setViewMode('pl')}
            className="gap-1.5"
          >
            <Wallet className="w-3.5 h-3.5" /> P&L
          </Button>
          <Button
            size="sm"
            variant={viewMode === 'gst' ? 'default' : 'ghost'}
            onClick={() => setViewMode('gst')}
            className="gap-1.5"
          >
            <Receipt className="w-3.5 h-3.5" /> GST
          </Button>
          <Button
            size="sm"
            variant={viewMode === 'stock' ? 'default' : 'ghost'}
            onClick={() => setViewMode('stock')}
            className="gap-1.5"
          >
            <Package className="w-3.5 h-3.5" /> Stock
          </Button>
        </div>
      </div>

      {/* Consolidated total banner */}
      <div className={cn(
        'rounded-2xl p-5 text-white shadow-lg',
        viewMode === 'pl' && 'bg-gradient-to-r from-emerald-500 to-teal-600',
        viewMode === 'gst' && 'bg-gradient-to-r from-rose-500 to-red-600',
        viewMode === 'stock' && 'bg-gradient-to-r from-blue-500 to-indigo-600',
      )}>
        <div className="flex items-center justify-between">
          <div>
            <p className="text-white/80 text-xs font-medium uppercase tracking-wide">
              {viewMode === 'pl' && (total.netProfit === undefined ? 'Consolidated Revenue' : 'Consolidated Net Profit')}
              {viewMode === 'gst' && 'Consolidated Net GST Payable'}
              {viewMode === 'stock' && 'Consolidated Stock Value'}
            </p>
            <p className="text-3xl font-bold tabular-nums mt-1">
              {viewMode === 'pl' && (total.netProfit === undefined ? formatINR(total.revenue) : formatINR(total.netProfit))}
              {viewMode === 'gst' && formatINR(total.netGST)}
              {viewMode === 'stock' && formatINR(total.stockValue)}
            </p>
            <p className="text-white/70 text-xs mt-1">
              Across {shops.length} shop{shops.length !== 1 ? 's' : ''} • {total.saleCount} sales • {total.purchaseCount} purchases
            </p>
          </div>
          <div className="text-right text-xs text-white/70 space-y-0.5">
            {viewMode === 'pl' && (
              <>
                <p>Revenue: {formatINR(total.revenue)}</p>
                {/* 🔒 V26 N4: hide Profit/Net Profit when undefined (staff + hideProfit) */}
                {total.profit !== undefined && <p>Profit: {formatINR(total.profit)}</p>}
                <p>Expenses: {formatINR(total.expenses)}</p>
                <p>Income: {formatINR(total.income)}</p>
                {total.netProfit !== undefined && <p>Net Profit: {formatINR(total.netProfit)}</p>}
              </>
            )}
            {viewMode === 'gst' && (
              <>
                <p>Output Tax: {formatINR(total.outputTax)}</p>
                <p>Input Tax: -{formatINR(total.inputTax)}</p>
              </>
            )}
            {viewMode === 'stock' && (
              <>
                <p>Products: {total.productCount}</p>
              </>
            )}
          </div>
        </div>
      </div>

      {/* Per-shop breakdown table */}
      <Card className="shadow-card border-border/60">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2">
            <Store className="w-4 h-4 text-primary" />
            Per-Shop Breakdown
          </CardTitle>
        </CardHeader>
        <CardContent>
          <table className="w-full text-xs">
            <thead>
              <tr className="text-muted-foreground border-b">
                <th className="text-left py-1.5 font-medium">Shop</th>
                {viewMode === 'pl' && (
                  <>
                    <th className="text-right py-1.5 font-medium">Revenue</th>
                    {/* 🔒 V26 N4: Profit + Net Profit columns hidden when undefined (staff + hideProfit) */}
                    {shops.some((s: any) => s.profit !== undefined) && (
                      <th className="text-right py-1.5 font-medium">Profit</th>
                    )}
                    <th className="text-right py-1.5 font-medium">Expenses</th>
                    {shops.some((s: any) => s.netProfit !== undefined) && (
                      <th className="text-right py-1.5 font-medium">Net Profit</th>
                    )}
                  </>
                )}
                {viewMode === 'gst' && (
                  <>
                    <th className="text-right py-1.5 font-medium">Output Tax</th>
                    <th className="text-right py-1.5 font-medium">Input Tax</th>
                    <th className="text-right py-1.5 font-medium">Net GST</th>
                  </>
                )}
                {viewMode === 'stock' && (
                  <>
                    <th className="text-right py-1.5 font-medium">Products</th>
                    <th className="text-right py-1.5 font-medium">Stock Value</th>
                  </>
                )}
                <th className="text-right py-1.5 font-medium">Sales</th>
              </tr>
            </thead>
            <tbody>
              {shops.map((shop: any) => {
                const isExpanded = expandedShops.has(shop.shopId)
                return (
                  <>
                    <tr
                      key={shop.shopId}
                      className="border-b border-border/30 hover:bg-muted/30 cursor-pointer"
                      onClick={() => toggleShop(shop.shopId)}
                    >
                      <td className="py-2 font-medium">
                        <div className="flex items-center gap-1.5">
                          {isExpanded ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                          {shop.shopName}
                        </div>
                      </td>
                      {viewMode === 'pl' && (
                        <>
                          <td className="text-right py-2 tabular-nums">{formatINR(shop.revenue)}</td>
                          {/* 🔒 V26 N4: render profit/netProfit cells only when defined */}
                          {shop.profit !== undefined && (
                            <td className="text-right py-2 tabular-nums text-emerald-600 dark:text-emerald-400">{formatINR(shop.profit)}</td>
                          )}
                          <td className="text-right py-2 tabular-nums text-rose-600">{formatINR(shop.expenses)}</td>
                          <td className={cn('text-right py-2 tabular-nums font-semibold', shop.netProfit === undefined ? '' : shop.netProfit >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600')}>
                            {shop.netProfit !== undefined ? formatINR(shop.netProfit) : '—'}
                          </td>
                        </>
                      )}
                      {viewMode === 'gst' && (
                        <>
                          <td className="text-right py-2 tabular-nums">{formatINR(shop.outputTax)}</td>
                          <td className="text-right py-2 tabular-nums">-{formatINR(shop.inputTax)}</td>
                          <td className="text-right py-2 tabular-nums font-semibold">{formatINR(shop.netGST)}</td>
                        </>
                      )}
                      {viewMode === 'stock' && (
                        <>
                          <td className="text-right py-2 tabular-nums">{shop.productCount}</td>
                          <td className="text-right py-2 tabular-nums font-semibold">{formatINR(shop.stockValue)}</td>
                        </>
                      )}
                      <td className="text-right py-2 tabular-nums">{shop.saleCount}</td>
                    </tr>
                    {isExpanded && (
                      <tr className="bg-muted/20">
                        <td colSpan={viewMode === 'pl' ? 5 : viewMode === 'gst' ? 4 : 3} className="py-2 px-6">
                          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-[11px]">
                            <div>
                              <p className="text-muted-foreground">Purchases</p>
                              <p className="font-medium tabular-nums">{shop.purchaseCount}</p>
                            </div>
                            <div>
                              <p className="text-muted-foreground">Other Income</p>
                              <p className="font-medium tabular-nums">{formatINR(shop.income)}</p>
                            </div>
                            <div>
                              <p className="text-muted-foreground">Stock Value</p>
                              <p className="font-medium tabular-nums">{formatINR(shop.stockValue)}</p>
                            </div>
                            <div>
                              <p className="text-muted-foreground">Products</p>
                              <p className="font-medium tabular-nums">{shop.productCount}</p>
                            </div>
                          </div>
                        </td>
                      </tr>
                    )}
                  </>
                )
              })}
              {/* Total row */}
              <tr className="border-t-2 font-bold">
                <td className="py-2">All Shops (Total)</td>
                {viewMode === 'pl' && (
                  <>
                    <td className="text-right py-2 tabular-nums">{formatINR(total.revenue)}</td>
                    {total.profit !== undefined && (
                      <td className="text-right py-2 tabular-nums text-emerald-600 dark:text-emerald-400">{formatINR(total.profit)}</td>
                    )}
                    <td className="text-right py-2 tabular-nums text-rose-600">{formatINR(total.expenses)}</td>
                    {total.netProfit !== undefined && (
                      <td className={cn('text-right py-2 tabular-nums', total.netProfit >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600')}>
                        {formatINR(total.netProfit)}
                      </td>
                    )}
                  </>
                )}
                {viewMode === 'gst' && (
                  <>
                    <td className="text-right py-2 tabular-nums">{formatINR(total.outputTax)}</td>
                    <td className="text-right py-2 tabular-nums">-{formatINR(total.inputTax)}</td>
                    <td className="text-right py-2 tabular-nums">{formatINR(total.netGST)}</td>
                  </>
                )}
                {viewMode === 'stock' && (
                  <>
                    <td className="text-right py-2 tabular-nums">{total.productCount}</td>
                    <td className="text-right py-2 tabular-nums">{formatINR(total.stockValue)}</td>
                  </>
                )}
                <td className="text-right py-2 tabular-nums">{total.saleCount}</td>
              </tr>
            </tbody>
          </table>
        </CardContent>
      </Card>
    </div>
  )
}
