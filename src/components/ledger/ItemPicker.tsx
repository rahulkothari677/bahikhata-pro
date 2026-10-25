'use client'

/**
 * Phase 7c — the ONE item picker, for every bill: sale, purchase, estimate and
 * return. Change C11 (Rahul, 22–24 Oct, from the designs he chose): the List.
 *
 *   search · ★ Often | group tabs · product tabs inside a big group ·
 *   a list window of rows, one row per product with its sizes as buttons.
 *
 * "In the earlier version there were a list box and on top there were to
 * choose category and product, then the list in the windows shows those
 * products" (22 Oct); "the different quantities in the same line, not a
 * separate line for each size" (24 Oct). Side view (⚙ on New Sale) puts the
 * groups in a column on the left. Search shows its rows in the same window.
 *
 * The window is the only box that scrolls inside the page, on purpose (#232
 * was a 4-row box a thumb fought with): it is tall, and a swipe inside it
 * never drags the page (overscroll-contain). A long bill shortens it so the
 * bill shows (#229). Nothing is cut without saying so ("30 of 52 · keep typing").
 * State (the query, the bill) lives in TransactionEntry; this only draws.
 */
import { useState, useMemo, useRef, useCallback, useEffect, useLayoutEffect, type ReactNode } from 'react'
import { Input } from '@/components/ui/input'
import { Search, X, Minus, Trash2 } from 'lucide-react'
import { formatINR, cn } from '@/lib/utils'
import { isService } from '@/lib/inventory-tracking'
import { isCountUnit } from '@/lib/units'
import { parseSize } from '@/lib/product-sizes'
import { isLooseUnit, weightButtons, looseLabel } from '@/lib/loose-entry'
import type { KeypadRow } from '@/components/ledger/KeypadBar'
import type { ItemSearchResult } from '@/lib/item-search'
import {
  groupPickRows, rankedRows, rankedGroupRows, listGroups, typeTabs, rowName,
  SEARCH_ROWS, OFTEN_ROWS, USUAL_ROWS, FOLD_AFTER_LINES, type PickRowGroup,
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
  /** C12 switches (⚙ on the bill screen): stock on a size; the most-sold size marked; groups on the left. */
  sizeStock?: boolean
  sizeMark?: boolean
  sideView?: boolean
  /** Step 2b: ✎ on a row opens the keypad bar for it (absent when ⚙ switches ✎ off). */
  onPencil?: (row: KeypadRow) => void
  /** The row the keypad bar is open for: marked, and kept in view above the bar. */
  kbRowKey?: string | null
  /** Weight buttons on a loose good's row (250 g, 500 g, 1 kg…), each adding that much. */
  weightButtons?: boolean
  onAddQty?: (p: any, q: number) => void
  /** C12: what Enter will do with the typed line ("Enter adds 400 g of Toor Dal (loose)"). */
  searchHint?: string | null
  /** C11 "Not in list": what to offer when nothing matches ("Bill it once", or "Add it as a new item"). */
  notFound?: { label: string; run: (typed: string) => void } | null
  /** C12: a pasted list keeps its lines (a one-line box would join them into one item). */
  listPaste?: boolean
  onAdd: (p: any) => void
  onDecrement: (id: string) => void
  catalogCutNote?: string | null
  scanButton?: ReactNode
  belowSearch?: ReactNode
  /** Shown when the shop has no items at all. */
  empty: ReactNode
}

const OFTEN = '__often'
const NO_GROUP = 'Uncategorized'
/** The phone's total bar (Pay / Save) and its gap: the window stops above it. */
const BOTTOM_BAR_PX = 84
const WINDOW_MIN = 300
const WINDOW_MAX = 560
/** A long bill (#229): the window stays this short so the bill shows — still never a small box (#232). */
const WINDOW_FOLDED = 300

// useLayoutEffect warns on the server; the window is only measured in a browser.
const useIsoLayoutEffect = typeof window === 'undefined' ? useEffect : useLayoutEffect

export function ItemPicker(props: ItemPickerProps) {
  const { products, query, onQuery, onEnter, catalogCutNote, scanButton, belowSearch, empty, listPaste } = props
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
          onPaste={(e) => {
            const text = e.clipboardData.getData('text')
            if (!listPaste || !/\n/.test(text)) return
            e.preventDefault()
            const lines = text.replace(/\r?\n+/g, ', ').replace(/[,\s]+$/, '')
            onQuery(query.trim() ? `${query.trim()}, ${lines}` : lines)
          }}
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
      {products.length === 0 ? empty : <ListArea {...props} />}
    </div>
  )
}

/** The tabs and the list window (List), or the group column and the window (Side). */
function ListArea(p: ItemPickerProps) {
  const side = !!p.sideView
  const searching = p.query.trim() !== ''
  const usual = useMemo(() => rankedRows(p.products, p.usualIds, USUAL_ROWS), [p.products, p.usualIds])
  const often = useMemo(() => rankedRows(p.products, p.oftenIds, OFTEN_ROWS, new Set(usual.map((r) => r.key))), [p.products, p.oftenIds, usual])
  const groups = useMemo(() => listGroups(p.products, p.oftenIds), [p.products, p.oftenIds])
  const hasOften = usual.length + often.length > 0
  const [picked, setPicked] = useState<string | null>(null)
  const tab = picked && (picked === OFTEN ? hasOften : groups.includes(picked)) ? picked : hasOften ? OFTEN : groups[0]
  const inGroup = useMemo(() => (tab && tab !== OFTEN ? rankedGroupRows(p.products, tab, p.oftenIds) : []), [p.products, tab, p.oftenIds])
  const types = useMemo(() => typeTabs(inGroup), [inGroup])
  const [sub, setSub] = useState('All')
  const subNow = types && types.tabs.includes(sub) ? sub : 'All'
  const found = useMemo(() => (searching ? groupPickRows(p.result.items) : []), [searching, p.result])
  const listRef = useRef<HTMLDivElement>(null)
  const areaRef = useRef<HTMLDivElement>(null)
  const top = () => { if (listRef.current) listRef.current.scrollTop = 0 }
  // On a phone, choosing a group parks the tabs under the app's top bar, so the whole
  // window sits above the total bar (#232: no row hiding under it). Scrolling up brings
  // the customer back.
  const folded = p.billLines > FOLD_AFTER_LINES
  // On a phone the window fills the room down to the total bar — measured, because the
  // rows above it (customer, search, Qty, tabs) differ by shop and by switch.
  const [winH, setWinH] = useState<number | null>(null)
  const fit = useCallback(() => {
    const box = side ? areaRef.current : listRef.current
    if (typeof window === 'undefined' || window.innerWidth >= 1024 || !box) { setWinH(null); return }
    const room = Math.round(window.innerHeight - box.getBoundingClientRect().top - BOTTOM_BAR_PX)
    setWinH(Math.min(folded ? WINDOW_FOLDED : WINDOW_MAX, Math.max(WINDOW_MIN, room)))
  }, [side, folded])
  useIsoLayoutEffect(() => { fit() }, [fit, tab, subNow, searching, types])
  useEffect(() => { window.addEventListener('resize', fit); return () => window.removeEventListener('resize', fit) }, [fit])
  const park = () => {
    if (typeof window === 'undefined' || window.innerWidth >= 1024 || !areaRef.current) return
    const head = document.querySelector('header')?.getBoundingClientRect().bottom ?? 0
    const want = areaRef.current.getBoundingClientRect().top - head - 4
    // Instant, not the page's smooth scroll: the window measures where it lands.
    if (want > 4) window.scrollBy({ top: want, behavior: 'instant' as ScrollBehavior })
    requestAnimationFrame(fit)
  }
  const go = (t: string) => { setPicked(t); setSub('All'); top(); park() }
  const goSub = (s: string) => { setSub(s); top() }
  // The row the keypad bar is open for goes to the top of the window, above the bar.
  useEffect(() => {
    if (!p.kbRowKey || !listRef.current) return
    const rowEl = listRef.current.querySelector<HTMLElement>(`[data-row-key="${CSS.escape(p.kbRowKey)}"]`)
    if (rowEl) listRef.current.scrollTop += rowEl.getBoundingClientRect().top - listRef.current.getBoundingClientRect().top - 2
  }, [p.kbRowKey])

  // Lines on the bill per group: the dot on its tab.
  const lines = new Map<string, number>()
  for (const x of p.products) if (p.qtyOf(x.id) > 0) { const g = x.category || NO_GROUP; lines.set(g, (lines.get(g) ?? 0) + 1) }
  const oftenLines = [...usual, ...often].reduce((n, r) => n + r.items.filter((it) => p.qtyOf(it.id) > 0).length, 0)
  const groupName = (g: string) => (g === NO_GROUP ? 'Other' : g)

  const tabList: { id: string; label: string; n: number }[] = [
    ...(hasOften ? [{ id: OFTEN, label: '★ Often', n: oftenLines }] : []),
    ...groups.map((g) => ({ id: g, label: groupName(g), n: lines.get(g) ?? 0 })),
  ]
  // Before it is measured (and on a desktop): fixed heights.
  const height = winH ? '' : folded
    ? 'h-[300px]'
    : 'h-[45vh] min-h-[300px] max-h-[440px] lg:h-[440px] lg:max-h-none'
  const sized = winH ? { height: winH } : undefined

  let body: ReactNode
  if (searching) {
    body = found.length
      ? <>
          <Rows rows={found.slice(0, SEARCH_ROWS)} p={p} wrap={side} />
          {found.length > SEARCH_ROWS && <p className="text-center text-xs text-muted-foreground py-2">{SEARCH_ROWS} of {found.length} shown · keep typing</p>}
        </>
      : <div className="py-6 text-center space-y-2">
          <p className="text-sm text-muted-foreground">No item matches &quot;{p.query}&quot;</p>
          {p.notFound && (
            <button type="button" onClick={() => p.notFound!.run(p.query)} className="min-h-12 px-4 rounded-lg border border-primary text-primary text-sm font-semibold">
              {p.notFound.label}
            </button>
          )}
        </div>
  } else if (tab === OFTEN) {
    body = <>
      {usual.length > 0 && <ListHeading>{p.customerName ? `${p.customerName} usually buys` : 'Usually buys'}</ListHeading>}
      <Rows rows={usual} p={p} wrap={side} />
      {usual.length > 0 && often.length > 0 && <ListHeading>{p.oftenLabel}</ListHeading>}
      <Rows rows={often} p={p} wrap={side} />
    </>
  } else {
    body = <Rows rows={subNow === 'All' || !types ? inGroup : inGroup.filter((r) => types.typeOf.get(r.key) === subNow)} p={p} wrap={side} />
  }

  const subTabs = !searching && types ? (
    <TabRow label="Products" small items={['All', ...types.tabs].map((t) => ({ id: t, label: t, n: 0 }))} current={subNow} onPick={goSub} />
  ) : null
  const searchNote = searching
    ? <p className={cn('text-xs font-semibold px-1', p.searchHint ? 'text-primary' : 'text-muted-foreground')}>
        {p.searchHint ?? (p.result.close ? 'No exact match · close spellings' : 'Searching every item')}
      </p>
    : null
  const windowBox = (cls: string) => (
    <div ref={listRef} data-list-window style={side ? undefined : sized} className={cn('overflow-y-auto overscroll-contain min-w-0', cls)}>
      {body}
      {/* While the keypad bar is open, room at the end lets the last rows scroll up above it. */}
      {p.kbRowKey && <div aria-hidden data-bar-room className="h-[340px]" />}
    </div>
  )

  if (side) {
    return (
      <div ref={areaRef} style={sized} className={cn('grid grid-cols-[84px_minmax(0,1fr)] rounded-lg border border-border bg-background overflow-hidden', height)}>
        <div role="group" aria-label="Groups" className="overflow-y-auto overscroll-contain bg-muted/60 border-r border-border">
          {tabList.map((t) => (
            <button
              key={t.id}
              type="button"
              aria-pressed={!searching && tab === t.id}
              onClick={() => { if (searching) p.onQuery(''); go(t.id) }}
              className={cn('block w-full min-h-[52px] px-1.5 py-1.5 text-left text-xs font-semibold leading-tight border-l-[3px]',
                !searching && tab === t.id ? 'bg-background border-l-primary text-foreground' : 'border-l-transparent text-muted-foreground')}
            >
              {t.label}{t.n > 0 && <span className="mt-0.5 block w-fit rounded-full bg-primary px-1.5 text-xs font-bold text-primary-foreground tabular-nums">{t.n}</span>}
            </button>
          ))}
        </div>
        <div className="grid grid-rows-[auto_minmax(0,1fr)] min-w-0 min-h-0">
          <div className="min-w-0">{searchNote ? <div className="py-1.5">{searchNote}</div> : subTabs ? <div className="p-1.5 border-b border-border">{subTabs}</div> : null}</div>
          {windowBox('')}
        </div>
      </div>
    )
  }
  return (
    <div ref={areaRef} className="space-y-1.5">
      {searchNote ?? <TabRow label="Groups" items={tabList} current={tab} onPick={go} />}
      {subTabs}
      {windowBox(cn('rounded-lg border border-border bg-background', height))}
    </div>
  )
}

function ListHeading({ children }: { children: ReactNode }) {
  return <p className="px-2.5 pt-2 pb-1 text-xs font-semibold text-muted-foreground border-b border-border/40">{children}</p>
}

function TabRow({ label, items, current, onPick, small }: {
  label: string
  items: { id: string; label: string; n: number }[]
  current: string
  onPick: (id: string) => void
  small?: boolean
}) {
  return (
    <div role="group" aria-label={label} className="flex gap-1.5 overflow-x-auto no-scrollbar pb-0.5">
      {items.map((t) => (
        <button
          key={t.id}
          type="button"
          aria-pressed={current === t.id}
          onClick={() => onPick(t.id)}
          className={cn('hit-48 shrink-0 inline-flex items-center gap-1 whitespace-nowrap font-semibold',
            small
              ? cn('min-h-9 rounded-md px-2.5 text-xs', current === t.id ? 'bg-foreground text-background' : 'bg-muted text-foreground')
              : cn('min-h-10 rounded-full border px-3 text-sm', current === t.id ? 'bg-primary text-primary-foreground border-primary' : 'bg-background border-border'))}
        >
          {t.label}
          {t.n > 0 && <span className={cn('rounded-full px-1.5 text-xs font-bold tabular-nums', current === t.id ? 'bg-primary-foreground/25' : 'bg-primary text-primary-foreground')}>{t.n}</span>}
        </button>
      ))}
    </div>
  )
}

function Rows({ rows, p, wrap }: { rows: PickRowGroup<any>[]; p: ItemPickerProps; wrap: boolean }) {
  return <>{rows.map((r) => <ListRow key={r.key} row={r} p={p} wrap={wrap} />)}</>
}

/** One product: its name, then all its sizes as buttons on ONE line (List) or wrapped (Side). */
function ListRow({ row, p, wrap }: { row: PickRowGroup<any>; p: ItemPickerProps; wrap: boolean }) {
  const name = rowName(row)
  const it0 = row.items[0]
  const loose = !row.brand && isLooseUnit(it0.unit)
  const sub = [
    row.brand ? (row.items.length === 1 ? '1 size' : `${row.items.length} sizes`) : isService(it0) ? 'Service' : '',
    p.showsGst ? `GST ${it0.gstRate}%` : '',
  ].filter(Boolean).join(' · ')
  const editing = p.kbRowKey === row.key
  const pencil = p.onPencil ? () => p.onPencil!({ key: row.key, title: name, loose: !row.brand, items: row.items }) : null
  const price = p.priceOf(it0)
  const onBill = loose ? p.qtyOf(it0.id) : 0
  const weights = loose && p.weightButtons !== false ? weightButtons(it0.unit, price) : []
  return (
    <div data-row-key={row.key} className={cn('px-2.5 py-1.5 border-b border-border/40 last:border-0', editing && 'bg-check/10 ring-2 ring-inset ring-check/60')}>
      <div className="flex items-baseline gap-1.5 min-w-0">
        <p className="text-sm font-semibold leading-tight truncate min-w-0">{name}</p>
        {sub && <span className="text-xs text-muted-foreground shrink-0">{sub}</span>}
      </div>
      <div role="group" aria-label={`${name} sizes`} className={cn('mt-1 flex gap-1.5', wrap ? 'flex-wrap' : 'overflow-x-auto no-scrollbar pr-1')}>
        {loose && weights.length ? (
          <>
            {onBill > 0 && (
              <TwoLine onClick={pencil ?? (() => {})} on label={`${looseLabel(onBill, it0.unit)} ✎`} note={formatINR(onBill * price)} aria={`Change the amount of ${it0.name}`} />
            )}
            {weights.map((w) => (
              <TwoLine key={w} onClick={() => (p.onAddQty ? p.onAddQty(it0, w) : p.onAdd(it0))} label={looseLabel(w, it0.unit)} note={formatINR(w * price)} aria={`Add ${looseLabel(w, it0.unit)} of ${it0.name}`} />
            ))}
          </>
        ) : row.items.map((it) => (
          <SizeButton
            key={it.id}
            product={it}
            qty={p.qtyOf(it.id)}
            price={p.priceOf(it)}
            top={p.sizeMark !== false && row.items.length > 1 && it.id === row.topId}
            showOut={p.sizeStock !== false}
            onAdd={() => p.onAdd(it)}
            onDecrement={() => p.onDecrement(it.id)}
          />
        ))}
        {pencil && (
          <button
            type="button"
            onClick={pencil}
            aria-label={`Any amount, count or price: ${name}`}
            className="min-h-12 min-w-12 px-2 rounded-lg border border-dashed border-primary text-primary shrink-0 inline-flex flex-col items-center justify-center leading-tight"
          >
            <span className="text-sm font-bold">✎</span>
            <span className="text-xs">{loose ? 'type' : 'more'}</span>
          </button>
        )}
      </div>
    </div>
  )
}

/** A two-line button for a loose good: the weight, then what it comes to. */
function TwoLine({ label, note, onClick, on, aria }: { label: string; note: string; onClick: () => void; on?: boolean; aria: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={aria}
      className={cn('min-h-12 min-w-12 px-2 rounded-lg border shrink-0 inline-flex flex-col items-center justify-center leading-tight tabular-nums transition active:scale-[0.98]',
        on ? 'bg-primary text-primary-foreground border-primary' : 'border-border bg-background hover:bg-muted')}
    >
      <span className="text-sm font-bold whitespace-nowrap">{label}</span>
      <span className={cn('text-xs whitespace-nowrap', on ? 'opacity-90' : 'text-muted-foreground')}>{note}</span>
    </button>
  )
}

/**
 * A size: what is printed on the packet ("5 kg", "₹10"), then its price — or
 * "out", "2 left", or how many are on the bill. Once on the bill it carries a −.
 * An item on its own shows its size from the name, or "1 kg" for a loose good.
 */
function SizeButton({ product: it, qty, price, top, showOut, onAdd, onDecrement }: {
  product: any
  qty: number
  price: number
  top: boolean
  showOut: boolean
  onAdd: () => void
  onDecrement: () => void
}) {
  const counted = isCountUnit(it.unit)
  const tracked = !isService(it)
  const stock = Number(it.currentStock)
  const out = showOut && tracked && stock <= 0
  const low = showOut && tracked && !out && (it.isLowStock === true || stock <= Number(it.lowStockThreshold ?? 3))
  const label: string = it.sizeLabel || parseSize(it.name)?.label || (counted ? formatINR(price) : `1 ${it.unit}`)
  // A price pack ("₹10") already says its price.
  const samePrice = /^₹\s?\d/.test(label) && Number(label.replace(/[^\d.]/g, '')) === Number(price)
  const note = qty > 0 ? (counted ? `×${qty}` : `${qty} ${it.unit}`)
    : out ? 'out' : low ? `${stock} left` : samePrice ? '' : `${formatINR(price)}${counted ? '' : `/${it.unit}`}`
  const add = (
    <button
      type="button"
      onClick={onAdd}
      aria-label={qty > 0 ? `Add another ${it.name}` : `Add ${it.name}`}
      className={cn(
        'min-h-12 min-w-12 px-2 rounded-lg border shrink-0 inline-flex flex-col items-center justify-center leading-tight tabular-nums transition active:scale-[0.98]',
        qty > 0 ? 'bg-primary text-primary-foreground border-primary rounded-l-none'
          : top ? 'border-primary/60 bg-primary/5 hover:bg-primary/10'
            : 'border-border bg-background hover:bg-muted',
        out && qty === 0 && 'border-dashed',
      )}
    >
      <span className="text-sm font-bold whitespace-nowrap">{label}</span>
      {note && <span className={cn('text-xs whitespace-nowrap', qty > 0 ? 'opacity-90' : out || low ? 'text-bad font-semibold' : 'text-muted-foreground')}>{note}</span>}
    </button>
  )
  if (qty <= 0) return add
  return (
    <span className="inline-flex shrink-0">
      <button
        type="button"
        onClick={onDecrement}
        aria-label={qty === 1 ? `Remove ${it.name} from this bill` : `One less ${it.name}`}
        className="hit-48 min-h-12 w-10 rounded-l-lg border border-r-0 border-primary bg-primary/10 text-primary inline-flex items-center justify-center hover:bg-primary/20"
      >
        {qty === 1 ? <Trash2 className="w-3.5 h-3.5" aria-hidden /> : <Minus className="w-4 h-4" aria-hidden />}
      </button>
      {add}
    </span>
  )
}
