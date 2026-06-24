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
      const from = new Date(customFrom)
      const to = new Date(customTo)
      to.setHours(23, 59, 59, 999)
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
        size="sm"
        onClick={() => setOpen(!open)}
        className="gap-2 h-9 font-medium"
      >
        <Calendar className="w-3.5 h-3.5" />
        <span className="hidden sm:inline">{currentPresetLabel}</span>
        <span className="sm:hidden">Date</span>
        <ChevronDown className="w-3 h-3" />
      </Button>

      {open && (
        <div className={cn(
          'absolute top-full mt-2 z-50 bg-popover border border-border rounded-xl shadow-lg p-3 w-72',
          align === 'right' ? 'right-0' : 'left-0'
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
                <label className="text-[10px] uppercase text-muted-foreground font-medium">From</label>
                <Input
                  type="date"
                  value={customFrom}
                  onChange={(e) => setCustomFrom(e.target.value)}
                  className="h-8 mt-1"
                />
              </div>
              <div>
                <label className="text-[10px] uppercase text-muted-foreground font-medium">To</label>
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

          <div className="mt-3 pt-3 border-t border-border text-[11px] text-muted-foreground text-center">
            {formatDate(value.from)} — {formatDate(value.to)}
          </div>
        </div>
      )}
    </div>
  )
}
