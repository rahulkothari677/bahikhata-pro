'use client'

/**
 * Phase 7c step 2b (change C11) — the keypad bar: any amount, without leaving
 * the list. Rahul, 23–24 Oct: "if a customer buys in loose it will be so time
 * taking using full screen for everything"; "a pencil with each product to sell
 * it in loose or the way the user wants"; "both the options, button and keypad
 * and full screen".
 *
 * It docks above the total bar, under the thumb; the list stays above it. A
 * loose good takes an Amount (400 = 400 g, 1.25 kg, 23 pieces), a ₹ amount
 * ("₹50 of sugar", the bill's own price rule) or a new Price. A packed product
 * takes any count of a size, or a Price — never above its printed MRP. What is
 * typed goes on the bill as it is typed (a price only on "Set price", so ₹2 and
 * ₹25 never land on the way to ₹250). "Big number pad" (⚙) opens the same pad
 * full screen.
 */
import { useState, useEffect, type ReactNode } from 'react'
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from '@/components/ui/sheet'
import { Delete } from 'lucide-react'
import { cn, formatINR } from '@/lib/utils'
import { isCountUnit, normalizeUnitName } from '@/lib/units'
import { typedQuantity, shownUnit, looseLabel, barQuickPicks, unusualAmount, smallUnitOf, nextLabel, type TypedUnit, type NextQty, type NextUnit } from '@/lib/loose-entry'

export interface KeypadRow {
  key: string
  title: string
  /** A loose good (one item sold by weight or count); else a product with sizes. */
  loose: boolean
  items: any[]
}

type Tab = 'amount' | 'rupee' | 'price' | 'packs'
const TAB_NAME: Record<Tab, string> = { amount: 'Amount', rupee: '₹ amount', price: 'Price', packs: 'Packs' }

export interface KeypadBarProps {
  row: KeypadRow
  qtyOf: (id: string) => number
  /** The price on the bill line, or the item's own price before it is on the bill. */
  priceOf: (p: any) => number
  /** What the customer pays per unit at a price (GST on top of a before-GST price). */
  paysAt: (p: any, price: number) => number
  setQty: (p: any, q: number) => void
  setPrice: (p: any, price: number) => void
  /** "₹50 of sugar": the quantity those rupees buy, or null. */
  qtyForRupees: (p: any, rupees: number) => number | null
  /** Why a price is not allowed (above the printed MRP), or null. */
  priceProblem: (p: any, price: number) => string | null
  allowPrice: boolean
  gramsRule: boolean
  checkAmounts: boolean
  big: boolean
  onClose: () => void
}

export function KeypadBar(props: KeypadBarProps) {
  const { row, big, onClose } = props
  if (!big) return <Pad {...props} />
  return (
    <Sheet open onOpenChange={(o) => { if (!o) onClose() }}>
      <SheetContent side="bottom" className="rounded-t-3xl h-[92vh] overflow-y-auto pb-[calc(1rem+var(--safe-bottom))] lg:mx-auto lg:max-w-lg">
        <SheetHeader className="pb-0">
          <SheetTitle>{row.title}</SheetTitle>
          <SheetDescription className="sr-only">Type an amount</SheetDescription>
        </SheetHeader>
        <div className="px-4"><Pad {...props} /></div>
      </SheetContent>
    </Sheet>
  )
}

function Pad({ row, qtyOf, priceOf, paysAt, setQty, setPrice, qtyForRupees, priceProblem, allowPrice, gramsRule, checkAmounts, big, onClose }: KeypadBarProps) {
  const sizes = row.items
  const [sizeId, setSizeId] = useState<string>(() => (sizes.find((s) => qtyOf(s.id) > 0) ?? sizes[0]).id)
  const p = sizes.find((s) => s.id === sizeId) ?? sizes[0]
  const unit = normalizeUnitName(p.unit)
  const counted = isCountUnit(unit)
  const tabs: Tab[] = row.loose
    ? ['amount', ...(counted ? [] : ['rupee' as Tab]), ...(allowPrice ? ['price' as Tab] : [])]
    : ['packs', ...(allowPrice ? ['price' as Tab] : [])]
  const [tab, setTab] = useState<Tab>(tabs[0])
  const [text, setText] = useState('')
  const [typedUnit, setTypedUnit] = useState<TypedUnit>('auto')
  const [fresh, setFresh] = useState(true)
  const [err, setErr] = useState('')
  // The amount on show came from a quick pick (shown, but the next key replaces it).
  const [picked, setPicked] = useState(false)

  const price = priceOf(p)
  const qtyFrom = (t: string, u: TypedUnit) => (tab === 'rupee' ? qtyForRupees(p, Number(t)) : typedQuantity(t, tab === 'packs' ? 'auto' : u, unit, gramsRule))
  const apply = (t: string, u: TypedUnit) => {
    setErr('')
    if (tab === 'price' || !t) return
    const q = qtyFrom(t, u)
    if (q === null) { if (counted && Number(t) > 0) setErr('Packets are whole numbers'); return }
    setQty(p, q)
  }
  // A quick pick is a whole amount: the next key starts a new one (750 g, then 2 → 2, not 7502).
  const type = (t: string, u: TypedUnit = typedUnit, whole = false) => { setFresh(whole); setText(t); setTypedUnit(u); apply(t, u) }
  const press = (k: string) => {
    setPicked(false)
    let t = fresh ? '' : text
    if (k === '⌫') t = t.slice(0, -1)
    else if (k === '.') { if (!t.includes('.')) t = (t || '0') + '.' }
    else if (t.length < 7) t = (t === '0' ? '' : t) + k
    type(t)
  }
  usePadKeys(press, onClose)
  const pick = (t: Tab) => { setTab(t); setText(''); setFresh(true); setPicked(false); setTypedUnit('auto'); setErr('') }
  const pickSize = (id: string) => { setSizeId(id); setText(''); setFresh(true); setPicked(false); setErr('') }

  // What the big display says.
  const typed = text && (!fresh || picked) ? text : ''
  const q = typed && tab !== 'price' ? qtyFrom(typed, typedUnit) : null
  const onBill = qtyOf(p.id)
  const newPrice = tab === 'price' && typed ? Number(typed) : 0
  const problem = newPrice > 0 ? priceProblem(p, newPrice) : null
  let value: string
  let note: string
  if (tab === 'price') {
    value = typed ? `₹${typed}` : formatINR(price)
    note = typed ? `was ${formatINR(price)}${counted ? '' : `/${unit}`}` : 'type the new price'
  } else if (tab === 'rupee') {
    value = typed ? `₹${typed}` : '₹'
    note = q ? `= ${looseLabel(q, unit)}` : 'type the rupees'
  } else if (typed) {
    value = tab === 'packs' || counted ? `× ${typed}` : `${typed} ${shownUnit(typed, typedUnit, unit, gramsRule)}`
    note = q ? formatINR(q * paysAt(p, price)) : ''
  } else {
    value = onBill ? (counted ? `× ${onBill}` : looseLabel(onBill, unit)) : counted ? 'how many' : 'amount'
    note = onBill ? 'type to change' : ''
  }
  const warn = err || problem || (checkAmounts && q ? unusualAmount(q, unit, q * paysAt(p, price)) : null)
  const small = smallUnitOf(unit)

  let row2: ReactNode = null
  if (tab === 'packs' || (tab === 'price' && !row.loose)) {
    row2 = sizes.length > 1 ? sizes.map((s) => (
      <Chip key={s.id} on={s.id === sizeId} onClick={() => pickSize(s.id)}>{s.sizeLabel || s.name}{qtyOf(s.id) > 0 ? ` ×${qtyOf(s.id)}` : ''}</Chip>
    )) : null
  } else if (tab === 'amount') {
    // g | kg (ml | L): the unit being typed in, and a tap to change it.
    const unitChips = small ? [small, unit] : []
    const label = (u: string) => (u === 'ltr' ? 'L' : u)
    const current = typedUnit === 'auto' ? shownUnit(text || '1', 'auto', unit, gramsRule) : label(typedUnit)
    row2 = <>
      {unitChips.map((u) => (
        <Chip key={u} on={current === label(u)} onClick={() => type(text, u as TypedUnit)}>{label(u)}</Chip>
      ))}
      {barQuickPicks(unit, price).map((w) => (
        <Chip key={w} on={false} onClick={() => { setPicked(true); if (counted) type(String(w), 'auto', true); else if (w < 1 && small) type(String(Math.round(w * 1000)), small, true); else type(String(w), unit as TypedUnit, true) }}>
          {counted ? String(w) : looseLabel(w, unit)}
        </Chip>
      ))}
    </>
  } else if (tab === 'rupee') {
    row2 = [10, 20, 50, 100, 200].map((a) => <Chip key={a} on={false} onClick={() => { setPicked(true); type(String(a), typedUnit, true) }}>₹{a}</Chip>)
  }

  const noDot = tab === 'packs' || (counted && tab === 'amount')
  return (
    <div
      role="region"
      aria-label={`Amount for ${row.title}`}
      data-keypad
      className={cn('space-y-1.5', big && 'flex flex-col min-h-[78vh]', !big && 'fixed inset-x-0 bottom-[calc(4.5rem+var(--safe-bottom,0px))] z-40 border-t-2 border-check bg-card p-2 shadow-[0_-6px_16px_rgba(0,0,0,0.14)] lg:inset-x-auto lg:right-6 lg:bottom-24 lg:w-[420px] lg:rounded-xl lg:border-2')}
    >
      <div className="flex items-center gap-2">
        <div className="min-w-0 flex-1">
          {!big && <p className="text-sm font-semibold truncate">{row.loose ? row.title : `${row.title} · ${p.sizeLabel || p.name}`}</p>}
          <p className="text-xs text-muted-foreground tabular-nums">{formatINR(price)}{counted ? '' : `/${unit}`}{!row.loose && p.mrp ? ` · MRP ${formatINR(p.mrp)}` : ''}</p>
        </div>
        <div className="text-right tabular-nums">
          <p className={cn('font-bold leading-tight', big ? 'text-4xl' : 'text-2xl', !typed && 'text-muted-foreground')}>{value}</p>
          {note && <p className={cn('text-xs', problem ? 'text-bad font-semibold' : 'text-muted-foreground')}>{note}</p>}
        </div>
        {tab === 'price' && (
          <button
            type="button"
            disabled={!(newPrice > 0) || !!problem}
            onClick={() => { setPrice(p, newPrice); setText(''); setFresh(true) }}
            className="min-h-12 px-3 rounded-lg bg-primary text-primary-foreground text-sm font-semibold disabled:opacity-40"
          >
            Set price
          </button>
        )}
        <button type="button" onClick={onClose} className="min-h-12 px-3 rounded-lg bg-foreground text-background text-sm font-semibold">Done</button>
      </div>
      {tabs.length > 1 && (
        <div role="group" aria-label="What to type" className="flex gap-1.5">
          {tabs.map((t) => (
            <button key={t} type="button" aria-pressed={tab === t} onClick={() => pick(t)}
              className={cn('hit-48 flex-1 min-h-9 rounded-md border text-xs font-semibold', tab === t ? 'bg-primary text-primary-foreground border-primary' : 'bg-background border-border')}>
              {TAB_NAME[t]}
            </button>
          ))}
        </div>
      )}
      {row2 && <div className="flex gap-1.5 overflow-x-auto no-scrollbar">{row2}</div>}
      {warn && <p role="status" className={cn('text-xs font-semibold', err || problem ? 'text-bad' : 'text-check')}>{warn}</p>}
      {/* On the big pad the keys sit at the bottom, under the thumb. */}
      <Keys press={press} noDot={noDot} big={big} />
    </div>
  )
}

function Chip({ on, onClick, children }: { on: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button type="button" aria-pressed={on} onClick={onClick}
      className={cn('hit-48 shrink-0 min-h-9 rounded-full border px-3 text-xs font-semibold whitespace-nowrap', on ? 'bg-foreground text-background border-foreground' : 'bg-background border-border')}>
      {children}
    </button>
  )
}

const KEYS = ['1', '2', '3', '⌫', '4', '5', '6', '.', '7', '8', '9', '0']

function Keys({ press, noDot, big }: { press: (k: string) => void; noDot: boolean; big: boolean }) {
  return (
    <div className={cn('grid grid-cols-4 gap-1.5', big && 'mt-auto')}>
      {KEYS.map((k) => (
        <button
          key={k}
          type="button"
          disabled={k === '.' && noDot}
          onClick={() => press(k)}
          aria-label={k === '⌫' ? 'Delete' : k}
          className={cn('rounded-lg border border-border bg-background font-bold tabular-nums disabled:opacity-30 active:scale-[0.97]', big ? 'min-h-16 text-2xl' : 'min-h-12 text-xl', k === '⌫' && 'inline-flex items-center justify-center')}
        >
          {k === '⌫' ? <Delete className="w-5 h-5" aria-hidden /> : k}
        </button>
      ))}
    </div>
  )
}

/**
 * On a computer the number keys type into the open pad (the counter's F4 / ✎
 * flow never needs the mouse); Enter is Done. Taken first (capture) and kept
 * from the page, so digits typed here never reach the barcode-gun reader. A
 * text box with the cursor keeps its own keys.
 */
function usePadKeys(press: (k: string) => void, done: () => void) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = document.activeElement as HTMLElement | null
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable)) return
      if (e.ctrlKey || e.metaKey || e.altKey) return
      const k = /^[0-9.]$/.test(e.key) ? e.key : e.key === 'Backspace' ? '⌫' : null
      if (k) { e.preventDefault(); e.stopPropagation(); press(k) }
      else if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); done() }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [press, done])
}

const NEXT_UNITS: { id: NextUnit; label: string }[] = [
  { id: 'count', label: '× count' }, { id: 'g', label: 'g' }, { id: 'kg', label: 'kg' },
  { id: 'ml', label: 'ml' }, { id: 'ltr', label: 'L' }, { id: 'rs', label: '₹' },
]

/**
 * Step 2c (C11) — Qty first: an amount for the NEXT item tapped or scanned, in
 * its unit (× 23, 400 g, 1.25 kg, 750 ml, ₹50). It waits on the Qty button
 * until a tap uses it; a packet takes whole counts only (lib/loose-entry.ts).
 */
export function QtyPad({ next, setNext, onClose, error, big }: {
  next: NextQty | null
  setNext: (n: NextQty | null) => void
  onClose: () => void
  /** Why the last tap could not take the amount. */
  error: string
  big: boolean
}) {
  const [text, setText] = useState(next ? String(next.n) : '')
  const [unit, setUnit] = useState<NextUnit>(next?.unit ?? 'count')
  const set = (t: string, u: NextUnit) => { setText(t); setUnit(u); const n = Number(t); setNext(n > 0 ? { n, unit: u } : null) }
  const press = (k: string) => {
    let t = text
    if (k === '⌫') t = t.slice(0, -1)
    else if (k === '.') { if (!t.includes('.')) t = (t || '0') + '.' }
    else if (t.length < 7) t = (t === '0' ? '' : t) + k
    set(t, unit)
  }
  usePadKeys(press, onClose)
  const body = (
    <div role="region" aria-label="Qty for the next item" data-qtypad
      className={cn('space-y-1.5', big && 'flex flex-col min-h-[78vh]', !big && 'fixed inset-x-0 bottom-[calc(4.5rem+var(--safe-bottom,0px))] z-40 border-t-2 border-check bg-card p-2 shadow-[0_-6px_16px_rgba(0,0,0,0.14)] lg:inset-x-auto lg:right-6 lg:bottom-24 lg:w-[420px] lg:rounded-xl lg:border-2')}>
      <div className="flex items-center gap-2">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold">Qty for the next item</p>
          <p className="text-xs text-muted-foreground">Then tap or scan it</p>
        </div>
        <p className={cn('font-bold tabular-nums', big ? 'text-4xl' : 'text-2xl', !next && 'text-muted-foreground')}>{next ? nextLabel(next) : 'type'}</p>
        {next && <button type="button" onClick={() => set('', unit)} className="min-h-12 px-3 rounded-lg border border-border text-sm font-semibold">Clear</button>}
        <button type="button" onClick={onClose} className="min-h-12 px-3 rounded-lg bg-foreground text-background text-sm font-semibold">Done</button>
      </div>
      <div role="group" aria-label="Unit" className="flex gap-1.5 overflow-x-auto no-scrollbar">
        {NEXT_UNITS.map((u) => <Chip key={u.id} on={unit === u.id} onClick={() => set(text, u.id)}>{u.label}</Chip>)}
      </div>
      {error && <p role="status" className="text-xs font-semibold text-bad">{error}</p>}
      <Keys press={press} noDot={unit === 'count'} big={big} />
    </div>
  )
  if (!big) return body
  return (
    <Sheet open onOpenChange={(o) => { if (!o) onClose() }}>
      <SheetContent side="bottom" className="rounded-t-3xl h-[92vh] overflow-y-auto pb-[calc(1rem+var(--safe-bottom))] lg:mx-auto lg:max-w-lg">
        <SheetHeader className="pb-0">
          <SheetTitle>Qty</SheetTitle>
          <SheetDescription className="sr-only">An amount for the next item</SheetDescription>
        </SheetHeader>
        <div className="px-4">{body}</div>
      </SheetContent>
    </Sheet>
  )
}
