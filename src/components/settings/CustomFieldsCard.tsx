'use client'

/**
 * Where a shop invents its own fields.
 *
 * 📄 Phase 5 part 2 of docs/INVOICE-ENGINE-PLAN.md.
 *
 * ── WHY THREE LISTS AND NOT ONE ───────────────────────────────────────
 *
 * A field on the BILL (PO number) and a column on every LINE (batch, expiry)
 * are different things that a shopkeeper will otherwise mix up, and the
 * mistake is expensive: a batch number added as a bill field appears once for
 * a bill with nine medicines on it, which is not the record the Drugs and
 * Cosmetics Act asks for. So each list says plainly where its fields land,
 * with an example from a real trade.
 *
 * myBillBook offers "Add Custom Field/Column" on half a dozen screens with no
 * such distinction, which is why their own help pages are full of people
 * asking why their column only printed once.
 *
 * ── WHAT THIS SCREEN REFUSES ──────────────────────────────────────────
 *
 * Names the law already puts on every invoice — GSTIN, HSN, Total. The server
 * decides that (see lib/custom-fields), and the error comes back in the
 * shopkeeper's own words rather than being silently dropped.
 */

import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Plus, Trash2, FileText, Package, Users } from 'lucide-react'
import { toast as sonnerToast } from 'sonner'
import { offlineFetch } from '@/lib/offline-fetch'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { InfoHint } from '@/components/common/InfoHint'
import { cn } from '@/lib/utils'
import {
  MAX_FIELDS_PER_ENTITY,
  type CustomFieldDef,
  type CustomFieldEntity,
  type CustomFieldType,
} from '@/lib/custom-fields'

/**
 * The three places a field can live, in the order a shopkeeper meets them.
 *
 * Each carries a REAL example rather than "e.g. Custom Field 1". A chemist
 * reading "Batch No., Expiry" knows instantly that this is the row they need;
 * an abstract label would leave them guessing.
 */
const GROUPS: {
  entity: CustomFieldEntity
  title: string
  where: string
  eg: string
  icon: typeof FileText
  tint: string
  tintBg: string
}[] = [
  {
    entity: 'item',
    title: 'On every item',
    where: 'Appears under each line of the bill.',
    eg: 'Batch No., Expiry, MRP',
    icon: Package,
    tint: 'text-emerald-600 dark:text-emerald-400',
    tintBg: 'bg-emerald-100 dark:bg-emerald-950',
  },
  {
    entity: 'invoice',
    title: 'On the whole bill',
    where: 'Appears once, near the bill number.',
    eg: 'PO Number, Vehicle Number',
    icon: FileText,
    tint: 'text-blue-600 dark:text-blue-400',
    tintBg: 'bg-blue-100 dark:bg-blue-950',
  },
  {
    entity: 'party',
    title: 'On a customer',
    where: 'Saved with the customer, not the bill.',
    eg: 'FSSAI Licence, Route',
    icon: Users,
    tint: 'text-violet-600 dark:text-violet-400',
    tintBg: 'bg-violet-100 dark:bg-violet-950',
  },
]

const TYPES: { id: CustomFieldType; label: string }[] = [
  { id: 'text', label: 'Text' },
  { id: 'number', label: 'Number' },
  { id: 'date', label: 'Date' },
  { id: 'money', label: 'Money' },
]

export function CustomFieldsCard() {
  const queryClient = useQueryClient()
  const [busy, setBusy] = useState(false)
  const [openFor, setOpenFor] = useState<CustomFieldEntity | null>(null)
  const [label, setLabel] = useState('')
  const [type, setType] = useState<CustomFieldType>('text')
  const [required, setRequired] = useState(false)
  const [showOnInvoice, setShowOnInvoice] = useState(true)

  const { data } = useQuery({
    queryKey: ['custom-fields'],
    queryFn: async () => {
      const r = await offlineFetch('/api/custom-fields')
      if (!r.ok) throw new Error('Could not load your fields')
      return r.json()
    },
  })
  const fields: CustomFieldDef[] = data?.fields ?? []

  const refresh = () => queryClient.invalidateQueries({ queryKey: ['custom-fields'] })

  const reset = () => {
    setOpenFor(null); setLabel(''); setType('text'); setRequired(false); setShowOnInvoice(true)
  }

  const add = async (entity: CustomFieldEntity) => {
    setBusy(true)
    try {
      const r = await fetch('/api/custom-fields', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ entity, label, type, required, showOnInvoice }),
      })
      const j = await r.json()
      // The server's message, verbatim — it explains WHY a reserved name was
      // refused, and rewording it here would lose the reason.
      if (!r.ok) throw new Error(j?.error || 'Could not add the field')
      sonnerToast.success(`"${label}" added`)
      reset()
      refresh()
    } catch (e: unknown) {
      sonnerToast.error(e instanceof Error ? e.message : 'Could not add the field')
    } finally {
      setBusy(false)
    }
  }

  const patch = async (id: string, body: Record<string, unknown>) => {
    try {
      const r = await fetch('/api/custom-fields', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, ...body }),
      })
      if (!r.ok) throw new Error((await r.json())?.error || 'Could not save that')
      refresh()
    } catch (e: unknown) {
      sonnerToast.error(e instanceof Error ? e.message : 'Could not save that')
    }
  }

  const remove = async (f: CustomFieldDef) => {
    try {
      const r = await fetch(`/api/custom-fields?id=${encodeURIComponent(f.id)}`, { method: 'DELETE' })
      if (!r.ok) throw new Error('Could not remove it')
      /*
       * "Removed from new bills" and not "Deleted", because that is what
       * happened. Bills already issued keep the value — a chemist's old bill
       * must still show its batch number — and telling them it was deleted
       * would be a lie about their own records.
       */
      sonnerToast.success(`"${f.label}" removed from new bills`)
      refresh()
    } catch (e: unknown) {
      sonnerToast.error(e instanceof Error ? e.message : 'Could not remove it')
    }
  }

  return (
    <Card className="shadow-card border-border/60">
      <CardContent className="space-y-5 pt-5">
        {GROUPS.map(g => {
          const mine = fields.filter(f => f.entity === g.entity)
          const Icon = g.icon
          const full = mine.length >= MAX_FIELDS_PER_ENTITY
          return (
            <div key={g.entity}>
              <div className="flex items-center gap-2.5 mb-2">
                <div className={cn('w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0', g.tintBg)}>
                  <Icon className={cn('w-4 h-4', g.tint)} />
                </div>
                <div className="min-w-0">
                  <p className="text-sm font-medium">{g.title}</p>
                  <p className="text-2xs text-muted-foreground">{g.where} e.g. {g.eg}</p>
                </div>
              </div>

              {mine.length > 0 && (
                <div className="space-y-1.5 mb-2">
                  {mine.map(f => (
                    <div key={f.id}
                      className="flex items-center gap-2 rounded-lg bg-muted/30 border border-border/60 p-2.5">
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium truncate">{f.label}</p>
                        <p className="text-2xs text-muted-foreground">
                          {TYPES.find(t => t.id === f.type)?.label}
                          {f.required && ' · must be filled'}
                          {!f.showOnInvoice && ' · not printed'}
                        </p>
                      </div>
                      <Button variant="ghost" size="sm" className="text-rose-600 h-8 w-8 p-0"
                        onClick={() => remove(f)} aria-label={`Remove ${f.label}`}>
                        <Trash2 className="w-3.5 h-3.5" />
                      </Button>
                    </div>
                  ))}
                </div>
              )}

              {openFor === g.entity ? (
                <div className="rounded-lg border border-border/60 p-3 space-y-3">
                  <div>
                    <Label htmlFor={`cf-label-${g.entity}`}>Name</Label>
                    <Input id={`cf-label-${g.entity}`} value={label} autoFocus
                      onChange={e => setLabel(e.target.value)}
                      placeholder={g.eg.split(',')[0]} className="mt-1" />
                  </div>
                  <div>
                    <Label>Type</Label>
                    <div className="flex gap-1.5 mt-1">
                      {TYPES.map(t => (
                        <button key={t.id} type="button"
                          onClick={() => setType(t.id)}
                          className={cn(
                            'flex-1 rounded-lg border px-2 py-1.5 text-xs font-medium transition',
                            type === t.id
                              ? 'border-primary bg-primary/10 text-primary'
                              : 'border-border/60 hover:bg-muted/50',
                          )}>
                          {t.label}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div className="flex items-center justify-between">
                    <p className="text-sm font-medium inline-flex items-center gap-1.5">
                      Must be filled
                      <InfoHint label="Must be filled"
                        text="The bill cannot be saved until this has a value. Worth turning on for something you are legally required to record — a chemist's batch number, for instance." />
                    </p>
                    <Switch checked={required} onCheckedChange={setRequired} />
                  </div>
                  <div className="flex items-center justify-between">
                    <p className="text-sm font-medium inline-flex items-center gap-1.5">
                      Print on the bill
                      <InfoHint label="Print on the bill"
                        text="Off keeps it for your records only — useful for something like your own cost price, which you record but your customer should never see." />
                    </p>
                    <Switch checked={showOnInvoice} onCheckedChange={setShowOnInvoice} />
                  </div>
                  <div className="flex gap-2">
                    <Button size="sm" className="flex-1" disabled={busy || !label.trim()}
                      onClick={() => add(g.entity)}>
                      {busy ? 'Adding…' : 'Add'}
                    </Button>
                    <Button variant="ghost" size="sm" onClick={reset} disabled={busy}>Cancel</Button>
                  </div>
                </div>
              ) : (
                <Button variant="outline" size="sm" className="w-full gap-1.5"
                  disabled={full}
                  onClick={() => { reset(); setOpenFor(g.entity) }}>
                  <Plus className="w-3.5 h-3.5" />
                  {full ? `${MAX_FIELDS_PER_ENTITY} is the limit here` : 'Add a field'}
                </Button>
              )}
            </div>
          )
        })}
      </CardContent>
    </Card>
  )
}
