'use client'

import { useQuery } from '@tanstack/react-query'
import { useState, useEffect } from 'react'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { Skeleton } from '@/components/ui/skeleton'
import { useAppStore } from '@/store/app-store'
import { useToast } from '@/hooks/use-toast'
import { toast as sonnerToast } from 'sonner'
import { formatINR, formatDate, cn, getInitials } from '@/lib/utils'
import { Plus, Search, Users, Trash2, Phone, User, ArrowDownRight, ArrowUpRight, Building2 } from 'lucide-react'

export function Parties() {
  const { refreshKey, triggerRefresh } = useAppStore()
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState<'all' | 'customer' | 'supplier'>('all')
  const [dialogOpen, setDialogOpen] = useState(false)

  const { data, isLoading } = useQuery({
    queryKey: ['parties', refreshKey],
    queryFn: async () => {
      const r = await fetch('/api/parties')
      return r.json()
    },
  })

  const parties: any[] = data?.parties || []

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

  const handleDelete = async (id: string) => {
    if (!confirm('Delete this party? Existing transactions will remain but lose party link.')) return
    // For demo: don't actually delete since we don't have an endpoint, but show toast
    sonnerToast.info('Party delete is not available in demo')
  }

  return (
    <div className="space-y-4">
      {/* Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Card className="shadow-card border-border/60">
          <CardContent className="p-4">
            <div className="flex items-center gap-2 mb-1">
              <Users className="w-4 h-4 text-amber-600" />
              <p className="text-[11px] text-muted-foreground uppercase tracking-wide font-medium">Total Parties</p>
            </div>
            <p className="text-xl font-bold">{parties.length}</p>
          </CardContent>
        </Card>
        <Card className="shadow-card border-border/60">
          <CardContent className="p-4">
            <div className="flex items-center gap-2 mb-1">
              <User className="w-4 h-4 text-emerald-600" />
              <p className="text-[11px] text-muted-foreground uppercase tracking-wide font-medium">Customers</p>
            </div>
            <p className="text-xl font-bold">{customers}</p>
          </CardContent>
        </Card>
        <Card className="shadow-card border-border/60">
          <CardContent className="p-4">
            <div className="flex items-center gap-2 mb-1">
              <ArrowDownRight className="w-4 h-4 text-emerald-600" />
              <p className="text-[11px] text-muted-foreground uppercase tracking-wide font-medium">Receivable</p>
            </div>
            <p className="text-xl font-bold text-emerald-600">{formatINR(totalReceivable)}</p>
          </CardContent>
        </Card>
        <Card className="shadow-card border-border/60">
          <CardContent className="p-4">
            <div className="flex items-center gap-2 mb-1">
              <ArrowUpRight className="w-4 h-4 text-rose-600" />
              <p className="text-[11px] text-muted-foreground uppercase tracking-wide font-medium">Payable</p>
            </div>
            <p className="text-xl font-bold text-rose-600">{formatINR(totalPayable)}</p>
          </CardContent>
        </Card>
      </div>

      {/* Toolbar */}
      <Card className="shadow-card border-border/60">
        <CardContent className="p-3 lg:p-4">
          <div className="flex flex-col sm:flex-row gap-3">
            <div className="relative flex-1">
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
                <SelectItem value="all">All Parties</SelectItem>
                <SelectItem value="customer">Customers</SelectItem>
                <SelectItem value="supplier">Suppliers</SelectItem>
              </SelectContent>
            </Select>
            <Button
              onClick={() => setDialogOpen(true)}
              className="bg-gradient-saffron gap-2 shadow-md"
            >
              <Plus className="w-4 h-4" /> Add Party
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Parties list */}
      {isLoading ? (
        <div className="space-y-2">
          {[...Array(5)].map((_, i) => <Skeleton key={i} className="h-20 w-full rounded-xl" />)}
        </div>
      ) : filtered.length === 0 ? (
        <Card className="shadow-card border-border/60">
          <CardContent className="py-16 text-center">
            <Users className="w-12 h-12 mx-auto text-muted-foreground/50 mb-3" />
            <p className="text-sm font-medium">No parties found</p>
            <p className="text-xs text-muted-foreground mt-1">
              {parties.length === 0 ? 'Add customers and suppliers to track dues' : 'Try a different search'}
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
          {filtered.map((p) => (
            <Card key={p.id} className="shadow-card border-border/60 hover:shadow-md transition">
              <CardContent className="p-4">
                <div className="flex items-start gap-3">
                  <div className={cn(
                    'w-11 h-11 rounded-full flex items-center justify-center flex-shrink-0 text-white font-semibold text-sm',
                    p.type === 'customer' ? 'bg-gradient-to-br from-emerald-500 to-teal-600' :
                    p.type === 'supplier' ? 'bg-gradient-to-br from-amber-500 to-orange-600' :
                    'bg-gradient-to-br from-violet-500 to-purple-600'
                  )}>
                    {getInitials(p.name)}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <h3 className="font-semibold text-sm truncate">{p.name}</h3>
                        <Badge variant="secondary" className="text-[10px] py-0 capitalize mt-0.5">{p.type}</Badge>
                      </div>
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
                      {p.state && (
                        <p className="text-[11px] text-muted-foreground">{p.state}</p>
                      )}
                    </div>

                    <div className="mt-3 pt-3 border-t border-border flex items-center justify-between">
                      <div>
                        <p className="text-[10px] text-muted-foreground uppercase">Balance</p>
                        <p className={cn(
                          'text-sm font-bold',
                          p.balance > 0 ? 'text-emerald-600' : p.balance < 0 ? 'text-rose-600' : 'text-muted-foreground'
                        )}>
                          {p.balance > 0 ? `+${formatINR(p.balance)}` : p.balance < 0 ? `-${formatINR(Math.abs(p.balance))}` : 'Settled'}
                        </p>
                      </div>
                      <div className="text-right">
                        <p className="text-[10px] text-muted-foreground uppercase">Transactions</p>
                        <p className="text-sm font-medium">{p.transactionCount}</p>
                      </div>
                    </div>

                    {p.balance !== 0 && (
                      <div className={cn(
                        'mt-2 text-[11px] px-2 py-1 rounded-md',
                        p.balance > 0 ? 'bg-emerald-50 text-emerald-700' : 'bg-rose-50 text-rose-700'
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
  const { toast } = useToast()
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
      toast({ title: 'Name is required', variant: 'destructive' })
      return
    }
    setSaving(true)
    try {
      const r = await fetch('/api/parties', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      })
      if (!r.ok) throw new Error('Failed')
      sonnerToast.success('Party added successfully')
      onSuccess?.()
      onOpenChange(false)
    } catch {
      toast({ title: 'Failed to save party', variant: 'destructive' })
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Users className="w-5 h-5 text-amber-600" />
            Add Party
          </DialogTitle>
        </DialogHeader>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 py-2">
          <div className="sm:col-span-2">
            <Label>Name *</Label>
            <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Customer or supplier name" />
          </div>
          <div>
            <Label>Type</Label>
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
            <Label>Opening Balance (₹)</Label>
            <Input
              type="number"
              value={form.openingBalance}
              onChange={(e) => setForm({ ...form, openingBalance: e.target.value })}
              placeholder="0 (positive = they owe you)"
            />
          </div>
          <div>
            <Label>Phone</Label>
            <Input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} placeholder="10-digit mobile" />
          </div>
          <div>
            <Label>State</Label>
            <Input value={form.state} onChange={(e) => setForm({ ...form, state: e.target.value })} placeholder="e.g. Uttar Pradesh" />
          </div>
          <div className="sm:col-span-2">
            <Label>GSTIN</Label>
            <Input value={form.gstin} onChange={(e) => setForm({ ...form, gstin: e.target.value })} placeholder="15-digit GST number" className="font-mono" />
          </div>
          <div className="sm:col-span-2">
            <Label>Address</Label>
            <Input value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} placeholder="Full address" />
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
