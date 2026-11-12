'use client'

/**
 * 9b-4 (master plan 9b, "every due date from one place"; #106): the GST returns
 * due around today, on top of the Reports page's GST section. Overdue first,
 * then the next three — dates from lib/gst-due-dates.ts via /api/gst-due-dates,
 * by the shop's filing frequency and state. A tap opens the return on its month.
 */
import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { ChevronRight } from 'lucide-react'
import { offlineFetch } from '@/lib/offline-fetch'
import { haptic } from '@/lib/haptic'
import { cn } from '@/lib/utils'
import { useAppStore } from '@/store/app-store'
import { InfoHint } from '@/components/common/InfoHint'

interface DueRow { form: string; fp: string; day: string; status: 'overdue' | 'due'; daysLeft: number; basis: string }

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const QUARTER_FORMS = new Set(['CMP-08'])

/** "Oct 2026"; a quarter's return "Oct–Dec 2026"; GSTR-4 "FY 2025-26". */
export function periodLabel(form: string, fp: string, quarterly: boolean): string {
  const m = Number(fp.slice(0, 2))
  const y = Number(fp.slice(2))
  if (form === 'GSTR-4') return `FY ${y - 1}-${String(y).slice(2)}`
  if (QUARTER_FORMS.has(form) || (quarterly && (form === 'GSTR-1' || form === 'GSTR-3B'))) {
    return `${MONTHS[m - 3]}–${MONTHS[m - 1]} ${y}`
  }
  return `${MONTHS[m - 1]} ${y}`
}

/*
 * A past return the app has not seen marked filed says exactly that — never
 * "late". The app knows a filing only from "Mark as Filed"; a shop that files
 * on the portal and never marks it here may well be on time.
 */
function whenLabel(r: DueRow): string {
  if (r.status === 'overdue') return 'Not marked filed'
  if (r.daysLeft === 0) return 'Today'
  return `in ${r.daysLeft} ${r.daysLeft === 1 ? 'day' : 'days'}`
}

/** Past returns shown before "+N earlier" folds the rest. */
const PAST_SHOWN = 2

/** Which screen a due row opens. */
const REPORT_FOR: Record<string, string> = { 'GSTR-1': 'gstr-1', IFF: 'gstr-1', 'GSTR-3B': 'gstr-3b', 'PMT-06': 'gstr-3b', 'CMP-08': 'composition', 'GSTR-4': 'composition' }

export function GstDueDates() {
  const setPendingReportType = useAppStore((s) => s.setPendingReportType)
  const setPendingReportMonth = useAppStore((s) => s.setPendingReportMonth)
  const setView = useAppStore((s) => s.setView)
  const [showAll, setShowAll] = useState(false)
  const { data } = useQuery({
    queryKey: ['gst-due-dates'],
    queryFn: async () => {
      const r = await offlineFetch('/api/gst-due-dates')
      if (!r.ok) throw new Error('Could not load the due dates')
      return r.json() as Promise<{ status: string; frequency: string | null; items: DueRow[] }>
    },
  })
  if (!data || data.items.length === 0) return null
  const quarterly = data.frequency === 'quarterly'
  const past = data.items.filter((r) => r.status === 'overdue')
  const hidden = showAll ? 0 : Math.max(0, past.length - PAST_SHOWN)
  // The most recent past ones, then everything ahead.
  const rows = data.items.filter((r) => r.status !== 'overdue' || past.indexOf(r) >= hidden)

  const open = (r: DueRow) => {
    haptic.click()
    setPendingReportMonth(`${r.fp.slice(2)}-${r.fp.slice(0, 2)}`)
    setPendingReportType(REPORT_FOR[r.form] ?? 'gstr-3b')
    setView('reports')
  }

  return (
    <div className="rounded-2xl bg-card border border-border/60 shadow-card overflow-hidden" data-testid="gst-due-dates">
      <div className="flex items-center gap-1 px-3 pt-2.5 pb-1">
        <p className="text-sm font-semibold">Due dates</p>
        <InfoHint
          label="these due dates"
          text={`For a ${data.status === 'composition' ? 'composition' : quarterly ? 'quarterly (QRMP)' : 'monthly'} filer, by the GST rules, for the last three months and this one. A return counts as filed once you tap Mark as Filed on it. Monthly or quarterly: Settings → Shop profile.`}
        />
      </div>
      <ul className="divide-y divide-border/60">
        {hidden > 0 && (
          <li>
            <button
              type="button"
              onClick={() => setShowAll(true)}
              className="w-full min-h-12 px-3 py-2 text-left text-xs font-medium text-muted-foreground hover:bg-muted/40"
            >
              +{hidden} earlier not marked filed
            </button>
          </li>
        )}
        {rows.map((r) => {
          const day = new Date(`${r.day}T00:00:00`)
          return (
            <li key={`${r.form}|${r.fp}`}>
              <button
                type="button"
                onClick={() => open(r)}
                className="w-full min-h-12 flex items-center gap-3 px-3 py-2 text-left hover:bg-muted/40 active:bg-muted/60"
              >
                <span className="flex-1 min-w-0">
                  <span className="block text-sm font-medium leading-tight">
                    {r.form}{r.form === 'IFF' ? ' (optional)' : ''} · {periodLabel(r.form, r.fp, quarterly)}
                  </span>
                  <span className="block text-xs text-muted-foreground mt-0.5">
                    Due {day.getDate()} {MONTHS[day.getMonth()]}
                  </span>
                </span>
                <span className={cn(
                  'text-xs font-semibold tabular-nums px-2 py-0.5 rounded-full',
                  r.status === 'overdue' || r.daysLeft <= 3 ? 'bg-check-soft text-check' : 'text-muted-foreground',
                )}>
                  {whenLabel(r)}
                </span>
                <ChevronRight className="w-4 h-4 text-muted-foreground flex-shrink-0" aria-hidden />
              </button>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
