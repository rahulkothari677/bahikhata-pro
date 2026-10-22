'use client'

/**
 * Phase 7c (#294, #295, #298) — the ONE item picker, for every bill: sale,
 * purchase, estimate and return.
 *
 * Rahul, 7 Aug: on a phone the list must show product names properly and adding
 * must be easy; 13 Oct: no bigger cards; 22 Oct: hundreds of products in sizes
 * and brands, smoothly. So: one search box, then ROWS — one per brand with its
 * sizes as buttons (lib/pick-rows.ts), the same row for search results, "Often
 * sold", a customer's usual items and a group's full list. Nothing is cut
 * without saying so ("8 of 31, keep typing"; a group grows 60 at a time).
 *
 * It replaces the Counter's tile grid (one tile per size, 24 per group, the
 * rest unreachable) and the old picker's category drop-down + scroll box.
 * State (the query, the bill) lives in TransactionEntry; this only draws.
 */
import { useState, useMemo, type ReactNode } from 'react'
import { Input } from '@/components/ui/input'
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from '@/components/ui/sheet'
import { Search, X, Plus, Minus, Trash2, ChevronRight, ChevronLeft, LayoutGrid } from 'lucide-react'
import { formatINR, cn } from '@/lib/utils'
import { isService } from '@/lib/inventory-tracking'
import type { ItemSearchResult } from '@/lib/item-search'
import {
  groupPickRows, rankedRows, groupRows, pickGroups,
  SEARCH_ROWS, OFTEN_ROWS, USUAL_ROWS, GROUP_PAGE, FOLD_AFTER_LINES, type PickRowGroup,
} from '@/lib/pick-rows'

export interface ItemPickerProps {
  products: any[]
  query: string
  onQuery: (q: string) => void
  /** Enter in the box: a scanned code, or the one row left. */
  onEnter: () => void
  result: ItemSearchResult<any>
  /** The shop's best sellers (or most bought, on a purchase), frozen while a bill is open. */
  oftenIds: string[]
  oftenLabel: string
  /** What the picked customer usually buys. */
  usualIds: string[]
  customerName?: string | null
  billLines: number
  qtyOf: (id: string) => number
  priceOf: (p: any) => number
  showsGst: boolean
  onAdd: (p: any) => void
  onDecrement: (id: string) => void
  catalogCutNote?: string | null
  scanButton?: ReactNode
  belowSearch?: ReactNode
  /** Shown when the shop has no items at all. */
  empty: ReactNode
}

export function ItemPicker(props: ItemPickerProps) {
  const { products, query, onQuery, onEnter, result, catalogCutNote, scanButton, belowSearch, empty } = props
  const [groupsOpen, setGroupsOpen] = useState(false)
  return (
    <div className="space-y-2">
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" aria-hidden />
        <Input
          id="field-search-product"
          aria-label="Search items"
          placeholder="Type 2–3 letters, a price, or scan"
          value={query}
          onChange={(e) => onQuery(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); onEnter() } }}
          className={cn('pl-9', scanButton ? 'pr-24' : 'pr-12')}
          autoComplete="off"
        />
        <div className="absolute right-1 top-1/2 -translate-y-1/2 flex items-center">
          {query && (
            <button type="button" onClick={() => onQuery('')} aria-label="Clear search" className="w-12 h-12 inline-flex items-center justify-center text-muted-foreground hover:text-foreground">
              <X className="w-4 h-4" aria-hidden />
            </button>
          )}
          {scanButton}
        </div>
      </div>
      {catalogCutNote && <p className="text-xs font-semibold text-check">{catalogCutNote}</p>}
      {belowSearch}
      {products.length === 0 ? empty : query.trim() ? (
        <SearchRows {...props} />
      ) : (
        <OftenRows {...props} onGroups={() => setGroupsOpen(true)} />
      )}
      <GroupsSheet {...props} open={groupsOpen} onClose={() => setGroupsOpen(false)} />
    </div>
  )
}

function Rows({ rows, p }: { rows: PickRowGroup<any>[]; p: ItemPickerProps }) {
  return (
    <div className="rounded-lg border border-border bg-background">
      {rows.map((r) => r.brand
        ? <BrandRow key={r.key} row={r} p={p} />
        : <PickRow key={r.key} product={r.items[0]} qty={p.qtyOf(r.items[0].id)} price={p.priceOf(r.items[0])} showsGst={p.showsGst} onAdd={() => p.onAdd(r.items[0])} onDecrement={() => p.onDecrement(r.items[0].id)} />)}
    </div>
  )
}

function SearchRows(p: ItemPickerProps) {
  const rows = useMemo(() => groupPickRows(p.result.items), [p.result])
  if (!rows.length) return <p className="text-sm text-muted-foreground py-4 text-center">No item matches &quot;{p.query}&quot;</p>
  return (
    <>
      {p.result.close && <p className="text-xs font-semibold text-check">No exact match · close spellings</p>}
      <Rows rows={rows.slice(0, SEARCH_ROWS)} p={p} />
      {rows.length > SEARCH_ROWS && <p className="text-center text-xs text-muted-foreground py-1">{SEARCH_ROWS} of {rows.length} shown · keep typing</p>}
    </>
  )
}

function OftenRows(p: ItemPickerProps & { onGroups: () => void }) {
  const [expanded, setExpanded] = useState(false)
  const usual = useMemo(() => rankedRows(p.products, p.usualIds, USUAL_ROWS), [p.products, p.usualIds])
  const often = useMemo(() => rankedRows(p.products, p.oftenIds, OFTEN_ROWS, new Set(usual.map((r) => r.key))), [p.products, p.oftenIds, usual])
  const folded = p.billLines > FOLD_AFTER_LINES && !expanded
  const groupsButton = (
    <button type="button" onClick={p.onGroups} className="min-h-12 px-3 inline-flex items-center gap-1.5 rounded-lg text-sm font-semibold text-primary hover:bg-muted">
      <LayoutGrid className="w-4 h-4" aria-hidden /> Groups <ChevronRight className="w-4 h-4" aria-hidden />
    </button>
  )
  // A long bill: the suggestions fold to one line so the bill stays in view (#229).
  if (folded || (!usual.length && !often.length)) {
    return (
      <div className="flex items-center justify-between gap-2">
        {usual.length || often.length
          ? <button type="button" onClick={() => setExpanded(true)} className="min-h-12 px-3 rounded-lg text-sm font-semibold hover:bg-muted">{p.oftenLabel} ›</button>
          : <p className="text-xs text-muted-foreground px-1">Type to find an item, or open a group</p>}
        {groupsButton}
      </div>
    )
  }
  return (
    <div className="space-y-2">
      {usual.length > 0 && (
        <>
          <p className="text-xs font-semibold text-muted-foreground px-1">{p.customerName ? `${p.customerName} usually buys` : 'Usually buys'}</p>
          <Rows rows={usual} p={p} />
        </>
      )}
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs font-semibold text-muted-foreground px-1">{often.length ? p.oftenLabel : ''}</p>
        {groupsButton}
      </div>
      {often.length > 0 && <Rows rows={often} p={p} />}
    </div>
  )
}

/** Every group, then a group's whole list — 60 rows at a time, never cut. */
function GroupsSheet(p: ItemPickerProps & { open: boolean; onClose: () => void }) {
  const [group, setGroup] = useState<string | null>(null)
  const [shown, setShown] = useState(GROUP_PAGE)
  const groups = useMemo(() => (p.open ? pickGroups(p.products) : []), [p.open, p.products])
  const rows = useMemo(() => (group ? groupRows(p.products, group) : []), [group, p.products])
  const close = () => { p.onClose(); setGroup(null); setShown(GROUP_PAGE) }
  return (
    <Sheet open={p.open} onOpenChange={(o) => { if (!o) close() }}>
      <SheetContent side="bottom" className="rounded-t-3xl h-[88vh] overflow-y-auto pb-[calc(1rem+var(--safe-bottom))] lg:mx-auto lg:max-w-2xl">
        <SheetHeader className="pb-2">
          <SheetTitle className="flex items-center gap-1">
            {group && (
              <button type="button" onClick={() => { setGroup(null); setShown(GROUP_PAGE) }} aria-label="All groups" className="w-12 h-12 -ml-3 inline-flex items-center justify-center">
                <ChevronLeft className="w-5 h-5" aria-hidden />
              </button>
            )}
            {group ?? 'Groups'}
          </SheetTitle>
          <SheetDescription className="sr-only">Every item, by group</SheetDescription>
        </SheetHeader>
        <div className="px-4 space-y-2">
          {!group ? (
            <ul className="rounded-lg border border-border divide-y divide-border">
              {groups.map((g) => (
                <li key={g.name}>
                  <button type="button" onClick={() => setGroup(g.name)} className="w-full min-h-12 px-3 flex items-center justify-between gap-2 text-left hover:bg-muted/40">
                    <span className="text-sm font-semibold truncate">{g.name === 'Uncategorized' ? 'Other' : g.name}</span>
                    <span className="text-xs text-muted-foreground shrink-0 tabular-nums">{g.rows === g.items ? `${g.items} items` : `${g.rows} rows · ${g.items} items`} <ChevronRight className="inline w-4 h-4" aria-hidden /></span>
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <>
              <Rows rows={rows.slice(0, shown)} p={p} />
              {rows.length > shown && (
                <button type="button" onClick={() => setShown((v) => v + GROUP_PAGE)} className="w-full min-h-12 rounded-lg border border-border text-sm font-semibold hover:bg-muted">
                  {shown} of {rows.length} shown · show more
                </button>
              )}
            </>
          )}
        </div>
      </SheetContent>
    </Sheet>
  )
}

/** A brand: its name, then its sizes as buttons, smallest first; the most-sold size marked. */
function BrandRow({ row, p }: { row: PickRowGroup<any>; p: ItemPickerProps }) {
  return (
    <div className="px-3 py-2 border-b border-border/40 last:border-0">
      <div className="flex items-baseline justify-between gap-2">
        <p className="text-sm font-semibold truncate">{row.brand!.name}</p>
        <span className="text-xs text-muted-foreground shrink-0">{row.items.length === 1 ? '1 size' : `${row.items.length} sizes`}</span>
      </div>
      <div className="mt-1.5 flex flex-wrap gap-2" role="group" aria-label={`${row.brand!.name} sizes`}>
        {row.items.map((it) => (
          <SizeButton key={it.id} product={it} qty={p.qtyOf(it.id)} price={p.priceOf(it)} top={row.items.length > 1 && it.id === row.topId} onAdd={() => p.onAdd(it)} />
        ))}
      </div>
    </div>
  )
}

function SizeButton({ product: it, qty, price, top, onAdd }: { product: any; qty: number; price: number; top: boolean; onAdd: () => void }) {
  const out = !isService(it) && Number(it.currentStock) <= 0
  const label: string = it.sizeLabel || it.name
  // A price pack ("₹10") already says its price; any other size shows it beside the size.
  const samePrice = /^₹\s?\d/.test(label) && Number(label.replace(/[^\d.]/g, '')) === Number(price)
  return (
    <button
      type="button"
      onClick={onAdd}
      aria-label={qty > 0 ? `Add another ${it.name}` : `Add ${it.name}`}
      className={cn(
        'min-h-12 rounded-lg border px-3 text-sm font-semibold tabular-nums inline-flex items-center gap-1.5 transition active:scale-[0.98]',
        qty > 0 ? 'bg-primary text-primary-foreground border-primary'
          : top ? 'border-primary/60 bg-primary/5 hover:bg-primary/10'
            : 'border-border bg-background hover:bg-muted',
        out && qty === 0 && 'border-dashed',
      )}
    >
      <span>{label}</span>
      {!samePrice && <span className={cn('text-xs font-medium', qty > 0 ? 'opacity-80' : 'text-muted-foreground')}>{formatINR(price)}</span>}
      {out && qty === 0 && <span className="text-xs font-medium text-bad">out</span>}
      {qty > 0 && <span className="rounded-full bg-primary-foreground/20 px-1.5 text-xs font-bold">×{qty}</span>}
    </button>
  )
}

/**
 * An item on its own: the name in full, its price and stock, and a stepper once
 * it is on the bill (billing is a counting job). A row, not one big button —
 * a stepper needs buttons of its own, and a button in a button is invalid HTML.
 */
export function PickRow({ product: p, qty, price, showsGst, onAdd, onDecrement }: {
  product: any
  qty: number
  price: number
  showsGst: boolean
  onAdd: () => void
  onDecrement: () => void
}) {
  const stock = isService(p) ? { text: 'Service', cls: 'text-ai' }
    : p.currentStock <= 0 ? { text: 'out', cls: 'text-bad font-semibold' }
      : p.isLowStock ? { text: `${p.currentStock} ${p.unit} · low`, cls: 'text-check' }
        : { text: `${p.currentStock} ${p.unit}`, cls: 'text-good' }
  return (
    <div className="w-full flex items-center gap-2 px-2 sm:px-2.5 py-1.5 border-b border-border/40 last:border-0 hover:bg-muted/50">
      <button onClick={onAdd} aria-label={qty > 0 ? `Add another ${p.name}` : `Add ${p.name}`} className="flex-1 min-w-0 min-h-12 flex items-center gap-2 text-left">
        <span className="flex-1 min-w-0">
          <span className="block text-sm font-medium leading-snug break-words">{p.name}</span>
          <span className="flex items-center gap-1.5 text-xs text-muted-foreground tabular-nums">
            <span>{formatINR(price)}/{p.unit}</span>
            {showsGst && <span>· GST {p.gstRate}%</span>}
            <span className={stock.cls}>· {stock.text}</span>
          </span>
        </span>
      </button>
      <div className="flex-shrink-0">
        {qty > 0 ? (
          <div className="flex items-center rounded-lg border border-primary/40 bg-primary/5 overflow-hidden">
            <button onClick={onDecrement} aria-label={qty === 1 ? `Remove ${p.name} from this sale` : `Reduce ${p.name} to ${qty - 1}`} className="w-12 h-12 flex items-center justify-center text-primary hover:bg-primary/15">
              {qty === 1 ? <Trash2 className="w-3.5 h-3.5" aria-hidden /> : <Minus className="w-4 h-4" aria-hidden />}
            </button>
            <span className="min-w-[26px] text-center text-sm font-bold text-primary tabular-nums">{qty}</span>
            <button onClick={onAdd} aria-label={`Add another ${p.name}`} className="w-12 h-12 flex items-center justify-center text-primary hover:bg-primary/15">
              <Plus className="w-4 h-4" aria-hidden />
            </button>
          </div>
        ) : (
          <button onClick={onAdd} aria-label={`Add ${p.name}`} className="w-12 h-12 rounded-lg bg-primary/10 flex items-center justify-center hover:bg-primary/20">
            <Plus className="w-4 h-4 text-primary" aria-hidden />
          </button>
        )}
      </div>
    </div>
  )
}
