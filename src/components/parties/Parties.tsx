'use client'

import { useQuery } from '@tanstack/react-query'
import { useState, useEffect, useRef } from 'react'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { Skeleton } from '@/components/ui/skeleton'
import { useAppStore } from '@/store/app-store'
import { useTranslation } from '@/hooks/use-translation'
import { toast as sonnerToast } from 'sonner'
import { formatINR, formatDate, cn, getInitials, formatINRCompact } from '@/lib/utils'
import { ViewModeToggle } from '@/components/common/ViewModeToggle'
import { EmptyState } from '@/components/common/EmptyState'
import { ListItemSkeleton } from '@/components/common/Skeletons'
import {
  Plus, Search, Users, Phone, User, ArrowDownRight, ArrowUpRight,
  Building2, ChevronRight, Receipt, Send,
} from 'lucide-react'
import { offlineFetch, isQueuedResponse, isOnline, OfflineError } from '@/lib/offline-fetch'
import { OfflineNoData } from '@/components/common/OfflineNoData'
import { haptic } from '@/lib/haptic'
import { BulkRemindersModal } from '@/components/parties/BulkRemindersModal'
import { readError } from '@/lib/read-error'

export function Parties() {
  const {
    refreshKey, triggerRefresh, partiesViewMode, setPartiesViewMode,
    triggerNewEntry, triggerNewEntryView, setSelectedPartyId, setView, setPreviousView,
  } = useAppStore()
  // 🔒 AUDIT V25 FIX BUG-032 (Batch 6): Subscribe to bulk-reminders trigger.
  const triggerBulkReminders = useAppStore((s) => s.triggerBulkReminders)
  const { t } = useTranslation()
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState<'all' | 'customer' | 'supplier'>('all')
  const [dialogOpen, setDialogOpen] = useState(false)
  // 🔒 V22-13 (Batch C, Phase 7f): Bulk reminders modal state
  const [bulkRemindersOpen, setBulkRemindersOpen] = useState(false)

  const { data, isLoading, error } = useQuery({
    queryKey: ['parties', refreshKey],
    queryFn: async () => {
      const r = await offlineFetch('/api/parties')
      if (!r.ok) throw new Error(`HTTP ${r.status}`)
      return r.json()
    },
    retry: (count, err) => {
      if (err instanceof OfflineError) return false
      if (err instanceof TypeError) return false
      return count < 2
    },
  })

  const parties: any[] = data?.parties || []

  // Listen for global "New Entry" trigger from Header (only if fired on this view)
  const lastTriggerRef = useRef(0)
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
  const lastBulkTriggerRef = useRef(0)
  useEffect(() => {
    if (triggerBulkReminders > lastBulkTriggerRef.current) {
      lastBulkTriggerRef.current = triggerBulkReminders
      setBulkRemindersOpen(true)
    }
  }, [triggerBulkReminders])

  const filtered = parties.filter(p => {
    if (filter !== 'all' && p.type !== filter && p.type !== 'both') return false
    if (search) {
      const q = search.toLowerCase()
      return p.name?.toLowerCase().includes(q) ||
        p.phone?.toLowerCase().includes(q) ||
        p.gstin?.toLowerCase().includes(q)
    }
    return true
  })

  const totalReceivable = parties.filter(p => p.balance > 0).reduce((s, p) => s + p.balance, 0)
  const totalPayable = parties.filter(p => p.balance < 0).reduce((s, p) => s + Math.abs(p.balance), 0)
  const customers = parties.filter(p => p.type === 'customer' || p.type === 'both').length
  const suppliers = parties.filter(p => p.type === 'supplier' || p.type === 'both').length

  const handleViewParty = (id: string) => {
    setSelectedPartyId(id)
    setPreviousView('parties')
    setView('party-profile')
  }

  return (
    <div className="space-y-4">
      {/* Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Card className="shadow-card border-border/60">
          <CardContent className="p-4">
            <div className="flex items-center gap-2 mb-1">
              <Users className="w-4 h-4 text-amber-600 dark:text-amber-400" />
              <p className="text-2xs text-muted-foreground uppercase tracking-wide font-medium">{t('stat.total_parties')}</p>
            </div>
            <p className="text-xl font-bold">{parties.length}</p>
          </CardContent>
        </Card>
        <Card className="shadow-card border-border/60">
          <CardContent className="p-4">
            <div className="flex items-center gap-2 mb-1">
              <User className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
              <p className="text-2xs text-muted-foreground uppercase tracking-wide font-medium">{t('stat.customers')}</p>
            </div>
            <p className="text-xl font-bold">{customers}</p>
          </CardContent>
        </Card>
        <Card className="shadow-card border-border/60">
          <CardContent className="p-4">
            <div className="flex items-center gap-2 mb-1">
              <ArrowDownRight className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
              <p className="text-2xs text-muted-foreground uppercase tracking-wide font-medium">{t('dash.receivable')}</p>
            </div>
            <p className="text-xl font-bold text-emerald-600 dark:text-emerald-400">{formatINR(totalReceivable)}</p>
          </CardContent>
        </Card>
        <Card className="shadow-card border-border/60">
          <CardContent className="p-4">
            <div className="flex items-center gap-2 mb-1">
              <ArrowUpRight className="w-4 h-4 text-rose-600" />
              <p className="text-2xs text-muted-foreground uppercase tracking-wide font-medium">{t('dash.payable')}</p>
            </div>
            <p className="text-xl font-bold text-rose-600">{formatINR(totalPayable)}</p>
          </CardContent>
        </Card>
      </div>

      {/* Toolbar - removed duplicate Add Party button (it's in header now) */}
      <Card className="shadow-card border-border/60">
        <CardContent className="p-3 lg:p-4">
          <div className="flex flex-col sm:flex-row gap-3 items-start sm:items-center">
            <div className="relative flex-1 w-full">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                placeholder="Search by name, phone, GSTIN..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-9"
              />
            </div>
            <Select value={filter} onValueChange={(v) => setFilter(v as any)}>
              <SelectTrigger className="w-full sm:w-40">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t('parties.all_parties')}</SelectItem>
                <SelectItem value="customer">{t('stat.customers')}</SelectItem>
                <SelectItem value="supplier">Suppliers</SelectItem>
              </SelectContent>
            </Select>
            <ViewModeToggle mode={partiesViewMode} onChange={setPartiesViewMode} />
            {/* 🔒 V22-13 (Batch C, Phase 7f): Bulk WhatsApp Reminders button */}
            <Button
              variant="outline"
              size="sm"
              onClick={() => { haptic.click(); setBulkRemindersOpen(true) }}
              className="gap-1.5 border-emerald-300 text-emerald-700 hover:bg-emerald-50 dark:text-emerald-400 dark:border-emerald-800 dark:hover:bg-emerald-950"
            >
              <Send className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Bulk Reminders</span>
            </Button>
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
            {parties.length === 0 ? (
              <EmptyState
                icon={Users}
                title="No customers or suppliers yet"
                description="Add customers to track their outstanding dues, and suppliers to manage purchases. You can add them anytime from here or while creating a sale/purchase."
                action={{
                  label: 'Add Customer',
                  onClick: () => setDialogOpen(true),
                }}
              />
            ) : (
              <EmptyState
                icon={Users}
                title="No parties match your search"
                description="Try a different name, phone number, or clear the search to see all customers and suppliers."
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
                        <p className="text-xs text-muted-foreground uppercase">Balance</p>
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
                        <p className="text-xs text-muted-foreground uppercase">Txns</p>
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
                <tr className="text-left text-xs uppercase text-muted-foreground">
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
                      <ChevronRight className="w-4 h-4 text-muted-foreground group-hover:text-primary" />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      <PartyDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        onSuccess={() => triggerRefresh()}
      />
    </div>
  )
}

function PartyDialog({ open, onOpenChange, onSuccess }: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onSuccess?: () => void
}) {
  const [form, setForm] = useState({
    name: '', type: 'customer', phone: '', email: '', gstin: '',
    address: '', state: '', openingBalance: '',
  })
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (open) {
      setForm({ name: '', type: 'customer', phone: '', email: '', gstin: '', address: '', state: '', openingBalance: '' })
    }
  }, [open])

  const handleSave = async () => {
    if (!form.name.trim()) {
      sonnerToast.error('Name is required')
      return
    }
    setSaving(true)
    try {
      const r = await offlineFetch('/api/parties', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
        offline: { invalidate: ['/api/parties', '/api/dashboard'] },
      })
      if (!r.ok) throw new Error(await readError(r))
      if (isQueuedResponse(r)) {
        sonnerToast.success('Saved offline — will sync when online')
      } else {
        sonnerToast.success('Party added successfully')
      }
      haptic.success()
      onSuccess?.()
      onOpenChange(false)
    } catch {
      haptic.error()
      sonnerToast.error("Couldn\'t save the party")
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
            Add Party
          </DialogTitle>
        </DialogHeader>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 py-2">
          <div className="sm:col-span-2">
            <Label htmlFor="field-name">Name *</Label>
            <Input id="field-name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Customer or supplier name" autoFocus />
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
          <div>
            <Label htmlFor="field-phone">Phone</Label>
            <Input id="field-phone" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} placeholder="10-digit mobile" />
          </div>
          <div>
            <Label htmlFor="field-state">State</Label>
            <Input id="field-state" value={form.state} onChange={(e) => setForm({ ...form, state: e.target.value })} placeholder="e.g. Uttar Pradesh" />
          </div>
          <div className="sm:col-span-2">
            <Label htmlFor="field-gstin">GSTIN</Label>
            <Input id="field-gstin" value={form.gstin} onChange={(e) => setForm({ ...form, gstin: e.target.value })} placeholder="15-digit GST number" className="font-mono" />
          </div>
          <div className="sm:col-span-2">
            <Label htmlFor="field-address">Address</Label>
            <Input id="field-address" value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} placeholder="Full address" />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={handleSave} disabled={saving} className="bg-gradient-saffron">
            {saving ? 'Saving...' : 'Add Party'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
