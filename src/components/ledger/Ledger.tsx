'use client'

import { useQuery, useQueryClient, useInfiniteQuery, keepPreviousData } from '@tanstack/react-query'
import { useState, useEffect, useRef } from 'react'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { useAppStore } from '@/store/app-store'
import { formatINR, formatDate, formatDateTime, formatINRCompact, cn } from '@/lib/utils'
import { roundMoney } from '@/lib/money'
import { useTranslation } from '@/hooks/use-translation'
import { useSubscription } from '@/hooks/use-subscription'
import { ViewModeToggle } from '@/components/common/ViewModeToggle'
import { DateRangePicker, getPresetRange, getPresetLabel, type DateRange, type DatePreset } from '@/components/common/DateRangePicker'
import { EmptyState } from '@/components/common/EmptyState'
import { WakingUpState } from '@/components/common/WakingUpState'
import { SwipeToDelete } from '@/components/common/SwipeToDelete'
import { ContextMenu, type ContextMenuItem } from '@/components/common/ContextMenu'
import {
  Search, ShoppingCart, Truck, Receipt, IndianRupee,
  TrendingUp, Calendar, User, ScanLine, ChevronRight, Plus, X,
  Edit2, Trash2, Eye, Printer, AlertCircle, RefreshCw, Undo2,
} from 'lucide-react'
import { offlineFetch, isQueuedResponse, isOnline, OfflineError } from '@/lib/offline-fetch'
import { invalidateMoneyCaches } from '@/lib/invalidate-money-caches'
import { OfflineNoData } from '@/components/common/OfflineNoData'
import { useSetting } from '@/hooks/use-setting'
import { useConfirmDialog } from '@/hooks/use-confirm-dialog'
import { toast as sonnerToast } from 'sonner'

type LedgerType = 'sale' | 'purchase'

export function Ledger({ type }: { type: LedgerType }) {
  const { confirmDialog, dialog: confirmDialogEl } = useConfirmDialog()
  const {
    refreshKey, triggerRefresh, setView, setScannerBillType,
    transactionsViewMode, setTransactionsViewMode, triggerNewEntry, triggerNewEntryView,
    setSelectedTransactionId, setSelectedTransactionType, setPreviousView, pendingDateRange, setPendingDateRange,
    returnMode,  // 🔒 V26 N11: reactive subscription so dismiss re-renders
  } = useAppStore()
  const queryClient = useQueryClient()
  const [search, setSearch] = useState('')
  const [sortBy, setSortBy] = useState<'date' | 'amount' | 'party' | 'status'>('date')
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc')
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [bulkMode, setBulkMode] = useState(false)
  const { t } = useTranslation()
  const { hideProfit } = useSetting()

  // Delete a transaction (used by SwipeToDelete)
  // 🔒 AUDIT FIX V6 UX + N4: Use the correct /transactions/[id] path (the old
  // /transactions?id= returns 410 Gone). Also add a 5-second Undo toast —
  // since deletes are soft (deletedAt set), restoring is one POST to
  // /transactions/[id]/restore.
  const handleDeleteTransaction = async (id: string) => {
    try {
      const r = await offlineFetch(`/api/transactions/${id}`, {
        method: 'DELETE',
        offline: { invalidate: ['/api/transactions', '/api/dashboard', '/api/products', '/api/parties'] },
      })
      if (r.ok) {
        const wasQueued = isQueuedResponse(r)
        if (wasQueued) {
          sonnerToast.success('Will delete when online')
        } else {
          // 🔒 V6 UX: 5-second Undo
          sonnerToast.success('Transaction deleted', {
            duration: 5000,
            action: {
              label: 'Undo',
              onClick: async () => {
                try {
                  const restoreR = await offlineFetch(`/api/transactions/${id}/restore`, {
                    method: 'POST',
                    offline: { invalidate: ['/api/transactions', '/api/dashboard', '/api/products', '/api/parties'] },
                  })
                  if (restoreR.ok) {
                    sonnerToast.success('Transaction restored')
                  } else {
                    sonnerToast.error('Could not restore — transaction may have been permanently removed.')
                  }
                } catch {
                  sonnerToast.error('Could not restore — check your connection.')
                }
              },
            },
          })
        }
        queryClient.invalidateQueries({ queryKey: ['transactions'] })
        queryClient.invalidateQueries({ queryKey: ['dashboard'] })
        // 🔒 R9-6/R9-7/R9-10: Delete affects party balance + product stock too.
        invalidateMoneyCaches(queryClient)
        triggerRefresh()
      }
    } catch (e: any) {
      // 🔒 R13-10 (Round 13): Surface the server's error message (period-lock
      // refusal, permission denied, already-deleted 404, etc.). Was: generic
      // "Couldn't delete" with no context.
      sonnerToast.error(e?.message || "Couldn't delete")
    }
  }

  // Date range state - defaults to no filter (all transactions)
  const [dateRange, setDateRange] = useState<DateRange | null>(null)
  const [datePreset, setDatePreset] = useState<DatePreset>('thisMonth')
  // 🔒 V8 U1: Voided trail filter — toggle to show soft-deleted transactions
  const [showVoided, setShowVoided] = useState(false)

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
  const accentColor = isSale ? 'text-emerald-600 dark:text-emerald-400' : 'text-amber-600 dark:text-amber-400'
  const accentBg = isSale ? 'bg-emerald-100' : 'bg-amber-100'

  // Build query with optional date filter + voided filter
  const buildQueryParams = (cursor?: string) => {
    // V17-Ext Tier 3: Sales ledger includes credit notes; Purchase ledger
    // includes debit notes. They're related transactions the shopkeeper
    // needs to see in the same list.
    // 🔒 V26 FIX N2: Sales ledger also includes estimates so they're visible
    // and the "Convert to Sale" button is reachable. Without this, estimates
    // were a black hole — createable but never viewable.
    const types = isSale ? ['sale', 'credit-note', 'estimate'] : ['purchase', 'debit-note']
    const qp = new URLSearchParams({ type: types.join(','), limit: '50' })
    if (showVoided) qp.set('voided', 'true')
    if (dateRange) {
      qp.set('from', dateRange.from.toISOString())
      qp.set('to', dateRange.to.toISOString())
    }
    if (cursor) qp.set('cursor', cursor)
    return qp.toString()
  }

  // 🔒 FIX M4: Infinite query with cursor pagination. Was: loaded 200 at once.
  // Now: loads 50 per page with "Load more" button. Each page uses the
  // nextCursor from the previous page's response.
  const {
    data: infiniteData,
    isLoading,
    error,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
  } = useInfiniteQuery({
    queryKey: ['transactions', type, refreshKey, dateRange?.from.toISOString() || 'all', dateRange?.to.toISOString() || 'all', showVoided ? 'voided' : 'active'],
    queryFn: async ({ pageParam }) => {
      const r = await offlineFetch(`/api/transactions?${buildQueryParams(pageParam)}`)
      if (!r.ok) throw new Error(`HTTP ${r.status}`)
      return r.json()
    },
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => lastPage.nextCursor || undefined,
    retry: (count, err) => {
      if (err instanceof OfflineError) return false
      if (err instanceof TypeError) return false
      return count < 2
    },
    placeholderData: keepPreviousData,
  })

  // Flatten all pages into a single transactions array
  const transactions: any[] = infiniteData?.pages?.flatMap((page: any) => page.transactions || []) || []
  const data = infiniteData?.pages?.[0] || null

  const filtered = transactions.filter(t => {
    if (!search) return true
    const q = search.toLowerCase()
    return t.invoiceNo?.toLowerCase().includes(q) ||
      t.party?.name?.toLowerCase().includes(q) ||
      t.notes?.toLowerCase().includes(q)
  })

  // Sort filtered transactions
  const sorted = [...filtered].sort((a, b) => {
    let cmp = 0
    if (sortBy === 'date') {
      cmp = new Date(a.date).getTime() - new Date(b.date).getTime()
    } else if (sortBy === 'amount') {
      cmp = a.totalAmount - b.totalAmount
    } else if (sortBy === 'party') {
      cmp = (a.party?.name || '').localeCompare(b.party?.name || '')
    } else if (sortBy === 'status') {
      // Sort by due amount (largest due first)
      const aDue = roundMoney(a.totalAmount - a.paidAmount)
      const bDue = roundMoney(b.totalAmount - b.paidAmount)
      cmp = bDue - aDue
    }
    return sortOrder === 'asc' ? cmp : -cmp
  })

  const toggleSort = (field: 'date' | 'amount' | 'party' | 'status') => {
    if (sortBy === field) {
      setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc')
    } else {
      setSortBy(field)
      setSortOrder('desc')
    }
  }

  // Bulk operations
  const toggleSelect = (id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const selectAll = () => {
    setSelectedIds(new Set(sorted.map(t => t.id)))
  }

  const clearSelection = () => {
    setSelectedIds(new Set())
    setBulkMode(false)
  }

  const handleBulkDelete = async () => {
    if (selectedIds.size === 0) return
    // 🔒 R13-7 (Round 13): These are soft-deletes (voided) — individually
    // restorable via /api/transactions/[id]/restore + the voided trail.
    // Was: "This cannot be undone" — misleading. Now: accurate wording.
    if (!await confirmDialog(`Void ${selectedIds.size} transactions? They'll be moved to the voided trail and can be restored individually.`, { title: 'Void Transactions', confirmLabel: 'Void' })) return
    let success = 0
    for (const id of selectedIds) {
      // 🔒 FIX C4: Was `/api/transactions?id=${id}` which returns 410 Gone
      // (the deprecated hard-delete endpoint was removed in audit fix N4).
      // The correct soft-delete endpoint is `/api/transactions/${id}` —
      // same path the single-delete uses (line 54).
      const r = await offlineFetch(`/api/transactions/${id}`, {
        method: 'DELETE',
        offline: { invalidate: ['/api/transactions', '/api/dashboard'] },
      })
      if (r.ok) success++
    }
    sonnerToast.success(`${success} transactions voided`)
    clearSelection()
    // 🔒 R13-1 (Round 13): Bulk delete must invalidate every money cache —
    // party balances + product stock change when transactions are voided.
    // Was: only triggerRefresh() (refreshKey-keyed queries). Now: also
    // invalidateMoneyCaches(queryClient) so ['parties'], ['party-profile'],
    // ['products'], ['dashboard'], ['insights'] all refresh. Matches the
    // single-delete path at L94.
    invalidateMoneyCaches(queryClient)
    triggerRefresh()
  }

  const handleBulkExport = () => {
    if (selectedIds.size === 0) return
    const selectedTxns = sorted.filter(t => selectedIds.has(t.id))
    const headers = ['Date', 'Invoice', 'Party', 'Type', 'Amount', 'Paid', 'Due', 'Payment Mode']
    const rows = selectedTxns.map(t => [
      formatDate(t.date),
      t.invoiceNo || '',
      t.party?.name || 'Walk-in',
      t.type,
      t.totalAmount,
      t.paidAmount,
      roundMoney(t.totalAmount - t.paidAmount),
      t.paymentMode,
    ])
    // 🔒 R13-8 (Round 13): Escape internal double-quotes per RFC 4180.
    // Was: `"${c}"` — a party named John "Big" Doe produces `"John "Big" Doe"`
    // which breaks CSV parsing. Now: `"` → `""` inside the quoted field.
    const csvEscape = (c: any) => `"${String(c ?? '').replace(/"/g, '""')}"`
    const csv = [headers.join(','), ...rows.map(r => r.map(csvEscape).join(','))].join('\n')
    const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `transactions_export_${formatDate(new Date()).replace(/\//g, '-')}.csv`
    a.click()
    URL.revokeObjectURL(url)
    sonnerToast.success(`${selectedTxns.length} transactions exported`)
    clearSelection()
  }

  // 🔒 V17 Audit Phase 0 FIX: Net of returns — credit notes/debit notes store
  // POSITIVE totalAmount (the absolute invoice total), so we SUBTRACT them to
  // get the net total. Was: `s + t.totalAmount` for all types → credit notes
  // INFLATED the total (5 sales ₹5000 + 1 credit note ₹1000 = ₹6000 shown,
  // but real net is ₹4000).
  // Sales ledger: sales ADD, credit notes SUBTRACT.
  // Purchase ledger: purchases ADD, debit notes SUBTRACT.
  // 🔒 V26 FIX N2 follow-up: estimates are QUOTATIONS, not revenue — they must
  // be visible in the list but excluded from every money summary. Without this
  // exclusion, adding estimates to the ledger (FIX N2) silently inflated the
  // "Total" and "Received" cards by the quoted amounts.
  const totalAmount = filtered.reduce((s, t) => {
    if (t.type === 'estimate') return s
    if (isSale) {
      return t.type === 'credit-note' ? s - t.totalAmount : s + t.totalAmount
    } else {
      return t.type === 'debit-note' ? s - t.totalAmount : s + t.totalAmount
    }
  }, 0)
  // 🔒 V17 Audit Phase 4 SIGN-CONVENTION FIX:
  // Credit notes store NEGATIVE grossProfit (line-items.ts: grossProfit - itemProfit = 0 - 900 = -900).
  // So we ADD grossProfit for both sales (+3000) and credit notes (-900) → net = 2100.
  // BEFORE this fix: the code did `s - t.grossProfit` for credit notes → `3000 - (-900) = 3900`
  // which INFLATED profit by the return amount (regression of §1 in the opposite direction).
  // Sales: +grossProfit (positive). Credit notes: +grossProfit (negative). Others: 0.
  const totalProfit = filtered.reduce((s, t) => {
    if (t.type === 'credit-note') return s + (t.grossProfit || 0)  // ADD (grossProfit is negative)
    if (t.type === 'sale') return s + (t.grossProfit || 0)
    return s
  }, 0)
  // 🔒 V17 Audit Phase 0 FIX: Same net-of-returns pattern for paidAmount.
  // Credit notes have paidAmount (the refund issued) — SUBTRACT for sales.
  // Debit notes have paidAmount (the refund received) — SUBTRACT for purchases.
  const totalPaid = filtered.reduce((s, t) => {
    if (t.type === 'estimate') return s  // 🔒 V26 N2 follow-up: quotes collect nothing
    if (isSale) {
      return t.type === 'credit-note' ? s - (t.paidAmount || 0) : s + (t.paidAmount || 0)
    } else {
      return t.type === 'debit-note' ? s - (t.paidAmount || 0) : s + (t.paidAmount || 0)
    }
  }, 0)
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

  // 🔒 V26 Phase 8 NAV-1/NAV-4: Ledger preset relay DELETED.
  // Was: polled window.__ledgerPreset every 300ms → nulled it before
  // TransactionEntry could read it (100ms delay) → form opened empty.
  // Also overwrote previousView with 'sales'/'purchases' (NAV-2).
  // Now: callers (PartyProfile, BillScanner, Dashboard) navigate directly
  // to new-sale/new-purchase — no relay needed, preset survives.

  // 🔒 AUDIT V24 follow-up: split-view access check for the free-desktop
  // row-click fallback (see handleViewTransaction).
  const { canUse } = useSubscription()

  const handleViewTransaction = (txnId: string) => {
    setSelectedTransactionId(txnId)
    setSelectedTransactionType(type)
    setPreviousView(isSale ? 'sales' : 'purchases')
    // 🔒 Feature Phase 6: Clear return mode when user picks a transaction
    useAppStore.getState().setReturnMode(null)
    // On desktop (lg+) WITH split-view access, LedgerSplitView shows the
    // detail inline (it checks selectedTransactionId + canUse('split_view')).
    // Everyone else — mobile, AND free-plan users on desktop — must navigate
    // to the full-page detail view.
    //
    // 🔒 AUDIT V24 follow-up BUG FIX (found in browser verification): the old
    // code had four lines of comments describing exactly this free-desktop
    // fallback ("we need to also navigate to detail for free users on
    // desktop") — and never implemented it. Result: a free-plan user on
    // desktop clicked a sale/purchase row and NOTHING happened. The split
    // pane silently refused (Pro gate) and no navigation occurred, making
    // every transaction unopenable on the desktop free plan.
    const isMobile = window.matchMedia('(max-width: 1023px)').matches
    if (isMobile || !canUse('split_view')) {
      setView('transaction-detail')
    }
  }

  const handleNewEntry = () => {
    setPreviousView(isSale ? 'sales' : 'purchases')
    setView(isSale ? 'new-sale' : 'new-purchase')
  }

  return (
    <div className="space-y-4">
      {/* 🔒 Feature Phase 6: Guided returns — banner shown when the user
          tapped "Sale Return" or "Purchase Return" in MoreScreen. Tells
          them to pick a transaction, then tap "Credit Note" / "Debit Note"
          on the detail page to record the return. */}
      {/* 🔒 V26 N11: Use reactive subscription to returnMode instead of getState().
          Was: useAppStore.getState().returnMode — non-reactive, so setting
          returnMode=null (dismiss X) didn't trigger a re-render → banner stayed. */}
      {returnMode === type && (
        <div className="rounded-2xl bg-indigo-50 dark:bg-indigo-950/20 border border-indigo-200 dark:border-indigo-900/40 p-4 flex items-start gap-3">
          <div className="w-9 h-9 rounded-lg bg-indigo-100 dark:bg-indigo-900/40 flex items-center justify-center flex-shrink-0">
            <Undo2 className="w-4 h-4 text-indigo-600 dark:text-indigo-400" />
          </div>
          <div className="flex-1">
            <p className="text-sm font-semibold text-indigo-900 dark:text-indigo-100">
              {isSale ? 'Record a Sale Return' : 'Record a Purchase Return'}
            </p>
            <p className="text-xs text-indigo-700 dark:text-indigo-300 mt-0.5">
              Tap a {isSale ? 'sale' : 'purchase'} below to open it, then tap
              "{isSale ? 'Credit Note' : 'Debit Note'}" to record the return.
              You can return all or some items.
            </p>
          </div>
          <button
            onClick={() => useAppStore.getState().setReturnMode(null)}
            className="text-indigo-400 hover:text-indigo-600 dark:hover:text-indigo-200 p-1 -mt-1 -mr-1"
            aria-label="Cancel return mode"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Stats — with colored top accent bars like KPI cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <div className="rounded-2xl bg-card border border-border/60 shadow-card overflow-hidden">
          <div className="h-1 bg-gradient-to-r from-amber-500 to-orange-600" />
          <div className="p-4">
            <div className="flex items-center gap-2 mb-1">
              <div className="w-7 h-7 rounded-lg bg-amber-500/10 flex items-center justify-center">
                <Receipt className="w-3.5 h-3.5 text-amber-600 dark:text-amber-400" />
              </div>
              <p className="text-3xs text-muted-foreground uppercase tracking-wide font-medium">{isSale ? 'Total Sales' : 'Total Purchases'}</p>
            </div>
            <p className="text-xl font-bold tabular-nums">{formatINR(totalAmount)}</p>
            {/* 🔒 V19-019 FIX: Label makes clear this is the loaded subset, not all-time total */}
            <p className="text-2xs text-muted-foreground">{filtered.length} transactions{hasNextPage ? ' (loaded)' : ''}</p>
          </div>
        </div>
        {isSale && !hideProfit && (
          <div className="rounded-2xl bg-card border border-border/60 shadow-card overflow-hidden">
            <div className="h-1 bg-gradient-to-r from-emerald-500 to-teal-600" />
            <div className="p-4">
              <div className="flex items-center gap-2 mb-1">
                <div className="w-7 h-7 rounded-lg bg-emerald-500/10 flex items-center justify-center">
                  <TrendingUp className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
                </div>
                <p className="text-3xs text-muted-foreground uppercase tracking-wide font-medium">{t('stat.gross_profit')}</p>
              </div>
              <p className="text-xl font-bold text-emerald-600 dark:text-emerald-400 tabular-nums">{formatINR(totalProfit)}</p>
              <p className="text-2xs text-muted-foreground">{totalAmount > 0 ? ((totalProfit / totalAmount) * 100).toFixed(1) : 0}% margin</p>
            </div>
          </div>
        )}
        <div className="rounded-2xl bg-card border border-border/60 shadow-card overflow-hidden">
          <div className="h-1 bg-gradient-to-r from-violet-500 to-purple-600" />
          <div className="p-4">
            <div className="flex items-center gap-2 mb-1">
              <div className="w-7 h-7 rounded-lg bg-violet-500/10 flex items-center justify-center">
                <IndianRupee className="w-3.5 h-3.5 text-violet-600" />
              </div>
              <p className="text-3xs text-muted-foreground uppercase tracking-wide font-medium">{t('stat.paid')}</p>
            </div>
            <p className="text-xl font-bold tabular-nums">{formatINR(totalPaid)}</p>
          </div>
        </div>
        <div className="rounded-2xl bg-card border border-border/60 shadow-card overflow-hidden">
          <div className="h-1 bg-gradient-to-r from-rose-500 to-red-600" />
          <div className="p-4">
            <div className="flex items-center gap-2 mb-1">
              <div className="w-7 h-7 rounded-lg bg-rose-500/10 flex items-center justify-center">
                <IndianRupee className="w-3.5 h-3.5 text-rose-600" />
              </div>
              <p className="text-3xs text-muted-foreground uppercase tracking-wide font-medium">{isSale ? 'Outstanding' : 'Pending Payment'}</p>
            </div>
            <p className="text-xl font-bold text-rose-600 tabular-nums">{formatINR(totalDue)}</p>
          </div>
        </div>
      </div>

      {/* Toolbar */}
      <Card className="shadow-card border-border/60 border-t-2 border-t-primary/10">
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

            {/* Date range picker.
                🔒 R13-2 (Round 13): When dateRange is null (all-time query), show
                an "All Time" button instead of a This Month picker. Was: the
                picker rendered getPresetRange('thisMonth') → user saw "This Month"
                but the ledger loaded ALL transactions (truth-vs-display mismatch).
                Now: clicking "All Time" opens the picker at This Month (the most
                common filter), making the transition explicit. */}
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
                  title="Clear date filter (show all)"
                >
                  <X className="w-4 h-4" />
                </Button>
              </div>
            ) : (
              <Button
                variant="outline"
                size="sm"
                className="gap-1.5"
                onClick={() => {
                  // Start filtering from This Month (the most common preset).
                  setDateRange(getPresetRange('thisMonth'))
                  setDatePreset('thisMonth')
                }}
                title="Filter by date range"
              >
                <Calendar className="w-4 h-4" />
                All Time
              </Button>
            )}

            {/* 🔒 V8 U1: Voided trail toggle — show/hide soft-deleted transactions */}
            <Button
              variant={showVoided ? 'default' : 'outline'}
              size="sm"
              onClick={() => { setShowVoided(!showVoided); setSearch('') }}
              className="gap-1.5 flex-shrink-0"
              title={showVoided ? 'Showing voided transactions' : 'Show voided transactions'}
            >
              <Trash2 className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">{showVoided ? 'Voided' : 'Show Voided'}</span>
            </Button>
            <Button
              variant="outline"
              onClick={() => { setScannerBillType(type); setView('scanner') }}
              className="gap-2 border-primary/30 text-primary hover:bg-primary/10"
            >
              <ScanLine className="w-4 h-4" /> <span className="hidden sm:inline">Scan Bill</span>
            </Button>
          </div>

          {/* Bulk action bar — shows when in bulk mode or items selected */}
          {bulkMode && (
            <div className="mt-3 flex items-center gap-2 flex-wrap p-3 rounded-lg bg-primary/5 border border-primary/20">
              <span className="text-xs font-medium text-primary">
                {selectedIds.size} selected
              </span>
              <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={selectAll}>Select All</Button>
              <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={clearSelection}>Clear</Button>
              <div className="flex-1" />
              <Button
                size="sm"
                variant="outline"
                className="h-7 text-xs gap-1.5"
                onClick={handleBulkExport}
                disabled={selectedIds.size === 0}
              >
                Export CSV
              </Button>
              <Button
                size="sm"
                variant="destructive"
                className="h-7 text-xs gap-1.5"
                onClick={handleBulkDelete}
                disabled={selectedIds.size === 0}
              >
                Delete
              </Button>
            </div>
          )}

          {/* Bulk mode toggle — small button to enter/exit bulk select */}
          {sorted.length > 0 && !bulkMode && (
            <button
              onClick={() => setBulkMode(true)}
              className="mt-2 text-2xs text-muted-foreground hover:text-primary transition"
            >
              Select multiple →
            </button>
          )}

          {/* Sort buttons row */}
          {sorted.length > 0 && (
            <div className="mt-3 flex items-center gap-2 flex-wrap">
              <span className="text-2xs text-muted-foreground font-medium">Sort by:</span>
              {([
                { key: 'date', label: 'Date', icon: Calendar },
                { key: 'amount', label: 'Amount', icon: IndianRupee },
                { key: 'party', label: 'Party', icon: User },
                { key: 'status', label: 'Payment', icon: Receipt },
              ] as const).map(({ key, label, icon: Icon }) => (
                <button
                  key={key}
                  onClick={() => toggleSort(key)}
                  className={`flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-medium transition ${
                    sortBy === key
                      ? 'bg-primary text-primary-foreground'
                      : 'bg-muted/60 text-muted-foreground hover:bg-muted'
                  }`}
                >
                  <Icon className="w-3 h-3" />
                  {label}
                  {sortBy === key && (
                    <span className="ml-0.5">{sortOrder === 'asc' ? '↑' : '↓'}</span>
                  )}
                </button>
              ))}
            </div>
          )}

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
      {!isOnline() && !!error && !data ? (
        <Card className="shadow-card border-border/60 border-t-2 border-t-primary/10">
          <CardContent className="p-0">
            <OfflineNoData
              title={`No cached ${isSale ? 'sales' : 'purchases'}`}
              message={`You're offline and your ${isSale ? 'sales' : 'purchases'} list hasn't been cached yet. Connect to internet once to load it — after that, it works offline.`}
              onRetry={() => triggerRefresh()}
            />
          </CardContent>
        </Card>
      ) : isLoading ? (
        <WakingUpState rows={5} />
      ) : error && isOnline() ? (
        // 🔒 FIX H8: Was falling through to the empty state "No sales yet"
        // when the API returned a 500 (DB cold start). Now shows a clear
        // error with retry instead of misleading the user.
        <Card className="shadow-card border-border/60 border-t-2 border-t-primary/10">
          <CardContent className="py-12 text-center">
            <div className="w-12 h-12 rounded-full bg-rose-100 flex items-center justify-center mx-auto mb-3">
              <AlertCircle className="w-6 h-6 text-rose-600" />
            </div>
            <p className="text-sm font-medium mb-1">Couldn't load {isSale ? 'sales' : 'purchases'}</p>
            <p className="text-xs text-muted-foreground mb-4">The database might be warming up. Please try again.</p>
            <Button variant="outline" size="sm" onClick={() => triggerRefresh()} className="gap-2">
              <RefreshCw className="w-3.5 h-3.5" /> Retry
            </Button>
          </CardContent>
        </Card>
      ) : filtered.length === 0 ? (
        <Card className="shadow-card border-border/60 border-t-2 border-t-primary/10">
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
          {sorted.map((t) => {
            const due = roundMoney(t.totalAmount - t.paidAmount)
            const contextMenuItems: ContextMenuItem[] = [
              { label: 'View Details', icon: Eye, onClick: () => handleViewTransaction(t.id) },
              { label: 'Edit', icon: Edit2, onClick: () => {
                setSelectedTransactionId(t.id)
                setPreviousView(isSale ? 'sales' : 'purchases')
                setView('transaction-detail')
              }},
              { separator: true, label: '', onClick: () => {} },
              { label: 'Print Invoice', icon: Printer, onClick: () => {
                setSelectedTransactionId(t.id)
                setPreviousView(isSale ? 'sales' : 'purchases')
                setView('transaction-detail')
                setTimeout(() => window.print(), 500)
              }},
              { separator: true, label: '', onClick: () => {} },
              { label: 'Delete', icon: Trash2, onClick: () => handleDeleteTransaction(t.id), danger: true },
            ]
            return (
              <SwipeToDelete
                key={t.id}
                onDelete={() => handleDeleteTransaction(t.id)}
                confirmMessage={`Delete this ${isSale ? 'sale' : 'purchase'}? This cannot be undone.`}
              >
              <ContextMenu items={contextMenuItems}>
              <Card
                className={cn(
                  "shadow-card border-border/60 hover:shadow-md hover:border-primary/30 transition group",
                  bulkMode ? "cursor-default" : "cursor-pointer",
                  selectedIds.has(t.id) && "ring-2 ring-primary"
                )}
                onClick={() => bulkMode ? toggleSelect(t.id) : handleViewTransaction(t.id)}
              >
                <CardContent className="p-3 lg:p-4">
                  <div className="flex items-start gap-3">
                    {/* Checkbox — only visible in bulk mode */}
                    {bulkMode && (
                      <input
                        type="checkbox"
                        checked={selectedIds.has(t.id)}
                        onChange={() => toggleSelect(t.id)}
                        className="w-5 h-5 mt-2 rounded cursor-pointer flex-shrink-0"
                        onClick={(e) => e.stopPropagation()}
                      />
                    )}
                    {/* Circular avatar — shows first letter of party name,
                        or a shopping cart / truck icon for walk-in customers.
                        Tinted with the accent color for visual distinction. */}
                    <div className={cn('w-11 h-11 rounded-full flex items-center justify-center flex-shrink-0 font-bold text-sm', accentBg, accentColor)}>
                      {t.party?.name
                        ? t.party.name.charAt(0).toUpperCase()
                        : isSale
                          ? <ShoppingCart className="w-5 h-5" />
                          : <Truck className="w-5 h-5" />}
                    </div>

                    <div className="flex-1 min-w-0">
                      {/* Top row: party name + amount (the two most important things) */}
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="font-semibold text-sm truncate">
                            {t.party?.name || 'Walk-in Customer'}
                          </p>
                          {/* Secondary info — smaller, muted */}
                          <div className="flex items-center gap-2 mt-0.5 text-2xs text-muted-foreground flex-wrap">
                            <span className="flex items-center gap-1"><Calendar className="w-3 h-3" />{formatDateTime(t.date)}</span>
                            <span className="flex items-center gap-1"><User className="w-3 h-3" />{t.items?.length || 0} items</span>
                          </div>
                        </div>
                        {/* Amount — larger, bolder, tabular nums for alignment */}
                        <div className="text-right flex-shrink-0">
                          <p className={cn('font-bold text-base tabular-nums', accentColor)}>{formatINR(t.totalAmount)}</p>
                          {due > 0 && t.type !== 'estimate' && (
                            <p className="text-2xs text-rose-600 mt-0.5 tabular-nums">Due: {formatINR(due)}</p>
                          )}
                          {/* 🔒 V26 N2 follow-up: profit line only for real sales — an estimate's
                              profit isn't earned yet, and credit notes render their own line below */}
                          {t.type === 'sale' && !hideProfit && (
                            <p className="text-2xs text-emerald-600 dark:text-emerald-400 mt-0.5 tabular-nums">+{formatINR(t.grossProfit)}</p>
                          )}
                          {/* 🔒 V17 Audit Phase 4: credit-note grossProfit is NEGATIVE, so use < 0 */}
                          {t.type === 'credit-note' && !hideProfit && t.grossProfit < 0 && (
                            <p className="text-2xs text-rose-500 mt-0.5 tabular-nums">-{formatINR(Math.abs(t.grossProfit))}</p>
                          )}
                        </div>
                      </div>

                      {/* Bottom row: invoice no, payment mode, status badges + item chips */}
                      <div className="flex items-center gap-2 mt-2 flex-wrap">
                        {/* 🔒 V8 U1: Voided badge — shows when viewing soft-deleted transactions */}
                        {showVoided && (
                          <Badge className="text-3xs py-0 bg-rose-100 text-rose-700 dark:bg-rose-950/40 dark:text-rose-400 gap-1">
                            <Trash2 className="w-2.5 h-2.5" /> Voided
                          </Badge>
                        )}
                        {/* V17-Ext Tier 3: Credit/Debit Note badge */}
                        {t.type === 'credit-note' && (
                          <Badge className="text-3xs py-0 bg-violet-100 text-violet-700 dark:bg-violet-950/40 dark:text-violet-400">
                            Credit Note
                          </Badge>
                        )}
                        {t.type === 'debit-note' && (
                          <Badge className="text-3xs py-0 bg-violet-100 text-violet-700 dark:bg-violet-950/40 dark:text-violet-400">
                            Debit Note
                          </Badge>
                        )}
                        {/* 🔒 V26 FIX N2: Estimate badge so estimates are visually distinguishable */}
                        {t.type === 'estimate' && (
                          <Badge className="text-3xs py-0 bg-indigo-100 text-indigo-700 dark:bg-indigo-950/40 dark:text-indigo-400">
                            Estimate
                          </Badge>
                        )}
                        {t.invoiceNo && (
                          <Badge variant="outline" className="text-3xs py-0">{t.invoiceNo}</Badge>
                        )}
                        {/* 🔒 V26 N2 follow-up: estimates have no payment — the mode and
                            Paid/Unpaid badges would mislead (server stores paid=total on quotes) */}
                        {t.type !== 'estimate' && (
                          <>
                            <Badge variant="secondary" className="text-3xs py-0 uppercase">{t.paymentMode}</Badge>
                            {/* Payment status badge */}
                            {due > 0 ? (
                              <Badge variant="destructive" className="text-3xs py-0">
                                {due === t.totalAmount ? 'Unpaid' : 'Partial'}
                              </Badge>
                            ) : (
                              <Badge className="text-3xs py-0 bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-400">
                                Paid
                              </Badge>
                            )}
                          </>
                        )}
                      </div>

                      {t.items?.length > 0 && (
                        <div className="mt-2 flex flex-wrap gap-1">
                          {t.items.slice(0, 4).map((item: any, i: number) => (
                            <span key={i} className="text-2xs bg-muted px-2 py-0.5 rounded-md">
                              {item.productName} × {item.quantity}
                            </span>
                          ))}
                          {t.items.length > 4 && (
                            <span className="text-2xs text-muted-foreground px-2 py-0.5">+{t.items.length - 4} more</span>
                          )}
                        </div>
                      )}
                    </div>

                    <ChevronRight className="w-4 h-4 text-muted-foreground group-hover:text-primary mt-1 flex-shrink-0" />
                  </div>
                </CardContent>
              </Card>
              </ContextMenu>
              </SwipeToDelete>
            )
          })}
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
          {sorted.map((t) => {
            const due = roundMoney(t.totalAmount - t.paidAmount)
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
                  {t.invoiceNo && <p className="text-3xs text-muted-foreground">{t.invoiceNo}</p>}
                  <p className="text-3xs text-muted-foreground mt-1">{formatDateTime(t.date)}</p>
                  <div className="mt-2 pt-2 border-t border-border flex items-center justify-between">
                    <span className={cn('font-bold', accentColor)}>{formatINRCompact(t.totalAmount)}</span>
                    {/* 🔒 V26 N2 follow-up: quotes have no payment status */}
                    {t.type === 'estimate' ? (
                      <Badge className="text-3xs bg-indigo-100 text-indigo-700 dark:bg-indigo-950/40 dark:text-indigo-400">Estimate</Badge>
                    ) : due > 0 ? (
                      <Badge variant="destructive" className="text-3xs">Due {formatINRCompact(due)}</Badge>
                    ) : (
                      <Badge variant="secondary" className="text-3xs bg-emerald-100 text-emerald-700 dark:text-emerald-300">{t('stat.paid')}</Badge>
                    )}
                  </div>
                  {t.type === 'sale' && !hideProfit && (
                    <p className="text-3xs text-emerald-600 dark:text-emerald-400 mt-1">+{formatINRCompact(t.grossProfit)} profit</p>
                  )}
                  {/* 🔒 V17 Audit Phase 4: credit-note grossProfit is NEGATIVE, so use < 0 */}
                  {t.type === 'credit-note' && !hideProfit && t.grossProfit < 0 && (
                    <p className="text-3xs text-rose-500 mt-1">-{formatINRCompact(Math.abs(t.grossProfit))} profit reversed</p>
                  )}
                </CardContent>
              </Card>
            )
          })}
        </div>
      )}
      {/* 🔒 FIX M4: Load more button for cursor pagination */}
      {hasNextPage && !showVoided && (
        <div className="flex justify-center py-4">
          <Button
            variant="outline"
            onClick={() => fetchNextPage()}
            disabled={isFetchingNextPage}
            className="gap-2"
          >
            {isFetchingNextPage ? (
              <><RefreshCw className="w-4 h-4 animate-spin" /> Loading...</>
            ) : (
              <><RefreshCw className="w-4 h-4" /> Load more</>
            )}
          </Button>
        </div>
      )}
      {confirmDialogEl}
    </div>
  )
}
