'use client'

import { useState, useRef, useEffect } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { Search, Plus, X, Phone, User, ChevronDown, Check } from 'lucide-react'
import { cn, getInitials } from '@/lib/utils'
import { toast as sonnerToast } from 'sonner'
import { offlineFetch, isQueuedResponse } from '@/lib/offline-fetch'
import { readError } from '@/lib/read-error'

type PartyType = 'customer' | 'supplier' | 'both'

export function PartySelect({
  value,
  onChange,
  partyType,
  label,
}: {
  value: string
  onChange: (id: string, party?: any) => void
  partyType: 'customer' | 'supplier'
  label?: string
}) {
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')
  const [addDialogOpen, setAddDialogOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  const { data: partiesData, refetch } = useQuery({
    queryKey: ['parties'],
    queryFn: async () => {
      const r = await offlineFetch('/api/parties')
      return r.json()
    },
  })

  const allParties: any[] = partiesData?.parties || []
  const filteredParties = allParties.filter(p =>
    (p.type === partyType || p.type === 'both') &&
    (!search ||
      p.name?.toLowerCase().includes(search.toLowerCase()) ||
      p.phone?.includes(search))
  )

  const selectedParty = allParties.find(p => p.id === value)

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  const handleSelect = (party: any) => {
    onChange(party.id, party)
    setOpen(false)
    setSearch('')
  }

  const handleClear = () => {
    onChange('')
    setSearch('')
  }

  const handlePartyAdded = (newParty: any) => {
    refetch()
    onChange(newParty.id, newParty)
    setAddDialogOpen(false)
    sonnerToast.success('Party added successfully')
  }

  return (
    <div className="relative" ref={ref}>
      {label && <Label htmlFor="field-label">{label}</Label>}

      {/* Selected state */}
      {selectedParty ? (
        <div className="flex items-center gap-2 p-2 border border-border rounded-lg bg-muted/30 mt-1">
          <Avatar className="w-8 h-8">
            <AvatarFallback className={cn(
              'text-white text-xs font-semibold',
              selectedParty.type === 'customer' ? 'bg-gradient-to-br from-emerald-500 to-teal-600' :
              selectedParty.type === 'supplier' ? 'bg-gradient-to-br from-amber-500 to-orange-600' :
              'bg-gradient-to-br from-violet-500 to-purple-600'
            )}>
              {getInitials(selectedParty.name)}
            </AvatarFallback>
          </Avatar>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium truncate">{selectedParty.name}</p>
            <div className="flex items-center gap-2 text-2xs text-muted-foreground">
              {selectedParty.phone && <span>{selectedParty.phone}</span>}
              {selectedParty.balance !== 0 && (
                <Badge variant="outline" className={cn('text-3xs py-0', selectedParty.balance > 0 ? 'text-emerald-600 dark:text-emerald-400 border-emerald-300' : 'text-rose-600 border-rose-300')}>
                  {selectedParty.balance > 0 ? `Owes ₹${selectedParty.balance}` : `You owe ₹${Math.abs(selectedParty.balance)}`}
                </Badge>
              )}
            </div>
          </div>
          <Button
            variant="ghost"
            size="sm"
            className="h-7 w-7 p-0"
            onClick={handleClear}
          >
            <X className="w-3.5 h-3.5" />
          </Button>
        </div>
      ) : (
        /* Unselected - search input */
        <div className="relative mt-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            placeholder={`Search ${partyType} by name or phone...`}
            value={search}
            onChange={(e) => { setSearch(e.target.value); setOpen(true) }}
            onFocus={() => setOpen(true)}
            className="pl-9 pr-20"
          />
          <div className="absolute right-1 top-1/2 -translate-y-1/2 flex gap-0.5">
            <Button
              variant="ghost"
              size="sm"
              className="h-8 w-8 p-0"
              onClick={() => setAddDialogOpen(true)}
              title={`Add new ${partyType}`}
            >
              <Plus className="w-4 h-4 text-primary" />
            </Button>
          </div>
        </div>
      )}

      {/* Dropdown results */}
      {open && !selectedParty && (
        <div className="absolute top-full mt-1 left-0 right-0 z-50 bg-popover border border-border rounded-lg shadow-lg max-h-64 overflow-y-auto">
          {filteredParties.length === 0 ? (
            <div className="p-4 text-center">
              <p className="text-sm text-muted-foreground mb-2">
                {search ? `No ${partyType} found matching "${search}"` : `No ${partyType}s yet`}
              </p>
              <Button
                size="sm"
                className="bg-gradient-saffron gap-1"
                onClick={() => setAddDialogOpen(true)}
              >
                <Plus className="w-3.5 h-3.5" /> Add New {partyType === 'customer' ? 'Customer' : 'Supplier'}
              </Button>
            </div>
          ) : (
            <>
              {search && (
                <div className="px-3 py-1.5 text-3xs text-muted-foreground uppercase font-medium border-b border-border">
                  {filteredParties.length} match{filteredParties.length !== 1 ? 'es' : ''}
                </div>
              )}
              {filteredParties.slice(0, 20).map(p => (
                <button
                  key={p.id}
                  onClick={() => handleSelect(p)}
                  className="w-full flex items-center gap-2 p-2 hover:bg-muted transition text-left"
                >
                  <Avatar className="w-8 h-8 flex-shrink-0">
                    <AvatarFallback className={cn(
                      'text-white text-xs font-semibold',
                      p.type === 'customer' ? 'bg-gradient-to-br from-emerald-500 to-teal-600' :
                      p.type === 'supplier' ? 'bg-gradient-to-br from-amber-500 to-orange-600' :
                      'bg-gradient-to-br from-violet-500 to-purple-600'
                    )}>
                      {getInitials(p.name)}
                    </AvatarFallback>
                  </Avatar>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">{p.name}</p>
                    <div className="flex items-center gap-2 text-2xs text-muted-foreground">
                      {p.phone && <span className="flex items-center gap-0.5"><Phone className="w-2.5 h-2.5" />{p.phone}</span>}
                      {p.state && <span>{p.state}</span>}
                    </div>
                  </div>
                  {p.balance !== 0 && (
                    <Badge variant="outline" className={cn('text-3xs py-0', p.balance > 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600')}>
                      {p.balance > 0 ? `+₹${p.balance}` : `-₹${Math.abs(p.balance)}`}
                    </Badge>
                  )}
                </button>
              ))}
              <div className="p-2 border-t border-border">
                <Button
                  variant="outline"
                  size="sm"
                  className="w-full gap-1"
                  onClick={() => setAddDialogOpen(true)}
                >
                  <Plus className="w-3.5 h-3.5" /> Add New {partyType === 'customer' ? 'Customer' : 'Supplier'}
                </Button>
              </div>
            </>
          )}
        </div>
      )}

      <AddPartyDialog
        open={addDialogOpen}
        onOpenChange={setAddDialogOpen}
        defaultType={partyType}
        onSuccess={handlePartyAdded}
      />
    </div>
  )
}

function AddPartyDialog({ open, onOpenChange, defaultType, onSuccess }: {
  open: boolean
  onOpenChange: (open: boolean) => void
  defaultType: 'customer' | 'supplier'
  onSuccess: (party: any) => void
}) {
  const [form, setForm] = useState({
    name: '', type: defaultType, phone: '', email: '', gstin: '',
    address: '', state: '', openingBalance: '',
  })
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (open) {
      setForm({
        name: '', type: defaultType, phone: '', email: '', gstin: '',
        address: '', state: '', openingBalance: '',
      })
    }
  }, [open, defaultType])

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
        onOpenChange(false)
        return
      }
      const data = await r.json()
      onSuccess(data.party)
    } catch (e: any) {
      sonnerToast.error(e?.message || "Couldn\'t add the party")
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Plus className="w-5 h-5 text-primary" />
            Add New {defaultType === 'customer' ? 'Customer' : 'Supplier'}
          </DialogTitle>
        </DialogHeader>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 py-2">
          <div className="sm:col-span-2">
            <Label htmlFor="field-name">Name *</Label>
            <Input id="field-name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder={`${defaultType === 'customer' ? 'Customer' : 'Supplier'} name`} autoFocus />
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
            <Input id="field-gstin" value={form.gstin} onChange={(e) => setForm({ ...form, gstin: e.target.value })} placeholder="15-digit GST number (optional)" className="font-mono" />
          </div>
          <div className="sm:col-span-2">
            <Label htmlFor="field-address">Address</Label>
            <Input id="field-address" value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} placeholder="Full address (optional)" />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={handleSave} disabled={saving} className="bg-gradient-saffron">
            {saving ? 'Adding...' : `Add ${defaultType === 'customer' ? 'Customer' : 'Supplier'}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
