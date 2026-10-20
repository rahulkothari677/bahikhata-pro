'use client'

import { useInfiniteQuery } from '@tanstack/react-query'
import { useState, useEffect, useRef } from 'react'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { SegmentedSwitch } from '@/components/common/SegmentedSwitch'
import { ChipRow } from '@/components/common/ChipRow'
import { KHATA_SORTS, type KhataChip, type KhataSort } from '@/lib/khata-list'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { Skeleton } from '@/components/ui/skeleton'
import { useAppStore } from '@/store/app-store'
import { useNewEntryRequest, useArrivalRequest } from '@/hooks/use-new-entry-request'
import { useTranslation } from '@/hooks/use-translation'
import { toast as sonnerToast } from 'sonner'
import { formatINR, formatDate, cn, getInitials, formatINRCompact } from '@/lib/utils'
import { ViewModeToggle } from '@/components/common/ViewModeToggle'
import { EmptyState } from '@/components/common/EmptyState'
import { ListItemSkeleton } from '@/components/common/Skeletons'
import {
  Plus, Search, Users, Phone,
  Building2, ChevronRight, Receipt, Send, Pencil, RotateCcw,
} from 'lucide-react'
import { offlineFetch, isQueuedResponse, isOnline, OfflineError } from '@/lib/offline-fetch'
import { OfflineNoData } from '@/components/common/OfflineNoData'
import { haptic } from '@/lib/haptic'
import { BulkRemindersModal } from '@/components/parties/BulkRemindersModal'
import { readError } from '@/lib/read-error'
import { describeSaveOutcome } from '@/lib/edit-conflict'
import { StateField, GstinField } from '@/components/common/StateField'

export function Parties() {
  const {
    refreshKey, triggerRefresh, partiesViewMode, setPartiesViewMode,
    triggerNewEntry, triggerNewEntryView, setSelectedPartyId, setView, setPreviousView,
  } = useAppStore()
  // 🔒 AUDIT V25 FIX BUG-032 (Batch 6): Subscribe to bulk-reminders trigger.
  const triggerBulkReminders = useAppStore((s) => s.triggerBulkReminders)
  const { t } = useTranslation()
  const [search, setSearch] = useState('')
  // Phase 5a-2: Khata shows one side at a time (Customers | Suppliers), like Bills.
  // Phase 5a-3: the side lives in the store, so the + sheet can open Suppliers.
  const filter = useAppStore((s) => s.khataSide)
  const setFilter = useAppStore((s) => s.setKhataSide)
  const [dialogOpen, setDialogOpen] = useState(false)
  /** #31: the party being corrected, or null when adding a new one. */
  const [editingParty, setEditingParty] = useState<any | null>(null)
  // 🔒 V22-13 (Batch C, Phase 7f): Bulk reminders modal state
  const [bulkRemindersOpen, setBulkRemindersOpen] = useState(false)

  /*
   * Phase 5e-1: the list comes from /api/parties/list — 60 parties at a time,
   * with every chip's count and the side's totals worked out over ALL parties
   * on the server (lib/khata-list.ts). It loaded up to 5,000 and added them up
   * here. Search, sort and chips all go to the server.
   */
  const side: 'customer' | 'supplier' = filter === 'supplier' ? 'supplier' : 'customer'
  const [chip, setChip] = useState<KhataChip>('all')
  const [sort, setSort] = useState<KhataSort>('balance')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  useEffect(() => {
    const id = setTimeout(() => setDebouncedSearch(search.trim()), 300)
    return () => clearTimeout(id)
  }, [search])
  useEffect(() => { setChip('all') }, [side])
  const { data: pages, isLoading, error, fetchNextPage, hasNextPage, isFetchingNextPage } = useInfiniteQuery({
    queryKey: ['khata', side, chip, sort, debouncedSearch, refreshKey],
    queryFn: async ({ pageParam }) => {
      const qp = new URLSearchParams({ side, chip, sort, offset: String(pageParam) })
      if (debouncedSearch) qp.set('search', debouncedSearch)
      const r = await offlineFetch(`/api/parties/list?${qp}`)
      if (!r.ok) throw new Error(`HTTP ${r.status}`)
      return r.json()
    },
    initialPageParam: 0,
    getNextPageParam: (last: any) => (last.hasMore ? last.offset + last.rows.length : undefined),
    placeholderData: (prev) => prev,
    retry: (count, err) => {
      if (err instanceof OfflineError) return false
      if (err instanceof TypeError) return false
      return count < 2
    },
  })
  const data = pages?.pages?.[0]
  const parties: any[] = pages?.pages?.flatMap((pg: any) => pg.rows) ?? []
  const counts: Record<KhataChip, number> | undefined = data?.counts
  const totals: { amount: number; owing: number; parties: number } | undefined = data?.totals

  // Phase 5a-3: "Add Customer/Supplier" / + sheet "New customer" from another screen.
  useNewEntryRequest('parties', () => setDialogOpen(true))

  // Listen for global "New Entry" trigger from Header (only if fired on this view)
  const lastTriggerRef = useRef(triggerNewEntry)
  useEffect(() => {
    if (triggerNewEntry > lastTriggerRef.current && triggerNewEntryView === 'parties') {
      lastTriggerRef.current = triggerNewEntry
      Promise.resolve().then(() => setDialogOpen(true))
    } else if (triggerNewEntry > lastTriggerRef.current) {
      lastTriggerRef.current = triggerNewEntry
    }
  }, [triggerNewEntry, triggerNewEntryView])

  // 🔒 AUDIT V25 FIX BUG-032 (Batch 6): When MoreScreen's "WhatsApp Reminders"
  // is tapped, it calls fireTriggerBulkReminders() + setView('parties'). This
  // effect detects the counter increment + opens the BulkRemindersModal.
  const lastBulkTriggerRef = useRef(triggerBulkReminders)
  useEffect(() => {
    if (triggerBulkReminders > lastBulkTriggerRef.current) {
      lastBulkTriggerRef.current = triggerBulkReminders
      setBulkRemindersOpen(true)
    }
  }, [triggerBulkReminders])
  // Phase 5b-2: the Reminders tile / More / search ask as a request, which
  // also works when Khata was not open yet (the counter above was missed).
  useArrivalRequest('parties', 'bulk-reminders', () => setBulkRemindersOpen(true))

  // Already narrowed by side, chip and search on the server.
  const filtered = parties
  const n = (one: string, many: string, k: number) => t(k === 1 ? one : many).replace('{n}', String(k))

  const handleViewParty = (id: string) => {
    setSelectedPartyId(id)
    setPreviousView('parties')
    setView('party-profile')
  }

  return (
    <div className="space-y-4">
      <SegmentedSwitch
        ariaLabel={t('nav.khata')}
        options={[{ value: 'customer', label: t('stat.customers') }, { value: 'supplier', label: t('parties.suppliers_only') }]}
        value={filter === 'supplier' ? 'supplier' : 'customer'}
        onChange={(v) => setFilter(v)}
        className="lg:max-w-md"
      />
      {/* Phase 5e-1 (ledger model v4): what this side owes or is owed, over every party, then the groups. */}
      <section className="rounded-2xl bg-card border border-border/60 shadow-card p-4 flex items-center justify-between gap-3 flex-wrap">
        <div className="min-w-0">
          <p className="text-xs text-muted-foreground">{t(side === 'customer' ? 'khata.collect' : 'khata.pay')}</p>
          <p className={cn('text-2xl font-bold tabular-nums', side === 'customer' ? 'text-good' : 'text-bad')}>{totals ? formatINR(totals.amount) : '…'}</p>
          {totals && (
            <p className="text-xs text-muted-foreground">
              {side === 'customer'
                ? t('khata.from_of').replace('{n}', String(totals.owing)).replace('{m}', String(totals.parties))
                : n('khata.to_1', 'khata.to_n', totals.owing)}
            </p>
          )}
        </div>
        {side === 'customer' && (
          <Button onClick={() => { haptic.click(); setBulkRemindersOpen(true) }} className="gap-1.5 min-h-12 bg-good text-white hover:bg-good/90">
            <Send className="w-4 h-4" /> {t('ins.plan_reminders')}
          </Button>
        )}
      </section>
      <ChipRow
        ariaLabel={t('khata.show')}
        value={chip}
        onChange={setChip}
        chips={(side === 'customer'
          ? (['all', 'due', 'old', 'regular', 'quiet', 'new', 'settled', 'advance'] as KhataChip[])
          : (['all', 'due', 'settled', 'advance'] as KhataChip[])
          // Regular / Gone quiet / New are Insights' customer groups: Insights' own words, one vocabulary.
        ).map((c) => ({ value: c, label: c === 'regular' || c === 'quiet' || c === 'new' ? t(`ins.seg.${c}`) : t(`khata.chip.${side}.${c}`), count: counts?.[c] }))}
      />

      {/* Toolbar - removed duplicate Add Party button (it's in header now) */}
      <Card className="shadow-card border-border/60">
        <CardContent className="p-3 lg:p-4">
          <div className="flex flex-col sm:flex-row gap-3 items-start sm:items-center">
            <div className="relative flex-1 w-full">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                placeholder={t('khata.search')}
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-9"
              />
            </div>
            <label className="flex items-center gap-2 text-sm text-muted-foreground">
              <span className="sr-only sm:not-sr-only">{t('khata.sort')}</span>
              <select
                aria-label={t('khata.sort')}
                value={sort}
                onChange={(e) => setSort(e.target.value as KhataSort)}
                className="min-h-12 rounded-xl border border-border bg-card px-3 text-sm text-foreground"
              >
                {/* Sales and oldest unpaid bill are about customers; a supplier list sorts by what you owe, recent or name. */}
                {KHATA_SORTS.filter((k) => side === 'customer' || !(k === 'sales' || k === 'oldest')).map((k) => <option key={k} value={k}>{t(`khata.sort.${k}`)}</option>)}
              </select>
            </label>
            <ViewModeToggle mode={partiesViewMode} onChange={setPartiesViewMode} />
            {/* Bulk reminders: "Plan reminders" on the card above (customers), and More / search / the Home tile. */}
          </div>
        </CardContent>
      </Card>

      {/* 🔒 V22-13 (Batch C, Phase 7f): Bulk Reminders Modal */}
      <BulkRemindersModal open={bulkRemindersOpen} onClose={() => setBulkRemindersOpen(false)} />

      {/* Parties list */}
      {!isOnline() && !!error && !data ? (
        <Card className="shadow-card border-border/60">
          <CardContent className="p-0">
            <OfflineNoData
              title="No cached parties"
              message="You're offline and your customer/supplier list hasn't been cached yet. Connect to internet once to load it — after that, it works offline."
              onRetry={() => triggerRefresh()}
            />
          </CardContent>
        </Card>
      ) : isLoading ? (
        // 🔒 V22-14 (Batch D, Phase 8c): Premium skeleton with avatar + text lines
        <ListItemSkeleton count={5} />
      ) : filtered.length === 0 ? (
        <Card className="shadow-card border-border/60">
          <CardContent className="p-0">
            {totals && totals.parties === 0 && !debouncedSearch ? (
              <EmptyState
                icon={Users}
                title="No customers or suppliers yet"
                description="Add customers to track their outstanding dues, and suppliers to manage purchases. You can add them anytime from here or while creating a sale/purchase."
                action={{
                  label: 'Add Customer',
                  onClick: () => { setEditingParty(null); setDialogOpen(true) },
                }}
              />
            ) : (
              <EmptyState
                icon={Users}
                title={debouncedSearch ? t('khata.none_search') : t('khata.none_chip')}
                size="compact"
              />
            )}
          </CardContent>
        </Card>
      ) : partiesViewMode === 'grid' ? (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
          {filtered.map((p) => (
            <Card
              key={p.id}
              className="shadow-card border-border/60 hover:shadow-md hover:border-primary/30 transition cursor-pointer group"
              onClick={() => handleViewParty(p.id)}
            >
              <CardContent className="p-4">
                <div className="flex items-start gap-3">
                  <Avatar className={cn(
                    'w-11 h-11 flex-shrink-0',
                  )}>
                    <AvatarFallback className={cn(
                      'text-white font-semibold text-sm',
                      p.type === 'customer' ? 'bg-gradient-to-br from-emerald-500 to-teal-600' :
                      p.type === 'supplier' ? 'bg-gradient-to-br from-amber-500 to-orange-600' :
                      'bg-gradient-to-br from-violet-500 to-purple-600'
                    )}>
                      {getInitials(p.name)}
                    </AvatarFallback>
                  </Avatar>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        <h3 className="font-semibold text-sm truncate group-hover:text-primary transition">{p.name}</h3>
                        <Badge variant="secondary" className="text-xs py-0 capitalize mt-0.5">{p.type}</Badge>
                      </div>
                      {/*
                        🔒 #31: the SAME edit control as the table row.

                        Added after browser verification: the fix went into the
                        table only, and the card layout is what the app actually
                        shows by default — so the button was invisible where it
                        mattered, and the test passed because it read the table
                        markup. This repo has had that exact bug before, in
                        "Selection worked in one layout and was a dead end in
                        the other".
                      */}
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="h-8 w-8 p-0 flex-shrink-0 -mt-1"
                        aria-label={`Edit ${p.name}`}
                        onClick={(e) => { e.stopPropagation(); setEditingParty(p); setDialogOpen(true) }}
                      >
                        <Pencil className="w-3.5 h-3.5 text-muted-foreground" />
                      </Button>
                      <ChevronRight className="w-4 h-4 text-muted-foreground group-hover:text-primary flex-shrink-0" />
                    </div>

                    <div className="mt-2 space-y-1">
                      {p.phone && (
                        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                          <Phone className="w-3 h-3" />
                          <span>{p.phone}</span>
                        </div>
                      )}
                      {p.gstin && (
                        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                          <Building2 className="w-3 h-3" />
                          <span className="font-mono">{p.gstin}</span>
                        </div>
                      )}
                    </div>

                    <div className="mt-3 pt-3 border-t border-border flex items-center justify-between">
                      <div>
                        {/* 🔒 V26 Phase 8: Bumped from text-xs to text-xs — user reported
                            these labels were too small and hardly visible. */}
                        <p className="text-xs text-muted-foreground">Balance</p>
                        <p className={cn(
                          'text-sm font-bold',
                          p.balance > 0 ? 'text-emerald-600 dark:text-emerald-400' : p.balance < 0 ? 'text-rose-600' : 'text-muted-foreground'
                        )}>
                          {p.balance > 0 ? `+${formatINR(p.balance)}` : p.balance < 0 ? `-${formatINR(Math.abs(p.balance))}` : 'Settled'}
                        </p>
                        {/* 🔒 V26 Phase 6 §6.2: Hindi-first gloss under the amount.
                            "lene hain" (will receive) / "dene hain" (will give).
                            Trust-language matters more than color alone (Khatabook pattern). */}
                        {p.balance !== 0 && (
                          <p className={cn(
                            'text-xs font-medium mt-0.5',
                            p.balance > 0 ? 'text-emerald-600/80 dark:text-emerald-400/80' : 'text-rose-600/80'
                          )}>
                            {p.balance > 0 ? t('stat.lene_hain') : t('stat.dene_hain')}
                          </p>
                        )}
                      </div>
                      <div className="text-right">
                        <p className="text-xs text-muted-foreground">Txns</p>
                        <p className="text-sm font-medium">{p.transactionCount}</p>
                      </div>
                    </div>

                    {p.balance !== 0 && (
                      <div className={cn(
                        'mt-2 text-xs px-2 py-1 rounded-md',
                        p.balance > 0 ? 'bg-emerald-50 text-emerald-700 dark:text-emerald-300' : 'bg-rose-50 text-rose-700'
                      )}>
                        {p.balance > 0 ? 'They owe you' : 'You owe them'}
                      </div>
                    )}
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      ) : (
        /* List mode - compact table */
        <Card className="shadow-card border-border/60 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/50">
                <tr className="text-left text-xs text-muted-foreground">
                  <th className="py-3 px-4 font-medium">Name</th>
                  <th className="py-3 px-2 font-medium">Type</th>
                  <th className="py-3 px-2 font-medium">Contact</th>
                  <th className="py-3 px-2 font-medium text-right">Txns</th>
                  <th className="py-3 px-2 font-medium text-right">Balance</th>
                  <th className="py-3 px-2"></th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((p) => (
                  <tr
                    key={p.id}
                    className="border-b border-border/50 hover:bg-muted/30 cursor-pointer group"
                    onClick={() => handleViewParty(p.id)}
                  >
                    <td className="py-3 px-4">
                      <div className="flex items-center gap-2">
                        <Avatar className="w-8 h-8">
                          <AvatarFallback className={cn(
                            'text-white font-semibold text-xs',
                            p.type === 'customer' ? 'bg-gradient-to-br from-emerald-500 to-teal-600' :
                            p.type === 'supplier' ? 'bg-gradient-to-br from-amber-500 to-orange-600' :
                            'bg-gradient-to-br from-violet-500 to-purple-600'
                          )}>
                            {getInitials(p.name)}
                          </AvatarFallback>
                        </Avatar>
                        <div>
                          <p className="font-medium group-hover:text-primary transition">{p.name}</p>
                          {p.gstin && <p className="text-xs font-mono text-muted-foreground">{p.gstin}</p>}
                        </div>
                      </div>
                    </td>
                    <td className="py-3 px-2">
                      <Badge variant="secondary" className="text-xs capitalize">{p.type}</Badge>
                    </td>
                    <td className="py-3 px-2 text-muted-foreground">
                      {p.phone || '—'}
                      {p.state && <span className="block text-xs">{p.state}</span>}
                    </td>
                    <td className="py-3 px-2 text-right">{p.transactionCount}</td>
                    <td className={cn('py-3 px-2 text-right font-semibold',
                      p.balance > 0 ? 'text-emerald-600 dark:text-emerald-400' : p.balance < 0 ? 'text-rose-600' : 'text-muted-foreground'
                    )}>
                      {p.balance > 0 ? `+${formatINRCompact(p.balance)}` : p.balance < 0 ? `-${formatINRCompact(Math.abs(p.balance))}` : 'Settled'}
                    </td>
                    <td className="py-3 px-2">
                      <div className="flex items-center gap-1 justify-end">
                        {/*
                          🔒 #31 (2026-08-13): until now a customer's details
                          could be typed once and never corrected — there was no
                          edit screen anywhere in the app.

                          stopPropagation because the whole row opens the party
                          profile. Without it, Edit would open the profile
                          instead, which is the same nested-click mistake the
                          bank-statement delete had to fix.
                        */}
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="h-8 w-8 p-0 opacity-0 group-hover:opacity-100 focus:opacity-100 transition"
                          aria-label={`Edit ${p.name}`}
                          onClick={(e) => { e.stopPropagation(); setEditingParty(p); setDialogOpen(true) }}
                        >
                          <Pencil className="w-3.5 h-3.5 text-muted-foreground" />
                        </Button>
                        <ChevronRight className="w-4 h-4 text-muted-foreground group-hover:text-primary" />
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {hasNextPage && (
        <button
          type="button"
          onClick={() => fetchNextPage()}
          disabled={isFetchingNextPage}
          className="w-full min-h-12 rounded-xl border border-border text-sm font-semibold hover:bg-muted disabled:opacity-60"
        >
          {t('khata.more').replace('{n}', String(Math.min(60, (data?.matched ?? 0) - parties.length))).replace('{m}', String(data?.matched ?? 0))}
        </button>
      )}

      {/* #267: the counter-returns khata (returns from customers with no khata). Not a person, so not in the
          list or any count, no phone, no reminder — one row after the customers, opening its statement. */}
      {side === 'customer' && chip === 'all' && !debouncedSearch && !hasNextPage && data?.counter && (
        <button
          type="button"
          onClick={() => handleViewParty(data.counter.id)}
          className="w-full min-h-16 rounded-xl border border-dashed border-border bg-card px-4 py-3 flex items-center gap-3 text-left hover:bg-muted/40 transition-colors"
        >
          <RotateCcw className="w-5 h-5 text-muted-foreground shrink-0" aria-hidden />
          <span className="min-w-0 flex-1">
            <span className="block text-sm font-semibold">{t('khata.counter')}</span>
            {data.counter.transactionCount > 0 && (
              <span className="block text-xs text-muted-foreground">{t('khata.counter_entries').replace('{n}', String(data.counter.transactionCount))}</span>
            )}
          </span>
          {/* What the balance means, in words: a refund not yet given, or an old counter bill left unpaid. */}
          <span className={cn('text-sm font-bold tabular-nums shrink-0', Math.round(data.counter.balance * 100) === 0 ? 'text-muted-foreground' : 'text-check')}>
            {Math.round(data.counter.balance * 100) === 0
              ? t('khata.chip.customer.settled')
              : t(data.counter.balance < 0 ? 'khata.counter_refund' : 'khata.counter_unpaid').replace('{v}', formatINR(Math.abs(data.counter.balance)))}
          </span>
        </button>
      )}

      <PartyDialog
        open={dialogOpen}
        party={editingParty}
        // Clearing on close matters: without it, the next "Add Party" would
        // reopen the last customer that was edited and overwrite them.
        onOpenChange={(v) => { setDialogOpen(v); if (!v) setEditingParty(null) }}
        onSuccess={() => triggerRefresh()}
      />
    </div>
  )
}

/**
 * Create a party, or correct one.
 *
 * 🔒 #31 (audit 2026-08-13): editing was impossible. `PUT /api/parties/[id]`
 * existed, was tested, and worked — I called it against production and got 200
 * — and NOTHING in the app called it. There was no edit screen at all, so a
 * customer's phone number, address or GSTIN could be typed once and never
 * corrected.
 *
 * The GSTIN is the one that hurts. deriveInterStateStatus reads it to decide
 * IGST versus CGST+SGST, so a GSTIN entered wrong at creation puts the wrong
 * tax on every future bill to that customer, and the shopkeeper has no way to
 * fix it short of creating a second party and splitting their ledger in half.
 *
 * One dialog for both, like ProductDialog: the fields are identical, and two
 * forms describing one thing drift apart.
 */
function PartyDialog({ open, onOpenChange, onSuccess, party }: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onSuccess?: () => void
  /** Present when correcting an existing party; absent when adding one. */
  party?: { id: string; name: string; type: string; phone?: string | null; email?: string | null; gstin?: string | null; address?: string | null; state?: string | null; openingBalance?: number | null; updatedAt?: string | null } | null
}) {
  const [form, setForm] = useState({
    name: '', type: 'customer', phone: '', email: '', gstin: '',
    address: '', state: '', openingBalance: '',
  })
  const [saving, setSaving] = useState(false)
  /** Duplicate name/phone rejected by the server, shown under that field. */
  const [dupError, setDupError] = useState<{ field: "name" | "phone"; message: string } | null>(null)

  const isEdit = !!party

  useEffect(() => {
    if (!open) return
    setDupError(null)
    if (party) {
      /*
       * The opening balance is shown as the shopkeeper entered it — a positive
       * number — even though a supplier's is stored negative. The save path
       * re-applies that sign, so a round trip through this form must not flip
       * it. Showing -7410 in a box labelled "how much do you owe them?" would
       * read as a bug, and correcting it would double the negation.
       */
      setForm({
        name: party.name ?? '',
        type: party.type ?? 'customer',
        phone: party.phone ?? '',
        email: party.email ?? '',
        gstin: party.gstin ?? '',
        address: party.address ?? '',
        state: party.state ?? '',
        openingBalance: party.openingBalance != null ? String(Math.abs(party.openingBalance)) : '',
      })
    } else {
      setForm({ name: '', type: 'customer', phone: '', email: '', gstin: '', address: '', state: '', openingBalance: '' })
    }
  }, [open, party])

  const handleSave = async () => {
    if (!form.name.trim()) {
      sonnerToast.error('Name is required')
      return
    }
    // 🔒 V26 Phase 8 V-2 (CRITICAL): Negate opening balance for suppliers.
    // The label says "how much do you owe them?" — but the balance engine
    // uses positive = they owe us. So a supplier you owe ₹7,410 must be
    // stored as -7410. Was: stored as +7410 → app showed "they owe you ₹7,410"
    // — the exact opposite of what the label promised. This made the bug
    // WORSE than before the fix.
    const rawOpening = parseFloat(form.openingBalance) || 0
    const normalizedOpening = form.type === 'supplier' ? -Math.abs(rawOpening) : rawOpening
    const payload = {
      ...form,
      openingBalance: normalizedOpening,
      /*
       * 🔒 #31: the stamp this party carried when it was opened, so the server
       * can say whether someone else changed it meanwhile. The parties route
       * has computed that warning since Phase 5 and has never once fired it,
       * because no client existed to send this.
       */
      ...(isEdit ? { updatedAt: party!.updatedAt ?? null } : {}),
    }
    setSaving(true)
    try {
      const r = await offlineFetch(isEdit ? `/api/parties/${party!.id}` : '/api/parties', {
        method: isEdit ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        offline: { invalidate: ['/api/parties', '/api/dashboard'] },
      })
      // 🔒 A duplicate belongs UNDER the offending field, not in a toast that
      // appears away from the input and disappears before it is read.
      if (r.status === 409) {
        const body = await r.json().catch(() => ({} as any))
        if (body?.code === 'DUPLICATE_PARTY' && (body.field === 'name' || body.field === 'phone')) {
          setDupError({ field: body.field, message: body.fieldError || 'This already exists — try a different one.' })
          haptic.error()
          return
        }
      }
      if (!r.ok) throw new Error(await readError(r))

      /*
       * 🔒 #31 + #29: show the concurrent-edit warning, using the same shared
       * decision the invoice and product screens use.
       */
      const queuedOffline = isQueuedResponse(r)
      const saved = queuedOffline ? null : await r.clone().json().catch(() => null)
      const outcome = describeSaveOutcome(saved, {
        queuedOffline,
        subject: 'party',
        successTitle: isEdit ? 'Customer details updated' : 'Party added successfully',
      })

      if (outcome.kind === 'warning') {
        haptic.warning()
        sonnerToast.warning(outcome.title, { description: outcome.description, duration: outcome.durationMs })
      } else {
        sonnerToast.success(outcome.title, { duration: outcome.durationMs })
        haptic.success()
      }
      onSuccess?.()
      onOpenChange(false)
    } catch (e: any) {
      haptic.error()
      sonnerToast.error(e?.message || "Couldn\'t save the party")
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Users className="w-5 h-5 text-amber-600 dark:text-amber-400" />
            {/*
              🔒 #31: the heading has to change, and browser verification is
              what caught that it did not. Editing "Amul Distributors" under a
              heading reading "Add Party" tells the shopkeeper they are about to
              create a duplicate customer — so the honest ones cancel, and the
              correction never gets made. Naming the party removes the doubt.
            */}
            {isEdit ? `Edit ${party!.name}` : 'Add Party'}
          </DialogTitle>
        </DialogHeader>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 py-2">
          <div className="sm:col-span-2">
            <Label htmlFor="field-name">Name *</Label>
            <Input
              id="field-name"
              value={form.name}
              onChange={(e) => { setDupError(null); setForm({ ...form, name: e.target.value }) }}
              placeholder="Customer or supplier name"
              className={cn(dupError?.field === 'name' && 'border-rose-500 focus-visible:ring-rose-500')}
              aria-invalid={dupError?.field === 'name'}
              autoFocus
            />
            {dupError?.field === 'name' && (
              <p className="text-xs text-rose-600 mt-1">{dupError.message}</p>
            )}
          </div>
          <div>
            <Label htmlFor="field-type">Type</Label>
            <Select value={form.type} onValueChange={(v) => setForm({ ...form, type: v })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="customer">Customer</SelectItem>
                <SelectItem value="supplier">Supplier</SelectItem>
                <SelectItem value="both">Both</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label htmlFor="field-opening-balance">
              {/* 🔒 V26 Phase 8 PB-6: Type-aware label for opening balance.
                  Was: one generic label with a placeholder hint → suppliers with
                  positive opening balance became receivables (wrong sign). */}
              {form.type === 'supplier'
                ? 'Opening Balance — how much do you owe them? (₹)'
                : form.type === 'both'
                  ? 'Opening Balance (₹)'
                  : 'Opening Balance — how much do they owe you? (₹)'}
            </Label>
            <Input id="field-opening-balance"
              inputMode="decimal" type="number"
              value={form.openingBalance}
              onChange={(e) => setForm({ ...form, openingBalance: e.target.value })}
              placeholder={form.type === 'supplier' ? '0 (amount you owe them)' : '0 (amount they owe you)'}
            />
          </div>
          <div className="sm:col-span-2">
            <Label htmlFor="field-phone">Phone</Label>
            <Input
              id="field-phone"
              value={form.phone}
              onChange={(e) => { setDupError(null); setForm({ ...form, phone: e.target.value }) }}
              placeholder="10-digit mobile"
              className={cn(dupError?.field === 'phone' && 'border-rose-500 focus-visible:ring-rose-500')}
              aria-invalid={dupError?.field === 'phone'}
            />
            {dupError?.field === 'phone' && (
              <p className="text-xs text-rose-600 mt-1">{dupError.message}</p>
            )}
          </div>
          <div>
            <Label htmlFor="field-gstin">GSTIN</Label>
            <GstinField id="field-gstin" value={form.gstin} onChange={(g, st) => setForm({ ...form, gstin: g, ...(st ? { state: st } : {}) })} />
          </div>
          <div>
            <Label htmlFor="field-state">State</Label>
            <StateField id="field-state" value={form.state} onChange={(v) => setForm({ ...form, state: v })} gstin={form.gstin} />
          </div>
          <div className="sm:col-span-2">
            <Label htmlFor="field-address">Address</Label>
            <Input id="field-address" value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} placeholder="Full address" />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={handleSave} disabled={saving} className="bg-gradient-saffron">
            {saving ? 'Saving...' : isEdit ? 'Save Changes' : 'Add Party'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
