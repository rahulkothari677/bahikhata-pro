'use client'

import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useState, useEffect, useRef } from 'react'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { useAppStore } from '@/store/app-store'
import { formatINR, formatDateTime, formatINRCompact, cn } from '@/lib/utils'
import { useTranslation } from '@/hooks/use-translation'
import { ViewModeToggle } from '@/components/common/ViewModeToggle'
import { DateRangePicker, getPresetRange, getPresetLabel, type DateRange, type DatePreset } from '@/components/common/DateRangePicker'
import { EmptyState } from '@/components/common/EmptyState'
import { SwipeToDelete } from '@/components/common/SwipeToDelete'
import {
  Search, ShoppingCart, Truck, Receipt, IndianRupee,
  TrendingUp, Calendar, User, ScanLine, ChevronRight, Plus, X,
} from 'lucide-react'
import { offlineFetch, isQueuedResponse } from '@/lib/offline-fetch'
import { useSetting } from '@/hooks/use-setting'
import { toast as sonnerToast } from 'sonner'

type LedgerType = 'sale' | 'purchase'

export function Ledger({ type }: { type: LedgerType }) {
  const {
    refreshKey, triggerRefresh, setView, setScannerBillType,
    transactionsViewMode, setTransactionsViewMode, triggerNewEntry, triggerNewEntryView,
    setSelectedTransactionId, setSelectedTransactionType, setPreviousView, pendingDateRange, setPendingDateRange,
  } = useAppStore()
  const queryClient = useQueryClient()
  const [search, setSearch] = useState('')
  const { t } = useTranslation()
  const { hideProfit } = useSetting()

  // Delete a transaction (used by SwipeToDelete)
  const handleDeleteTransaction = async (id: string) => {
    try {
      const r = await offlineFetch(`/api/transactions?id=${id}`, {
        method: 'DELETE',
        offline: { invalidate: ['/api/transactions', '/api/dashboard'] },
      })
      if (r.ok) {
        sonnerToast.success(isQueuedResponse(r) ? 'Will delete when online' : 'Transaction deleted')
        queryClient.invalidateQueries({ queryKey: ['transactions'] })
        queryClient.invalidateQueries({ queryKey: ['dashboard'] })
        triggerRefresh()
      }
    } catch {
      sonnerToast.error('Failed to delete')
    }
  }

  // Date range state - defaults to no filter (all transactions)
  const [dateRange, setDateRange] = useState<DateRange | null>(null)
  const [datePreset, setDatePreset] = useState<DatePreset>('thisMonth')

  // Pick up pending date range from store (when navigating from dashboard KPI click)
  useEffect(() => {
    if (pendingDateRange) {
      Promise.resolve().then(() => {
        setDateRange({
          from: new Date(pendingDateRange.from),
          to: new Date(pendingDateRange.to),
        })
        // Try to match preset label
        const matchedPreset = (['today', 'yesterday', 'last7', 'last30', 'thisMonth', 'lastMonth', 'thisQuarter', 'thisYear'] as DatePreset[]).find(
          p => getPresetLabel(p) === pendingDateRange.preset
        )
        setDatePreset(matchedPreset || 'custom')
        setPendingDateRange(null) // Clear after consuming
      })
    }
  }, [pendingDateRange, setPendingDateRange])

  const isSale = type === 'sale'
  const accentColor = isSale ? 'text-emerald-600' : 'text-amber-600'
  const accentBg = isSale ? 'bg-emerald-100' : 'bg-amber-100'

  // Build query with optional date filter
  const queryParams = new URLSearchParams({
    type,
    limit: '200',
  })
  if (dateRange) {
    queryParams.set('from', dateRange.from.toISOString())
    queryParams.set('to', dateRange.to.toISOString())
  }

  const { data, isLoading } = useQuery({
    queryKey: ['transactions', type, refreshKey, dateRange?.from.toISOString() || 'all', dateRange?.to.toISOString() || 'all'],
    queryFn: async () => {
      const r = await offlineFetch(`/api/transactions?${queryParams.toString()}`)
      return r.json()
    },
  })

  const transactions: any[] = data?.transactions || []

  const filtered = transactions.filter(t => {
    if (!search) return true
    const q = search.toLowerCase()
    return t.invoiceNo?.toLowerCase().includes(q) ||
      t.party?.name?.toLowerCase().includes(q) ||
      t.notes?.toLowerCase().includes(q)
  })

  const totalAmount = filtered.reduce((s, t) => s + t.totalAmount, 0)
  const totalProfit = filtered.reduce((s, t) => s + (t.grossProfit || 0), 0)
  const totalPaid = filtered.reduce((s, t) => s + t.paidAmount, 0)
  const totalDue = totalAmount - totalPaid

  // Listen for global "New Entry" trigger from Header (only if fired on this view)
  const lastTriggerRef = useRef(0)
  const targetView = isSale ? 'sales' : 'purchases'
  useEffect(() => {
    if (triggerNewEntry > lastTriggerRef.current && triggerNewEntryView === targetView) {
      lastTriggerRef.current = triggerNewEntry
      setPreviousView(targetView)
      setView(isSale ? 'new-sale' : 'new-purchase')
    } else if (triggerNewEntry > lastTriggerRef.current) {
      lastTriggerRef.current = triggerNewEntry
    }
  }, [triggerNewEntry, triggerNewEntryView, targetView, isSale, setView, setPreviousView])

  // Listen for preset data (from scanner or party profile)
  useEffect(() => {
    const checkPreset = () => {
      const stored = (window as any).__ledgerPreset
      if (stored && stored.type === type) {
        setPreviousView(targetView)
        setView(isSale ? 'new-sale' : 'new-purchase')
        ;(window as any).__ledgerPreset = stored
      }
    }
    checkPreset()
    const interval = setInterval(checkPreset, 300)
    return () => clearInterval(interval)
  }, [type, isSale, targetView, setView, setPreviousView])

  const handleViewTransaction = (txnId: string) => {
    setSelectedTransactionId(txnId)
    setSelectedTransactionType(type)
    setPreviousView(isSale ? 'sales' : 'purchases')
    setView('transaction-detail')
  }

  const handleNewEntry = () => {
    setPreviousView(isSale ? 'sales' : 'purchases')
    setView(isSale ? 'new-sale' : 'new-purchase')
  }

  return (
    <div className="space-y-4">
      {/* Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Card className="shadow-card border-border/60">
          <CardContent className="p-4">
            <div className="flex items-center gap-2 mb-1">
              <Receipt className={cn('w-4 h-4', accentColor)} />
              <p className="text-[11px] text-muted-foreground uppercase tracking-wide font-medium">{isSale ? 'Total Sales' : 'Total Purchases'}</p>
            </div>
            <p className="text-xl font-bold">{formatINR(totalAmount)}</p>
            <p className="text-[11px] text-muted-foreground">{filtered.length} transactions</p>
          </CardContent>
        </Card>
        {isSale && !hideProfit && (
          <Card className="shadow-card border-border/60">
            <CardContent className="p-4">
              <div className="flex items-center gap-2 mb-1">
                <TrendingUp className="w-4 h-4 text-emerald-600" />
                <p className="text-[11px] text-muted-foreground uppercase tracking-wide font-medium">{t('stat.gross_profit')}</p>
              </div>
              <p className="text-xl font-bold text-emerald-600">{formatINR(totalProfit)}</p>
              <p className="text-[11px] text-muted-foreground">{totalAmount > 0 ? ((totalProfit / totalAmount) * 100).toFixed(1) : 0}% margin</p>
            </CardContent>
          </Card>
        )}
        <Card className="shadow-card border-border/60">
          <CardContent className="p-4">
            <div className="flex items-center gap-2 mb-1">
              <IndianRupee className="w-4 h-4 text-violet-600" />
              <p className="text-[11px] text-muted-foreground uppercase tracking-wide font-medium">{t('stat.paid')}</p>
            </div>
            <p className="text-xl font-bold">{formatINR(totalPaid)}</p>
          </CardContent>
        </Card>
        <Card className="shadow-card border-border/60">
          <CardContent className="p-4">
            <div className="flex items-center gap-2 mb-1">
              <IndianRupee className="w-4 h-4 text-rose-600" />
              <p className="text-[11px] text-muted-foreground uppercase tracking-wide font-medium">{isSale ? 'Outstanding' : 'Pending Payment'}</p>
            </div>
            <p className="text-xl font-bold text-rose-600">{formatINR(totalDue)}</p>
          </CardContent>
        </Card>
      </div>

      {/* Toolbar */}
      <Card className="shadow-card border-border/60">
        <CardContent className="p-3 lg:p-4">
          <div className="flex flex-col sm:flex-row gap-3 items-start sm:items-center">
            <div className="relative flex-1 w-full">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                placeholder={`Search ${isSale ? 'sales' : 'purchases'} by invoice, party, notes...`}
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-9"
              />
            </div>
            <ViewModeToggle mode={transactionsViewMode} onChange={setTransactionsViewMode} />

            {/* Date range picker - shows "All Time" when no filter, or the preset label */}
            {dateRange ? (
              <div className="flex items-center gap-1">
                <DateRangePicker
                  value={dateRange}
                  onChange={(range, preset) => { setDateRange(range); setDatePreset(preset) }}
                  preset={datePreset}
                  onPresetChange={(p) => {
                    setDatePreset(p)
                    if (p !== 'custom') setDateRange(getPresetRange(p))
                  }}
                />
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-9 w-9 p-0"
                  onClick={() => { setDateRange(null); setDatePreset('thisMonth') }}
                  title="Clear date filter"
                >
                  <X className="w-4 h-4" />
                </Button>
              </div>
            ) : (
              <DateRangePicker
                value={getPresetRange('thisMonth')}
                onChange={(range, preset) => { setDateRange(range); setDatePreset(preset) }}
                preset={'thisMonth'}
                onPresetChange={(p) => {
                  setDatePreset(p)
                  if (p !== 'custom') setDateRange(getPresetRange(p))
                }}
              />
            )}

            <Button
              variant="outline"
              onClick={() => { setScannerBillType(type); setView('scanner') }}
              className="gap-2 border-primary/30 text-primary hover:bg-primary/10"
            >
              <ScanLine className="w-4 h-4" /> <span className="hidden sm:inline">Scan Bill</span>
            </Button>
          </div>

          {/* Active filter indicator */}
          {dateRange && (
            <div className="mt-2 flex items-center gap-2 text-xs">
              <Badge variant="secondary" className="gap-1">
                <Calendar className="w-3 h-3" />
                Filtered: {getPresetLabel(datePreset)}
              </Badge>
              <span className="text-muted-foreground">
                {dateRange.from.toLocaleDateString('en-IN')} — {dateRange.to.toLocaleDateString('en-IN')}
              </span>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Transactions list */}
      {isLoading ? (
        <div className="space-y-2">
          {[...Array(5)].map((_, i) => <Skeleton key={i} className="h-20 w-full rounded-xl" />)}
        </div>
      ) : filtered.length === 0 ? (
        <Card className="shadow-card border-border/60">
          <CardContent className="p-0">
            <EmptyState
              icon={isSale ? ShoppingCart : Truck}
              title={`No ${isSale ? 'sales' : 'purchases'} yet`}
              description={
                isSale
                  ? 'Record your first sale to start tracking revenue, or scan a bill to auto-fill the details in seconds.'
                  : 'Record your first stock purchase to track inventory and supplier balances.'
              }
              action={{
                label: `New ${isSale ? 'Sale' : 'Purchase'}`,
                onClick: handleNewEntry,
              }}
              secondaryAction={
                isSale
                  ? { label: 'Scan Bill', onClick: () => setView('scanner') }
                  : undefined
              }
            />
          </CardContent>
        </Card>
      ) : transactionsViewMode === 'list' ? (
        <div className="space-y-2">
          {filtered.map((t) => {
            const due = t.totalAmount - t.paidAmount
            return (
              <SwipeToDelete
                key={t.id}
                onDelete={() => handleDeleteTransaction(t.id)}
                confirmMessage={`Delete this ${isSale ? 'sale' : 'purchase'}? This cannot be undone.`}
              >
              <Card
                className="shadow-card border-border/60 hover:shadow-md hover:border-primary/30 transition group cursor-pointer"
                onClick={() => handleViewTransaction(t.id)}
              >
                <CardContent className="p-3 lg:p-4">
                  <div className="flex items-start gap-3">
                    <div className={cn('w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0', accentBg)}>
                      {isSale
                        ? <ShoppingCart className={cn('w-5 h-5', accentColor)} />
                        : <Truck className={cn('w-5 h-5', accentColor)} />}
                    </div>

                    <div className="flex-1 min-w-0">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <p className="font-semibold text-sm">
                              {t.party?.name || 'Walk-in Customer'}
                            </p>
                            {t.invoiceNo && (
                              <Badge variant="outline" className="text-[10px] py-0">{t.invoiceNo}</Badge>
                            )}
                          </div>
                          <div className="flex items-center gap-3 mt-1 text-[11px] text-muted-foreground flex-wrap">
                            <span className="flex items-center gap-1"><Calendar className="w-3 h-3" />{formatDateTime(t.date)}</span>
                            <span className="flex items-center gap-1"><User className="w-3 h-3" />{t.items?.length || 0} items</span>
                            <Badge variant="secondary" className="text-[10px] py-0 uppercase">{t.paymentMode}</Badge>
                          </div>
                        </div>
                        <div className="text-right flex-shrink-0">
                          <p className={cn('font-bold text-sm', accentColor)}>{formatINR(t.totalAmount)}</p>
                          {due > 0 && (
                            <p className="text-[11px] text-rose-600 mt-0.5">Due: {formatINR(due)}</p>
                          )}
                          {isSale && !hideProfit && (
                            <p className="text-[11px] text-emerald-600 mt-0.5">Profit: {formatINR(t.grossProfit)}</p>
                          )}
                        </div>
                        <ChevronRight className="w-4 h-4 text-muted-foreground group-hover:text-primary mt-1 flex-shrink-0" />
                      </div>

                      {t.items?.length > 0 && (
                        <div className="mt-2 flex flex-wrap gap-1">
                          {t.items.slice(0, 4).map((item: any, i: number) => (
                            <span key={i} className="text-[11px] bg-muted px-2 py-0.5 rounded-md">
                              {item.productName} × {item.quantity}
                            </span>
                          ))}
                          {t.items.length > 4 && (
                            <span className="text-[11px] text-muted-foreground px-2 py-0.5">+{t.items.length - 4} more</span>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                </CardContent>
              </Card>
              </SwipeToDelete>
            )
          })}
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
          {filtered.map((t) => {
            const due = t.totalAmount - t.paidAmount
            return (
              <Card
                key={t.id}
                className="shadow-card border-border/60 hover:shadow-md hover:border-primary/30 transition cursor-pointer"
                onClick={() => handleViewTransaction(t.id)}
              >
                <CardContent className="p-3">
                  <div className="flex items-center justify-between mb-2">
                    <div className={cn('w-8 h-8 rounded-lg flex items-center justify-center', accentBg)}>
                      {isSale
                        ? <ShoppingCart className={cn('w-4 h-4', accentColor)} />
                        : <Truck className={cn('w-4 h-4', accentColor)} />}
                    </div>
                    <ChevronRight className="w-3.5 h-3.5 text-muted-foreground" />
                  </div>
                  <p className="font-semibold text-sm truncate">{t.party?.name || 'Walk-in'}</p>
                  {t.invoiceNo && <p className="text-[10px] text-muted-foreground">{t.invoiceNo}</p>}
                  <p className="text-[10px] text-muted-foreground mt-1">{formatDateTime(t.date)}</p>
                  <div className="mt-2 pt-2 border-t border-border flex items-center justify-between">
                    <span className={cn('font-bold', accentColor)}>{formatINRCompact(t.totalAmount)}</span>
                    {due > 0 ? (
                      <Badge variant="destructive" className="text-[9px]">Due {formatINRCompact(due)}</Badge>
                    ) : (
                      <Badge variant="secondary" className="text-[9px] bg-emerald-100 text-emerald-700">{t('stat.paid')}</Badge>
                    )}
                  </div>
                  {isSale && !hideProfit && (
                    <p className="text-[10px] text-emerald-600 mt-1">+{formatINRCompact(t.grossProfit)} profit</p>
                  )}
                </CardContent>
              </Card>
            )
          })}
        </div>
      )}
    </div>
  )
}
