'use client'

/**
 * Filter & sort sheet for the Sales / Purchases ledger.
 *
 * WHY THIS EXISTS (2026-08-06).
 *
 * The ledger's controls used to live permanently on screen: search, a view
 * toggle, a date button, a voided toggle, a Scan Bill button, a "Select
 * multiple →" text link, and a row of four sort buttons. The container was
 * `flex-col sm:flex-row`, so below the sm breakpoint every one of those became
 * its own full-width band — seven of them, roughly a third of a phone screen,
 * standing between the shopkeeper and the first transaction. It was a desktop
 * toolbar that merely degraded on mobile rather than a mobile design.
 *
 * Controls that are set once and then left alone do not deserve permanent
 * screen space. Every app that solved this — Swiggy, Zomato, Myntra, Amazon,
 * Google Photos — puts them behind one button and surfaces the ACTIVE ones as
 * removable chips, so the screen shows your current state instead of every
 * option you are not using.
 *
 * That is the trade this makes: one 40px row always, the full set one tap away,
 * and what you have actually chosen visible as chips you can dismiss.
 *
 * Sorting is in here rather than on a chip row of its own for the same reason,
 * with one addition — the four old buttons showed the OPTIONS but never the
 * current state, so you had to hunt for the highlighted one to learn how your
 * ledger was ordered. The trigger chip now reads "Date ↓" outright.
 */

import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import {
  Drawer, DrawerContent, DrawerFooter, DrawerHeader, DrawerTitle, DrawerDescription,
} from '@/components/ui/drawer'
import { getPresetRange, type DateRange, type DatePreset } from '@/components/common/DateRangePicker'
import { Calendar, IndianRupee, User, Receipt, LayoutGrid, List, Check } from 'lucide-react'
import { cn } from '@/lib/utils'

export type SortKey = 'date' | 'amount' | 'party' | 'status'

/** The fields a ledger can be ordered by. */
export const SORT_OPTIONS: { key: SortKey; label: string; icon: typeof Calendar }[] = [
  { key: 'date', label: 'Date', icon: Calendar },
  { key: 'amount', label: 'Amount', icon: IndianRupee },
  { key: 'party', label: 'Party', icon: User },
  { key: 'status', label: 'Payment', icon: Receipt },
]

/**
 * Period choices. `null` means no date filter at all — every transaction.
 *
 * 'custom' is deliberately absent: it needs two date inputs, and a shopkeeper
 * reaching for an exact range is the rare case. A custom range set from
 * elsewhere (a dashboard KPI tap) still displays correctly as its own chip;
 * it just is not offered here.
 */
const PERIODS: { id: DatePreset | 'all'; label: string }[] = [
  { id: 'all', label: 'All time' },
  { id: 'today', label: 'Today' },
  { id: 'yesterday', label: 'Yesterday' },
  { id: 'last7', label: 'Last 7 days' },
  { id: 'last30', label: 'Last 30 days' },
  { id: 'thisMonth', label: 'This month' },
  { id: 'lastMonth', label: 'Last month' },
  { id: 'thisQuarter', label: 'This quarter' },
  { id: 'thisYear', label: 'This year' },
]

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-2.5">
      <h3 className="text-2xs font-semibold uppercase tracking-wide text-muted-foreground">{title}</h3>
      {children}
    </section>
  )
}

/** A selectable pill. 44px tall so it is a real touch target, not a link. */
function Choice({
  active, onClick, children,
}: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        'flex items-center justify-center gap-1.5 min-h-[44px] px-3 rounded-xl text-sm font-medium transition border',
        active
          ? 'bg-primary text-primary-foreground border-primary'
          : 'bg-muted/50 text-foreground border-transparent hover:bg-muted',
      )}
    >
      {children}
    </button>
  )
}

export function LedgerFilterSheet({
  open, onOpenChange,
  sortBy, sortOrder, onToggleSort,
  dateRange, datePreset, onDateChange,
  viewMode, onViewMode,
  showVoided, onShowVoided,
  resultCount, onReset,
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
  sortBy: SortKey
  sortOrder: 'asc' | 'desc'
  onToggleSort: (k: SortKey) => void
  dateRange: DateRange | null
  datePreset: DatePreset
  onDateChange: (range: DateRange | null, preset: DatePreset) => void
  viewMode: 'grid' | 'list'
  onViewMode: (m: 'grid' | 'list') => void
  showVoided: boolean
  onShowVoided: (v: boolean) => void
  resultCount: number
  onReset: () => void
}) {
  const activePeriod: DatePreset | 'all' = dateRange ? datePreset : 'all'

  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent className="max-h-[88vh]">
        <DrawerHeader className="pb-2">
          <DrawerTitle>Filter &amp; sort</DrawerTitle>
          <DrawerDescription className="sr-only">
            Choose how the ledger is ordered, which period it covers, and how it is laid out.
          </DrawerDescription>
        </DrawerHeader>

        <div className="overflow-y-auto px-4 pb-2 space-y-5">
          <Section title="Sort by">
            <div className="grid grid-cols-2 gap-2">
              {SORT_OPTIONS.map(({ key, label, icon: Icon }) => (
                <Choice key={key} active={sortBy === key} onClick={() => onToggleSort(key)}>
                  <Icon className="w-4 h-4" />
                  {label}
                  {/* Only the active field shows a direction, and tapping it
                      again flips it — the same gesture as a column header. */}
                  {sortBy === key && <span aria-hidden>{sortOrder === 'asc' ? '↑' : '↓'}</span>}
                </Choice>
              ))}
            </div>
          </Section>

          <Section title="Period">
            <div className="grid grid-cols-2 gap-2">
              {PERIODS.map(({ id, label }) => (
                <Choice
                  key={id}
                  active={activePeriod === id}
                  onClick={() => {
                    if (id === 'all') onDateChange(null, 'thisMonth')
                    else onDateChange(getPresetRange(id as DatePreset), id as DatePreset)
                  }}
                >
                  {activePeriod === id && <Check className="w-3.5 h-3.5" />}
                  {label}
                </Choice>
              ))}
            </div>
          </Section>

          <Section title="Layout">
            <div className="grid grid-cols-2 gap-2">
              <Choice active={viewMode === 'grid'} onClick={() => onViewMode('grid')}>
                <LayoutGrid className="w-4 h-4" /> Cards
              </Choice>
              <Choice active={viewMode === 'list'} onClick={() => onViewMode('list')}>
                <List className="w-4 h-4" /> Compact
              </Choice>
            </div>
          </Section>

          <Section title="Deleted records">
            <label className="flex items-center justify-between gap-3 min-h-[44px] px-3 rounded-xl bg-muted/50 cursor-pointer">
              <span className="text-sm">
                Show voided
                <span className="block text-2xs text-muted-foreground">
                  Deleted entries, kept for your audit trail
                </span>
              </span>
              <Switch checked={showVoided} onCheckedChange={onShowVoided} />
            </label>
          </Section>
        </div>

        <DrawerFooter className="flex-row gap-2 pb-safe">
          <Button variant="outline" className="flex-1 min-h-[44px]" onClick={onReset}>
            Reset
          </Button>
          <Button className="flex-[2] min-h-[44px]" onClick={() => onOpenChange(false)}>
            Show {resultCount} {resultCount === 1 ? 'entry' : 'entries'}
          </Button>
        </DrawerFooter>
      </DrawerContent>
    </Drawer>
  )
}
