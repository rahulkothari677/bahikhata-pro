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
// 🔒 AUDIT C5: ONE definition of "still due on this bill". Computing it inline
// as `total − paidAmount` ignores Settle payments, which is the stale figure
// that made a bill invite being collected a second time.
import { computeInvoiceDue } from '@/lib/invoice-due'
import { useTranslation } from '@/hooks/use-translation'
import { useSubscription } from '@/hooks/use-subscription'
// ViewModeToggle, DateRangePicker and getPresetRange moved into
// LedgerFilterSheet with the controls themselves; only the label helper and
// the types are still needed out here, for the active-filter chips.
import { getPresetLabel, type DateRange, type DatePreset } from '@/components/common/DateRangePicker'
import { EmptyState } from '@/components/common/EmptyState'
import { WakingUpState } from '@/components/common/WakingUpState'
import { SwipeToDelete } from '@/components/common/SwipeToDelete'
import { ContextMenu, type ContextMenuItem } from '@/components/common/ContextMenu'
import {
  Search, ShoppingCart, Truck, Receipt, IndianRupee,
  TrendingUp, Calendar, User, ChevronRight, Plus, X,
  Edit2, Trash2, Eye, Printer, AlertCircle, RefreshCw, Undo2, Loader2,
  SlidersHorizontal, CheckSquare,
} from 'lucide-react'
import { LedgerFilterSheet, SORT_OPTIONS } from './LedgerFilterSheet'
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
    refreshKey, triggerRefresh, setView,
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
  const [filtersOpen, setFiltersOpen] = useState(false)
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
                } catch (e: any) {
                  sonnerToast.error(e?.message || 'Could not restore — check your connection.')
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

  /* Drives the badge on the tune button and the chip row below it.
     Sorting counts only when it is NOT the default (newest first): a badge
     that is permanently lit tells you nothing. */
  const activeFilterCount =
    (dateRange ? 1 : 0) + (sortBy !== 'date' ? 1 : 0) + (showVoided ? 1 : 0)

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
  /*
   * Debounced copy of `search`, used for the SERVER query only.
   *
   * `search` still drives the local filter on every keystroke, so typing feels
   * instant against what is already loaded. This lags 350ms behind and is part
   * of the query key, so a refetch happens once the shopkeeper stops typing
   * rather than on every character.
   */
  const [debouncedSearch, setDebouncedSearch] = useState('')
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search.trim()), 350)
    return () => clearTimeout(t)
  }, [search])

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
    // 🔒 Search runs on the SERVER (2026-08-03). It used to filter only the
    // rows already loaded, so finding a three-month-old invoice meant pressing
    // "Load more" until it appeared — on the test account it was still missing
    // after 100 rows. Looking up an old bill is a daily task.
    if (debouncedSearch) qp.set('search', debouncedSearch)
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
    // `debouncedSearch` is part of the key: a different search is a different
    // result set, and paging must restart from page 1 rather than continue
    // from a cursor belonging to the previous query.
    queryKey: ['transactions', type, refreshKey, dateRange?.from.toISOString() || 'all', dateRange?.to.toISOString() || 'all', showVoided ? 'voided' : 'active', debouncedSearch],
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

  const filtered = transactions.filter(txn => {
    if (!search) return true
    const q = search.toLowerCase()
    return txn.invoiceNo?.toLowerCase().includes(q) ||
      txn.party?.name?.toLowerCase().includes(q) ||
      txn.notes?.toLowerCase().includes(q)
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
      const aDue = computeInvoiceDue(a)
      const bDue = computeInvoiceDue(b)
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
    setSelectedIds(new Set(sorted.map(txn => txn.id)))
  }

  /*
   * Leave selection mode. Named for what it does, because the old name was
   * the whole problem: this was called `clearSelection` and wired to a button
   * labelled "Clear", so the only exit from the mode was disguised as a
   * "deselect everything" action. Untick-only now lives inline in the bar.
   *
   * Still used after a bulk delete or export, where finishing the job and
   * leaving the mode is the right pair of things to do.
   */
  const exitBulkMode = () => {
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
    exitBulkMode()
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
    const selectedTxns = sorted.filter(txn => selectedIds.has(txn.id))
    const headers = ['Date', 'Invoice', 'Party', 'Type', 'Amount', 'Paid', 'Due', 'Payment Mode']
    const rows = selectedTxns.map(txn => [
      formatDate(txn.date),
      txn.invoiceNo || '',
      txn.party?.name || 'Walk-in',
      txn.type,
      txn.totalAmount,
      txn.paidAmount,
      computeInvoiceDue(txn),
      txn.paymentMode,
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
    exitBulkMode()
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
  //
  // 🔒 SETTLEMENTS COUNT TOO (2026-08-03). Found in the browser: INV-0043 —
  // ₹600 sale, ₹200 at billing, ₹400 settled later, fully paid — showed
  // PAID ₹200 / OUTSTANDING ₹400 in these cards, while the bill itself
  // correctly read ₹0 due.
  //
  // The rule is stated at the top of this file and applied per row via
  // computeInvoiceDue(), but this AGGREGATE still did `total − paidAmount`,
  // so every Settle payment was invisible to it. That is the stale "Due" the
  // C5 work existed to kill — an invoice that looks unpaid invites being
  // collected a second time, and here it was doing so at the top of the
  // ledger, where the shopkeeper looks first.
  //
  // `allocatedAmount` is summed from paymentAllocations by the list API, so
  // it is already on every row. Notes carry no allocations (Settle only
  // targets sale/purchase), so adding it is a no-op for them.
  const totalPaid = filtered.reduce((s, t) => {
    if (t.type === 'estimate') return s  // 🔒 V26 N2 follow-up: quotes collect nothing
    const collected = roundMoney((t.paidAmount || 0) + (t.allocatedAmount || 0))
    if (isSale) {
      return t.type === 'credit-note' ? s - collected : s + collected
    } else {
      return t.type === 'debit-note' ? s - collected : s + collected
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
          {/* ONE row: find, and everything-else.
           *
           * What stood here was seven stacked bands on a phone (see
           * LedgerFilterSheet's header for the full account). Search is the only
           * control a shopkeeper reaches for repeatedly, so it is the only one
           * that keeps permanent space. The rest are set-once settings and now
           * live behind the tune button, which carries a count when any are on.
           *
           * "Scan Bill" is gone rather than moved. The same scanner is already
           * reachable from the dashboard hero row, the dashboard quick actions,
           * and the + in the bottom nav. A fourth copy inside a list's filter
           * bar is not discoverability — it is a create action sitting in the
           * one place the user came to read. */}
          <div className="flex items-center gap-2">
            <div className="relative flex-1 min-w-0">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                placeholder={`Search ${isSale ? 'sales' : 'purchases'}...`}
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-9"
              />
            </div>
            <Button
              variant="outline"
              onClick={() => setFiltersOpen(true)}
              className="relative h-10 w-10 p-0 flex-shrink-0"
              title="Filter and sort"
              aria-label={activeFilterCount > 0 ? `Filter and sort, ${activeFilterCount} active` : 'Filter and sort'}
            >
              <SlidersHorizontal className="w-4 h-4" />
              {activeFilterCount > 0 && (
                <span className="absolute -top-1.5 -right-1.5 min-w-[18px] h-[18px] px-1 rounded-full bg-primary text-primary-foreground text-3xs font-bold flex items-center justify-center">
                  {activeFilterCount}
                </span>
              )}
            </Button>
          </div>

          {/* What you actually chose, as chips you can dismiss. The old bar
              showed every option and never the state; this shows the state and
              nothing else, so an unexpectedly short ledger explains itself
              instead of looking like missing data. */}
          {activeFilterCount > 0 && (
            <div className="mt-2 flex items-center gap-1.5 overflow-x-auto no-scrollbar">
              {dateRange && (
                <button
                  onClick={() => { setDateRange(null); setDatePreset('thisMonth') }}
                  className="flex-shrink-0 flex items-center gap-1 pl-2.5 pr-1.5 py-1 rounded-full bg-primary/10 text-primary text-xs font-medium"
                >
                  <Calendar className="w-3 h-3" />
                  {getPresetLabel(datePreset)}
                  <X className="w-3 h-3" />
                </button>
              )}
              {sortBy !== 'date' && (
                <button
                  onClick={() => { setSortBy('date'); setSortOrder('desc') }}
                  className="flex-shrink-0 flex items-center gap-1 pl-2.5 pr-1.5 py-1 rounded-full bg-primary/10 text-primary text-xs font-medium"
                >
                  {SORT_OPTIONS.find((o) => o.key === sortBy)?.label}
                  {sortOrder === 'asc' ? '↑' : '↓'}
                  <X className="w-3 h-3" />
                </button>
              )}
              {showVoided && (
                <button
                  onClick={() => setShowVoided(false)}
                  className="flex-shrink-0 flex items-center gap-1 pl-2.5 pr-1.5 py-1 rounded-full bg-primary/10 text-primary text-xs font-medium"
                >
                  <Trash2 className="w-3 h-3" />
                  Voided
                  <X className="w-3 h-3" />
                </button>
              )}
            </div>
          )}

          {/* Selection bar.
           *
           * There was no way out of this mode. The only button that closed it
           * was labelled "Clear", which reads as "clear what I have ticked" —
           * so the exit was hidden inside a control that appears to do
           * something else, and someone who had ticked five rows would not
           * dare press it to escape.
           *
           * Two separate jobs, now two separate controls. The ✕ on the left is
           * the way out, where every contextual action bar puts it — Gmail,
           * Google Photos, WhatsApp all lead with it. "Clear" now only
           * unticks, and only appears when there is something to untick. */}
          {bulkMode && (
            <div className="mt-3 flex items-center gap-2 flex-wrap p-2.5 rounded-lg bg-primary/5 border border-primary/20">
              <Button
                size="sm"
                variant="ghost"
                className="h-9 w-9 p-0 -ml-1 flex-shrink-0"
                onClick={exitBulkMode}
                title="Done selecting"
                aria-label="Exit selection mode"
              >
                <X className="w-4 h-4" />
              </Button>
              <span className="text-xs font-medium text-primary">
                {selectedIds.size} selected
              </span>
              <Button size="sm" variant="ghost" className="h-9 text-xs" onClick={selectAll}>Select all</Button>
              {selectedIds.size > 0 && (
                <Button size="sm" variant="ghost" className="h-9 text-xs" onClick={() => setSelectedIds(new Set())}>
                  Clear
                </Button>
              )}
              <div className="flex-1" />
              <Button
                size="sm"
                variant="outline"
                className="h-9 text-xs gap-1.5"
                onClick={handleBulkExport}
                disabled={selectedIds.size === 0}
              >
                Export CSV
              </Button>
              <Button
                size="sm"
                variant="destructive"
                className="h-9 text-xs gap-1.5"
                onClick={handleBulkDelete}
                disabled={selectedIds.size === 0}
              >
                Delete
              </Button>
            </div>
          )}

          {/* Bulk select. Was a 10px grey text link on a line of its own —
              "so small it doesn't serve its purpose", which is exactly right,
              because it is the ONLY route to bulk delete and bulk export.
              It now sits next to the count, where a list's own actions belong,
              at a real 44px touch target. */}
          {sorted.length > 0 && !bulkMode && (
            <div className="mt-3 flex items-center justify-between gap-3">
              <span className="text-xs text-muted-foreground">
                {sorted.length} {sorted.length === 1 ? 'entry' : 'entries'}
              </span>
              <button
                onClick={() => setBulkMode(true)}
                className="flex items-center gap-1.5 min-h-[44px] px-2 -mr-2 text-xs font-medium text-primary hover:underline"
              >
                <CheckSquare className="w-3.5 h-3.5" />
                Select
              </button>
            </div>
          )}

          {/* The four sort buttons and the separate "Filtered:" badge that used
              to sit here are both in the sheet / chip row above now. */}

          {/* The exact dates behind the active period. The chip above names the
              period; this says what it resolved to, which matters when someone
              is reconciling against a bank statement. */}
          {dateRange && (
            <p className="mt-1.5 text-2xs text-muted-foreground">
              {dateRange.from.toLocaleDateString('en-IN')} — {dateRange.to.toLocaleDateString('en-IN')}
            </p>
          )}
        </CardContent>
      </Card>

      <LedgerFilterSheet
        open={filtersOpen}
        onOpenChange={setFiltersOpen}
        sortBy={sortBy}
        sortOrder={sortOrder}
        onToggleSort={toggleSort}
        dateRange={dateRange}
        datePreset={datePreset}
        onDateChange={(range, preset) => { setDateRange(range); setDatePreset(preset) }}
        viewMode={transactionsViewMode}
        onViewMode={setTransactionsViewMode}
        showVoided={showVoided}
        onShowVoided={(v) => { setShowVoided(v); setSearch('') }}
        resultCount={sorted.length}
        onReset={() => {
          setDateRange(null)
          setDatePreset('thisMonth')
          setSortBy('date')
          setSortOrder('desc')
          setShowVoided(false)
          setSearch('')
        }}
      />

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
      ) : filtered.length === 0 && transactions.length > 0 ? (
        /*
         * 🔒 "NOTHING MATCHED" IS NOT "NOTHING EXISTS" (2026-08-03, reported
         * by Rahul; reproduced searching a real invoice number).
         *
         * Search filters only the rows already loaded — 50 per page, keyset
         * paginated. Searching for an invoice that sits behind "Load more"
         * showed "No sales yet — Record your first sale to start tracking
         * revenue" to a shop with fifty-plus sales on file. It reads as data
         * loss, which for a ledger is about the most alarming thing the screen
         * can say.
         *
         * The distinction is exactly `transactions.length`: rows came back,
         * this filter just excluded them. Offer the two things that actually
         * help — clear the search, or load more and search again.
         */
        <Card className="shadow-card border-border/60 border-t-2 border-t-primary/10">
          <CardContent className="py-10 text-center space-y-3">
            <div className="w-12 h-12 rounded-full bg-muted flex items-center justify-center mx-auto">
              <Search className="w-5 h-5 text-muted-foreground" />
            </div>
            <div className="space-y-1">
              <p className="text-sm font-medium">
                {search ? <>No {isSale ? 'sales' : 'purchases'} match &ldquo;{search}&rdquo;</> : 'Nothing matches these filters'}
              </p>
              <p className="text-xs text-muted-foreground max-w-sm mx-auto">
                {/*
                  Search now runs on the SERVER across every entry, so "no
                  match" here means no match anywhere — not "not loaded yet".
                  The earlier wording ("no match in the N loaded") described
                  the limitation this replaced, and would now be a lie.
                */}
                {search
                  ? 'Searched every invoice number, party name, phone and note.'
                  : 'Try a different date range, or clear the filters.'}
              </p>
            </div>
            <div className="flex items-center justify-center gap-2 flex-wrap">
              {search && (
                <Button variant="outline" size="sm" onClick={() => setSearch('')} className="gap-2">
                  <X className="w-3.5 h-3.5" /> Clear search
                </Button>
              )}
              {hasNextPage && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => fetchNextPage()}
                  disabled={isFetchingNextPage}
                  className="gap-2"
                >
                  {isFetchingNextPage
                    ? <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Loading…</>
                    : <><RefreshCw className="w-3.5 h-3.5" /> Load more</>}
                </Button>
              )}
            </div>
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
          {sorted.map((txn) => {
            const due = computeInvoiceDue(txn)
            const contextMenuItems: ContextMenuItem[] = [
              { label: 'View Details', icon: Eye, onClick: () => handleViewTransaction(txn.id) },
              { label: 'Edit', icon: Edit2, onClick: () => {
                setSelectedTransactionId(txn.id)
                setPreviousView(isSale ? 'sales' : 'purchases')
                setView('transaction-detail')
              }},
              { separator: true, label: '', onClick: () => {} },
              { label: 'Print Invoice', icon: Printer, onClick: () => {
                setSelectedTransactionId(txn.id)
                setPreviousView(isSale ? 'sales' : 'purchases')
                setView('transaction-detail')
                setTimeout(() => window.print(), 500)
              }},
              { separator: true, label: '', onClick: () => {} },
              { label: 'Delete', icon: Trash2, onClick: () => handleDeleteTransaction(txn.id), danger: true },
            ]
            return (
              <SwipeToDelete
                key={txn.id}
                onDelete={() => handleDeleteTransaction(txn.id)}
                confirmMessage={`Delete this ${isSale ? 'sale' : 'purchase'}? This cannot be undone.`}
              >
              <ContextMenu items={contextMenuItems}>
              <Card
                className={cn(
                  "shadow-card border-border/60 hover:shadow-md hover:border-primary/30 transition group",
                  bulkMode ? "cursor-default" : "cursor-pointer",
                  selectedIds.has(txn.id) && "ring-2 ring-primary"
                )}
                onClick={() => bulkMode ? toggleSelect(txn.id) : handleViewTransaction(txn.id)}
              >
                <CardContent className="p-3 lg:p-4">
                  <div className="flex items-start gap-3">
                    {/* Checkbox — only visible in bulk mode */}
                    {bulkMode && (
                      <input
                        type="checkbox"
                        checked={selectedIds.has(txn.id)}
                        onChange={() => toggleSelect(txn.id)}
                        className="w-5 h-5 mt-2 rounded cursor-pointer flex-shrink-0"
                        onClick={(e) => e.stopPropagation()}
                      />
                    )}
                    {/* Circular avatar — shows first letter of party name,
                        or a shopping cart / truck icon for walk-in customers.
                        Tinted with the accent color for visual distinction. */}
                    <div className={cn('w-11 h-11 rounded-full flex items-center justify-center flex-shrink-0 font-bold text-sm', accentBg, accentColor)}>
                      {txn.party?.name
                        ? txn.party.name.charAt(0).toUpperCase()
                        : isSale
                          ? <ShoppingCart className="w-5 h-5" />
                          : <Truck className="w-5 h-5" />}
                    </div>

                    <div className="flex-1 min-w-0">
                      {/* Top row: party name + amount (the two most important things) */}
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="font-semibold text-sm truncate">
                            {txn.party?.name || 'Walk-in Customer'}
                          </p>
                          {/* Secondary info — smaller, muted */}
                          <div className="flex items-center gap-2 mt-0.5 text-2xs text-muted-foreground flex-wrap">
                            <span className="flex items-center gap-1"><Calendar className="w-3 h-3" />{formatDateTime(txn.date)}</span>
                            <span className="flex items-center gap-1"><User className="w-3 h-3" />{txn.items?.length || 0} items</span>
                          </div>
                        </div>
                        {/* Amount — larger, bolder, tabular nums for alignment */}
                        <div className="text-right flex-shrink-0">
                          <p className={cn('font-bold text-base tabular-nums', accentColor)}>{formatINR(txn.totalAmount)}</p>
                          {due > 0 && txn.type !== 'estimate' && (
                            <p className="text-2xs text-rose-600 mt-0.5 tabular-nums">Due: {formatINR(due)}</p>
                          )}
                          {/* 🔒 V26 N2 follow-up: profit line only for real sales — an estimate's
                              profit isn't earned yet, and credit notes render their own line below */}
                          {txn.type === 'sale' && !hideProfit && (
                            <p className="text-2xs text-emerald-600 dark:text-emerald-400 mt-0.5 tabular-nums">+{formatINR(txn.grossProfit)}</p>
                          )}
                          {/* 🔒 V17 Audit Phase 4: credit-note grossProfit is NEGATIVE, so use < 0 */}
                          {txn.type === 'credit-note' && !hideProfit && txn.grossProfit < 0 && (
                            <p className="text-2xs text-rose-500 mt-0.5 tabular-nums">-{formatINR(Math.abs(txn.grossProfit))}</p>
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
                        {txn.type === 'credit-note' && (
                          <Badge className="text-3xs py-0 bg-violet-100 text-violet-700 dark:bg-violet-950/40 dark:text-violet-400">
                            Credit Note
                          </Badge>
                        )}
                        {txn.type === 'debit-note' && (
                          <Badge className="text-3xs py-0 bg-violet-100 text-violet-700 dark:bg-violet-950/40 dark:text-violet-400">
                            Debit Note
                          </Badge>
                        )}
                        {/* 🔒 V26 FIX N2: Estimate badge so estimates are visually distinguishable */}
                        {txn.type === 'estimate' && (
                          <Badge className="text-3xs py-0 bg-indigo-100 text-indigo-700 dark:bg-indigo-950/40 dark:text-indigo-400">
                            Estimate
                          </Badge>
                        )}
                        {txn.invoiceNo && (
                          <Badge variant="outline" className="text-3xs py-0">{txn.invoiceNo}</Badge>
                        )}
                        {/* 🔒 V26 N2 follow-up: estimates have no payment — the mode and
                            Paid/Unpaid badges would mislead (server stores paid=total on quotes) */}
                        {txn.type !== 'estimate' && (
                          <>
                            <Badge variant="secondary" className="text-3xs py-0 uppercase">{txn.paymentMode}</Badge>
                            {/* Payment status badge */}
                            {due > 0 ? (
                              <Badge variant="destructive" className="text-3xs py-0">
                                {due === txn.totalAmount ? 'Unpaid' : 'Partial'}
                              </Badge>
                            ) : (
                              <Badge className="text-3xs py-0 bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-400">
                                Paid
                              </Badge>
                            )}
                          </>
                        )}
                      </div>

                      {txn.items?.length > 0 && (
                        <div className="mt-2 flex flex-wrap gap-1">
                          {txn.items.slice(0, 4).map((item: any, i: number) => (
                            <span key={i} className="text-2xs bg-muted px-2 py-0.5 rounded-md">
                              {item.productName} × {item.quantity}
                            </span>
                          ))}
                          {txn.items.length > 4 && (
                            <span className="text-2xs text-muted-foreground px-2 py-0.5">+{txn.items.length - 4} more</span>
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
        /* Two columns on a phone, not one.
         *
         * grid-cols-1 made this a worse version of the detailed list — same
         * one-card-per-row shape, less information in it — so the toggle had
         * no reason to exist on mobile. At two-up it is what its name says:
         * a dense overview you scan, against a detailed list you read. */
        <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
          {/*
           * `txn`, NOT `t`.
           *
           * This map used to bind `t`, which shadowed the `t` from
           * useTranslation() declared at the top of this component. The card
           * body then called `t('stat.paid')` — invoking the TRANSACTION as if
           * it were the translator. "t is not a function", straight into the
           * error boundary: the whole app showed "Something went wrong" the
           * moment anyone switched to this layout with a paid entry on screen.
           *
           * It was invisible in review because both halves read perfectly on
           * their own; only the name they share is wrong. The detailed list
           * below binds `t` the same way and survives purely because nothing
           * in it happens to call the translator — one added label and it
           * would have crashed too, so it is renamed as well.
           */}
          {sorted.map((txn) => {
            const due = computeInvoiceDue(txn)
            return (
              <Card
                key={txn.id}
                className="shadow-card border-border/60 hover:shadow-md hover:border-primary/30 transition cursor-pointer"
                onClick={() => handleViewTransaction(txn.id)}
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
                  <p className="font-semibold text-sm truncate">{txn.party?.name || 'Walk-in'}</p>
                  {txn.invoiceNo && <p className="text-3xs text-muted-foreground truncate">{txn.invoiceNo}</p>}
                  <p className="text-3xs text-muted-foreground mt-1 truncate">{formatDateTime(txn.date)}</p>
                  <div className="mt-2 pt-2 border-t border-border flex items-center justify-between gap-1 flex-wrap">
                    <span className={cn('font-bold', accentColor)}>{formatINRCompact(txn.totalAmount)}</span>
                    {/* 🔒 V26 N2 follow-up: quotes have no payment status */}
                    {txn.type === 'estimate' ? (
                      <Badge className="text-3xs bg-indigo-100 text-indigo-700 dark:bg-indigo-950/40 dark:text-indigo-400">Estimate</Badge>
                    ) : due > 0 ? (
                      <Badge variant="destructive" className="text-3xs">Due {formatINRCompact(due)}</Badge>
                    ) : (
                      <Badge variant="secondary" className="text-3xs bg-emerald-100 text-emerald-700 dark:text-emerald-300">{t('stat.paid')}</Badge>
                    )}
                  </div>
                  {txn.type === 'sale' && !hideProfit && (
                    <p className="text-3xs text-emerald-600 dark:text-emerald-400 mt-1">+{formatINRCompact(txn.grossProfit)} profit</p>
                  )}
                  {/* 🔒 V17 Audit Phase 4: credit-note grossProfit is NEGATIVE, so use < 0 */}
                  {txn.type === 'credit-note' && !hideProfit && txn.grossProfit < 0 && (
                    <p className="text-3xs text-rose-500 mt-1">-{formatINRCompact(Math.abs(txn.grossProfit))} profit reversed</p>
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
