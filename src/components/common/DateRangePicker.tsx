'use client'

import { useState, useRef, useEffect } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Calendar, ChevronDown, X } from 'lucide-react'
import { cn, formatDate } from '@/lib/utils'

export type DateRange = {
  from: Date
  to: Date
}

export type DatePreset = 'today' | 'yesterday' | 'last7' | 'last30' | 'thisMonth' | 'lastMonth' | 'thisQuarter' | 'thisYear' | 'custom'

const PRESETS: { id: DatePreset; label: string; getDescription: () => { from: Date; to: Date } }[] = [
  {
    id: 'today',
    label: 'Today',
    getDescription: () => {
      const d = new Date()
      d.setHours(0, 0, 0, 0)
      return { from: d, to: new Date() }
    },
  },
  {
    id: 'yesterday',
    label: 'Yesterday',
    getDescription: () => {
      const d = new Date()
      d.setDate(d.getDate() - 1)
      d.setHours(0, 0, 0, 0)
      const to = new Date(d)
      to.setHours(23, 59, 59, 999)
      return { from: d, to }
    },
  },
  {
    id: 'last7',
    label: 'Last 7 Days',
    getDescription: () => {
      const to = new Date()
      const from = new Date()
      from.setDate(from.getDate() - 6)
      from.setHours(0, 0, 0, 0)
      return { from, to }
    },
  },
  {
    id: 'last30',
    label: 'Last 30 Days',
    getDescription: () => {
      const to = new Date()
      const from = new Date()
      from.setDate(from.getDate() - 29)
      from.setHours(0, 0, 0, 0)
      return { from, to }
    },
  },
  {
    id: 'thisMonth',
    label: 'This Month',
    getDescription: () => {
      const now = new Date()
      return { from: new Date(now.getFullYear(), now.getMonth(), 1), to: now }
    },
  },
  {
    id: 'lastMonth',
    label: 'Last Month',
    getDescription: () => {
      const now = new Date()
      return {
        from: new Date(now.getFullYear(), now.getMonth() - 1, 1),
        to: new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59),
      }
    },
  },
  {
    id: 'thisQuarter',
    label: 'This Quarter',
    getDescription: () => {
      const now = new Date()
      const q = Math.floor(now.getMonth() / 3)
      return { from: new Date(now.getFullYear(), q * 3, 1), to: now }
    },
  },
  {
    id: 'thisYear',
    label: 'This Year',
    getDescription: () => {
      const now = new Date()
      return { from: new Date(now.getFullYear(), 0, 1), to: now }
    },
  },
]

export function getPresetRange(preset: DatePreset): DateRange {
  if (preset === 'custom') {
    const now = new Date()
    return { from: new Date(now.getFullYear(), now.getMonth(), 1), to: now }
  }
  return PRESETS.find(p => p.id === preset)!.getDescription()
}

export function getPresetLabel(preset: DatePreset): string {
  return PRESETS.find(p => p.id === preset)?.label || 'Custom'
}

export function DateRangePicker({
  value,
  onChange,
  preset,
  onPresetChange,
  className,
  align = 'left',
}: {
  value: DateRange
  onChange: (range: DateRange, preset: DatePreset) => void
  preset: DatePreset
  onPresetChange: (preset: DatePreset) => void
  className?: string
  align?: 'left' | 'right'
}) {
  const [open, setOpen] = useState(false)
  const [customFrom, setCustomFrom] = useState('')
  const [customTo, setCustomTo] = useState('')
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  const handlePreset = (p: DatePreset) => {
    onPresetChange(p)
    if (p !== 'custom') {
      const range = getPresetRange(p)
      onChange(range, p)
      setOpen(false)
    }
  }

  const handleCustomApply = () => {
    if (customFrom && customTo) {
      // 🔒 FIX L8: Was `new Date(customFrom)` — the single-string constructor
      // ("YYYY-MM-DD") always parses as UTC midnight = 5:30 AM IST. The `to`
      // was set via setHours (local = IST). This asymmetry meant the first
      // ~5.5 hours of the "from" day were silently excluded.
      // Now: parse via split + local constructor so both are IST midnight/23:59.
      const [fy, fm, fd] = customFrom.split('-').map(Number)
      const [ty, tm, td] = customTo.split('-').map(Number)
      const from = new Date(fy, fm - 1, fd, 0, 0, 0, 0)
      const to = new Date(ty, tm - 1, td, 23, 59, 59, 999)
      onChange({ from, to }, 'custom')
      onPresetChange('custom')
      setOpen(false)
    }
  }

  const currentPresetLabel = getPresetLabel(preset)

  return (
    <div className={cn('relative', className)} ref={ref}>
      <Button
        variant="outline"
        size="touch"
        onClick={() => setOpen(!open)}
        className="gap-2 font-medium lg:h-9"
      >
        <Calendar className="w-4 h-4 lg:w-3.5 lg:h-3.5" />
        <span className="hidden sm:inline">{currentPresetLabel}</span>
        <span className="sm:hidden">Date</span>
        <ChevronDown className="w-3.5 h-3.5 lg:w-3 lg:h-3" />
      </Button>

      {open && (
        <>
        {/* 🔒 FIX M8: Mobile backdrop — was missing. The tap that closes the
            picker could also fire a click on the underlying row (e.g., a Ledger
            row), navigating away unintentionally. The scrim intercepts the tap. */}
        <div
          className="fixed inset-0 bg-black/40 z-40 sm:hidden"
          onClick={() => setOpen(false)}
        />
        <div className={cn(
          'fixed sm:absolute z-50 bg-popover border border-border rounded-xl shadow-lg p-3 w-[calc(100vw-2rem)] sm:w-72 max-h-[80vh] overflow-y-auto',
          'top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 sm:translate-x-0 sm:translate-y-0 sm:top-full sm:left-auto sm:mt-2',
          align === 'right' ? 'sm:right-0' : 'sm:left-0'
        )}>
          <div className="space-y-1">
            {PRESETS.map(p => (
              <button
                key={p.id}
                onClick={() => handlePreset(p.id)}
                className={cn(
                  'w-full text-left px-3 py-2 rounded-lg text-sm transition',
                  preset === p.id
                    ? 'bg-primary text-primary-foreground font-medium'
                    : 'hover:bg-muted'
                )}
              >
                {p.label}
              </button>
            ))}
            <button
              onClick={() => { onPresetChange('custom') }}
              className={cn(
                'w-full text-left px-3 py-2 rounded-lg text-sm transition',
                preset === 'custom' ? 'bg-primary text-primary-foreground font-medium' : 'hover:bg-muted'
              )}
            >
              Custom Range
            </button>
          </div>

          {preset === 'custom' && (
            <div className="mt-3 pt-3 border-t border-border space-y-2">
              <div>
                <label className="text-3xs uppercase text-muted-foreground font-medium">From</label>
                <Input
                  type="date"
                  value={customFrom}
                  onChange={(e) => setCustomFrom(e.target.value)}
                  className="h-8 mt-1"
                />
              </div>
              <div>
                <label className="text-3xs uppercase text-muted-foreground font-medium">To</label>
                <Input
                  type="date"
                  value={customTo}
                  onChange={(e) => setCustomTo(e.target.value)}
                  className="h-8 mt-1"
                />
              </div>
              <Button
                size="sm"
                className="w-full bg-gradient-saffron mt-1"
                onClick={handleCustomApply}
                disabled={!customFrom || !customTo}
              >
                Apply Range
              </Button>
            </div>
          )}

          <div className="mt-3 pt-3 border-t border-border text-2xs text-muted-foreground text-center">
            {formatDate(value.from)} — {formatDate(value.to)}
          </div>
        </div>
        </>
      )}
    </div>
  )
}
