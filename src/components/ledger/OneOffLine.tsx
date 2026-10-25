'use client'

/**
 * Phase 7c step 2e (change C11, "Not in list") — an item the shop does not
 * keep in its list, billed once: a carry bag, a repair, a thing bought in for
 * one customer. A name, a price, how many — not saved to the items.
 *
 * Only for a shop that charges no GST (not registered, or composition). A tax
 * invoice line needs its HSN and rate for the GSTR-1 HSN summary, so a GST shop
 * adds the item properly instead ("Add it as a new item" asks for both) —
 * never a line the return cannot place.
 */
import { useEffect, useState } from 'react'
import { Minus, Plus } from 'lucide-react'
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from '@/components/ui/sheet'
import { Input } from '@/components/ui/input'
import { NumberField } from '@/components/ui/number-field'
import { Button } from '@/components/ui/button'
import { formatINR } from '@/lib/utils'

export function OneOffLine({ open, initialName, onClose, onAdd }: {
  open: boolean
  initialName: string
  onClose: () => void
  onAdd: (line: { name: string; price: number; qty: number }) => void
}) {
  const [name, setName] = useState(initialName)
  const [price, setPrice] = useState('')
  const [qty, setQty] = useState(1)
  useEffect(() => { if (open) { setName(initialName); setPrice(''); setQty(1) } }, [open, initialName])
  const p = Number(price) || 0
  const ready = name.trim().length > 0 && p > 0
  return (
    <Sheet open={open} onOpenChange={(o) => { if (!o) onClose() }}>
      <SheetContent side="bottom" className="rounded-t-3xl pb-[calc(1rem+var(--safe-bottom))] lg:mx-auto lg:max-w-lg">
        <SheetHeader className="pb-1">
          <SheetTitle>Bill it once</SheetTitle>
          <SheetDescription>Not saved to your items.</SheetDescription>
        </SheetHeader>
        <div className="px-4 space-y-3">
          <Input aria-label="Item name" placeholder="Name, e.g. carry bag" value={name} onChange={(e) => setName(e.target.value)} autoComplete="off" />
          <NumberField id="field-oneoff-price" aria-label="Price" placeholder="₹ price" value={price} onValueChange={setPrice} min={0} decimals={2} />
          <div className="flex items-center justify-between gap-3">
            <span className="text-sm text-muted-foreground">How many</span>
            <div className="flex items-center rounded-lg border border-border overflow-hidden">
              <button type="button" onClick={() => setQty((n) => Math.max(1, n - 1))} aria-label="One less" className="w-12 h-12 inline-flex items-center justify-center hover:bg-muted"><Minus className="w-4 h-4" aria-hidden /></button>
              <span className="min-w-10 text-center font-bold tabular-nums">{qty}</span>
              <button type="button" onClick={() => setQty((n) => n + 1)} aria-label="One more" className="w-12 h-12 inline-flex items-center justify-center hover:bg-muted"><Plus className="w-4 h-4" aria-hidden /></button>
            </div>
          </div>
          <Button type="button" className="w-full h-12" disabled={!ready} onClick={() => { onAdd({ name: name.trim(), price: p, qty }); onClose() }}>
            {ready ? `Add ${qty > 1 ? `${qty} × ` : ''}${formatINR(p)}${qty > 1 ? ` = ${formatINR(p * qty)}` : ''}` : name.trim() ? 'Type the price' : 'Type the name'}
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  )
}
