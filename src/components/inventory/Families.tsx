'use client'

/**
 * Phase 7b (#293) — brands with sizes on the Items screen.
 *
 *  - FamilyRow: one row per brand, its sizes as buttons (size · stock). A tap
 *    on a size opens that size; a tap on the brand opens the brand sheet.
 *  - BrandSuggestions: "Sizes of one brand · 12 found" → review, then Yes per
 *    brand or Group all. Nothing is grouped without that tap.
 *  - FamilySheet: rename, add a size, take a size out, ungroup.
 *
 * Every size keeps its own price, MRP, barcode and stock; grouping only
 * changes how lists show them (lib/product-families-server.ts).
 */
import { useState, useMemo, useEffect } from 'react'
import { useQuery } from '@tanstack/react-query'
import { toast as sonnerToast } from 'sonner'
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from '@/components/ui/sheet'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Notice } from '@/components/ui/notice'
import { useConfirmDialog } from '@/hooks/use-confirm-dialog'
import { offlineFetch } from '@/lib/offline-fetch'
import { formatINR, cn } from '@/lib/utils'
import { isService } from '@/lib/inventory-tracking'
import type { FamilyEntry, ItemRow } from '@/lib/items-list'
import type { FamilySuggestion } from '@/lib/product-sizes'
import { Plus, X, Layers } from 'lucide-react'

const sizeOf = (m: ItemRow) => (m.sizeLabel as string | null | undefined) || m.name

function stockTone(m: ItemRow): { text: string; cls: string } {
  if (isService(m)) return { text: '', cls: 'text-muted-foreground' }
  if (m.currentStock <= 0) return { text: 'out', cls: 'text-bad' }
  if (m.isLowStock) return { text: `${m.currentStock} left`, cls: 'text-check' }
  return { text: String(m.currentStock), cls: 'text-muted-foreground' }
}

/** One brand, one row: its sizes as buttons, smallest first. */
export function FamilyRow({ family, onOpenFamily, onEditSize }: {
  family: FamilyEntry
  onOpenFamily: () => void
  onEditSize: (m: ItemRow) => void
}) {
  const prices = family.members.map((m) => Number(m.salePrice) || 0).filter((v) => v > 0)
  const sold = family.members.reduce((s, m) => s + (m.qtyNow || 0), 0)
  const unit = (family.members[0]?.unit as string | undefined) || 'pcs'
  // The price range sits beside the name (its own line made every brand ~20 px taller on a phone).
  const range = !prices.length ? '' : Math.min(...prices) === Math.max(...prices)
    ? formatINR(prices[0]) : `${formatINR(Math.min(...prices))} – ${formatINR(Math.max(...prices))}`
  return (
    <div className="rounded-xl bg-card border border-border/60 shadow-card">
      <button type="button" onClick={onOpenFamily} className="w-full min-h-12 px-3 pt-2.5 pb-1 flex items-center gap-3 text-left rounded-t-xl hover:bg-muted/40">
        <span className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0 font-bold text-sm bg-primary/10 text-primary" aria-hidden>
          {family.name.charAt(0).toUpperCase()}
        </span>
        <span className="min-w-0 flex-1 flex items-baseline justify-between gap-2">
          <span className="font-semibold text-sm truncate">{family.name}</span>
          <span className="text-xs text-muted-foreground shrink-0 tabular-nums">{range}</span>
        </span>
      </button>
      <div className={cn('pl-16 pr-3 flex flex-wrap gap-2', sold > 0 ? 'pb-1' : 'pb-2.5')} role="group" aria-label={`${family.name}, ${family.members.length} sizes`}>
        {family.members.map((m) => {
          const s = stockTone(m)
          return (
            <button
              key={m.id}
              type="button"
              onClick={() => onEditSize(m)}
              aria-label={`${m.name}${s.text ? `, ${s.text}` : ''}`}
              className="hit-48 relative min-h-10 rounded-lg border border-border bg-background px-2.5 text-xs font-semibold tabular-nums hover:bg-muted"
            >
              {sizeOf(m)}{s.text && <span className={cn('font-medium', s.cls)}> · {s.text}</span>}
            </button>
          )
        })}
      </div>
      {sold > 0 && <p className="pl-16 pr-3 pb-2.5 pt-1 text-xs text-muted-foreground tabular-nums">Sold {sold} {unit} this month</p>}
    </div>
  )
}

const DISMISSED_KEY = 'ekbook-brand-suggestions-not-now'
const readDismissed = (): Set<string> => {
  try { return new Set(JSON.parse(localStorage.getItem(DISMISSED_KEY) || '[]')) } catch { return new Set() }
}
const keyOf = (s: FamilySuggestion) => s.members.map((m) => m.id).sort().join(',')
const SHOWN = 60

/** EkBook's suggestions: found from item names, grouped only when the shop says yes. */
export function BrandSuggestions({ onChanged }: { onChanged: () => void }) {
  const { data, refetch } = useQuery({
    queryKey: ['product-families'],
    queryFn: async () => {
      const r = await offlineFetch('/api/products/families')
      if (!r.ok) throw new Error(`HTTP ${r.status}`)
      return r.json() as Promise<{ suggestions: FamilySuggestion[] }>
    },
    staleTime: 60_000,
  })
  const [dismissed, setDismissed] = useState<Set<string>>(() => new Set())
  useEffect(() => { setDismissed(readDismissed()) }, [])
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [names, setNames] = useState<Record<string, string>>({})
  const [shown, setShown] = useState(SHOWN)
  const list = useMemo(() => (data?.suggestions ?? []).filter((s) => !dismissed.has(keyOf(s))), [data, dismissed])
  if (!list.length) return null

  const notNow = (s: FamilySuggestion) => {
    const next = new Set(dismissed); next.add(keyOf(s)); setDismissed(next)
    try { localStorage.setItem(DISMISSED_KEY, JSON.stringify([...next])) } catch { /* the suggestion just comes back next time */ }
  }
  const group = async (groups: FamilySuggestion[]) => {
    setBusy(true)
    try {
      const r = await offlineFetch('/api/products/families', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          groups: groups.map((s) => ({ name: (names[keyOf(s)] ?? s.name).trim() || s.name, members: s.members.map((m) => ({ productId: m.id, sizeLabel: m.sizeLabel })) })),
        }),
      })
      const j = await r.json().catch(() => ({}))
      if (!r.ok) { sonnerToast.error(j.error || 'Could not group these items'); return }
      sonnerToast.success(groups.length === 1 ? `Grouped as ${j.families?.[0]?.name ?? groups[0].name}` : `${groups.length} brands grouped`)
      await refetch()
      onChanged()
      if (groups.length > 1) setOpen(false)
    } finally { setBusy(false) }
  }

  const first = list[0]
  return (
    <>
      <Notice
        level="note"
        icon={Layers}
        title={`Sizes of one brand · ${list.length} found`}
        info="Items whose names differ only by size (₹10, 500 g, 1 kg) can show as one row with size buttons. Each size keeps its own price, MRP, barcode and stock. Nothing is grouped until you tap."
        action={<Button size="sm" onClick={() => setOpen(true)}>Review</Button>}
      >
        {first.name}: {first.members.map((m) => m.sizeLabel).join(', ')}
      </Notice>
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent side="bottom" className="rounded-t-3xl max-h-[88vh] overflow-y-auto pb-[calc(1rem+var(--safe-bottom))] lg:mx-auto lg:max-w-2xl">
          <SheetHeader className="pb-2">
            <SheetTitle>Group sizes into brands</SheetTitle>
            <SheetDescription className="sr-only">Each suggestion groups items that differ only by size.</SheetDescription>
          </SheetHeader>
          <div className="px-4 space-y-3">
            <Button className="w-full h-12" disabled={busy} onClick={() => group(list)}>Group all {list.length}</Button>
            <ul className="divide-y divide-border rounded-xl border border-border">
              {list.slice(0, shown).map((s) => (
                <li key={keyOf(s)} className="p-3 space-y-2">
                  <Input
                    aria-label="Brand name"
                    value={names[keyOf(s)] ?? s.name}
                    onChange={(e) => setNames((n) => ({ ...n, [keyOf(s)]: e.target.value }))}
                  />
                  <div className="flex flex-wrap gap-1.5">
                    {s.members.map((m) => <span key={m.id} className="rounded-md bg-muted px-2 py-1 text-xs font-semibold tabular-nums">{m.sizeLabel}</span>)}
                  </div>
                  <div className="flex gap-2">
                    <Button size="sm" className="flex-1" disabled={busy} onClick={() => group([s])}>Group</Button>
                    <Button size="sm" variant="outline" className="flex-1" disabled={busy} onClick={() => notNow(s)}>Not now</Button>
                  </div>
                </li>
              ))}
            </ul>
            {list.length > shown && (
              <button type="button" onClick={() => setShown((v) => v + SHOWN)} className="w-full min-h-12 rounded-xl border border-border text-sm font-semibold hover:bg-muted">
                Showing {shown} of {list.length} · show more
              </button>
            )}
          </div>
        </SheetContent>
      </Sheet>
    </>
  )
}

/** One brand: rename it, add a size, take a size out, or ungroup it. */
export function FamilySheet({ family, onClose, onChanged, onAddSize, onEditSize }: {
  family: FamilyEntry | null
  onClose: () => void
  onChanged: () => void
  onAddSize: (family: FamilyEntry) => void
  onEditSize: (m: ItemRow) => void
}) {
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const { confirmDialog, dialog } = useConfirmDialog()
  useEffect(() => { if (family) setName(family.name) }, [family])

  const call = async (method: 'PATCH' | 'DELETE', body?: object) => {
    if (!family) return false
    setBusy(true)
    try {
      const r = await offlineFetch(`/api/products/families/${family.id}`, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: body ? JSON.stringify(body) : undefined,
      })
      const j = await r.json().catch(() => ({}))
      if (!r.ok) { sonnerToast.error(j.error || 'Could not change this brand'); return false }
      onChanged()
      return true
    } finally { setBusy(false) }
  }
  const rename = async () => { if (await call('PATCH', { name })) sonnerToast.success(`Renamed to ${name.trim()}`) }
  const takeOut = async (m: ItemRow) => { if (await call('PATCH', { remove: [m.id] })) { sonnerToast.success(`${m.name} is on its own again`); onClose() } }
  const ungroup = async () => {
    if (!family) return
    const ok = await confirmDialog(`Its ${family.members.length} sizes stay, each as its own item. Prices, stock and bills do not change.`, { title: `Ungroup ${family.name}?`, confirmLabel: 'Ungroup', destructive: false })
    if (ok && await call('DELETE')) { sonnerToast.success(`${family.name} ungrouped`); onClose() }
  }

  return (
    <>
      <Sheet open={!!family} onOpenChange={(o) => { if (!o) onClose() }}>
        <SheetContent side="bottom" className="rounded-t-3xl max-h-[88vh] overflow-y-auto pb-[calc(1rem+var(--safe-bottom))] lg:mx-auto lg:max-w-lg">
          <SheetHeader className="pb-2">
            <SheetTitle>{family?.name}</SheetTitle>
            <SheetDescription>{family?.members.length} sizes</SheetDescription>
          </SheetHeader>
          {family && (
            <div className="px-4 space-y-4">
              <div className="flex gap-2">
                <Input aria-label="Brand name" value={name} onChange={(e) => setName(e.target.value)} className="flex-1 min-w-0" />
                <Button variant="outline" className="h-12" disabled={busy || !name.trim() || name.trim() === family.name} onClick={rename}>Rename</Button>
              </div>
              <ul className="divide-y divide-border rounded-xl border border-border">
                {family.members.map((m) => {
                  const s = stockTone(m)
                  return (
                    <li key={m.id} className="flex items-center">
                      <button type="button" onClick={() => onEditSize(m)} className="flex-1 min-w-0 min-h-12 px-3 py-2 flex items-center justify-between gap-2 text-left hover:bg-muted/40">
                        <span className="min-w-0">
                          <span className="block text-sm font-semibold">{sizeOf(m)}</span>
                          <span className="block text-xs text-muted-foreground truncate">{m.name}</span>
                        </span>
                        <span className="shrink-0 text-right text-sm tabular-nums">
                          {formatINR(Number(m.salePrice) || 0)}
                          {s.text && <span className={cn('block text-xs', s.cls)}>{s.text}</span>}
                        </span>
                      </button>
                      <button type="button" onClick={() => takeOut(m)} disabled={busy} aria-label={`Take ${m.name} out of ${family.name}`} className="w-12 h-12 shrink-0 inline-flex items-center justify-center text-muted-foreground hover:text-bad">
                        <X className="w-4 h-4" aria-hidden />
                      </button>
                    </li>
                  )
                })}
              </ul>
              <Button className="w-full h-12 gap-2" onClick={() => onAddSize(family)}><Plus className="w-4 h-4" aria-hidden /> Add a size</Button>
              <Button variant="outline" className="w-full h-12" disabled={busy} onClick={ungroup}>Ungroup</Button>
            </div>
          )}
        </SheetContent>
      </Sheet>
      {dialog}
    </>
  )
}
