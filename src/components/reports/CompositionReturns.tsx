'use client'

/**
 * The two returns a composition dealer actually files.
 *
 * WHY THIS EXISTS (2026-08-09). CMP-08 and GSTR-4 were computed correctly and
 * could not be reached: no screen, no menu entry. A composition dealer opening
 * the app saw the five regular-scheme reports and nothing of their own — so the
 * engine may as well not have been built. That is the fourth time in this
 * codebase that a correct calculation shipped with no surface.
 *
 * It also fixes something worse than an omission. A composition dealer was
 * being OFFERED GSTR-1 and GSTR-3B, which are not their forms. Showing someone
 * the wrong return is more harmful than showing none.
 */

import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { AlertTriangle, CalendarDays, Loader2 } from 'lucide-react'
import { offlineFetch } from '@/lib/offline-fetch'
import { formatINR } from '@/lib/utils'

/** The financial year a date falls in — April to March. */
function currentFy(d = new Date()) {
  const y = d.getMonth() >= 3 ? d.getFullYear() : d.getFullYear() - 1
  return `${y}-${String((y + 1) % 100).padStart(2, '0')}`
}
function currentQuarter(d = new Date()) {
  const y = d.getMonth() >= 3 ? d.getFullYear() : d.getFullYear() - 1
  const q = Math.floor(((d.getMonth() + 9) % 12) / 3) + 1
  return `${y}-Q${q}`
}

/* Defined at module scope: a component created inside render is a new type on
   every pass, which remounts its subtree and loses state. */
function Row({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-3 text-sm">
      <span className={strong ? 'font-semibold' : 'text-muted-foreground'}>{label}</span>
      <span className={`tabular-nums ${strong ? 'font-bold' : 'font-medium'}`}>{value}</span>
    </div>
  )
}

export function CompositionReturns() {
  const [quarter] = useState(currentQuarter())
  const [fy] = useState(currentFy())

  const cmp = useQuery({
    queryKey: ['cmp-08', quarter],
    queryFn: async () => (await offlineFetch(`/api/cmp-08?quarter=${quarter}`)).json(),
  })
  const annual = useQuery({
    queryKey: ['gstr-4', fy],
    queryFn: async () => (await offlineFetch(`/api/gstr-4?fy=${fy}`)).json(),
  })

  if (cmp.isLoading || annual.isLoading) {
    return <div className="py-16 flex justify-center"><Loader2 className="w-5 h-5 animate-spin text-muted-foreground" /></div>
  }

  const c = cmp.data
  const a = annual.data
  const notComposition = c?.error || a?.error

  if (notComposition) {
    return (
      <div className="rounded-2xl border border-border/60 bg-muted/30 p-4">
        <p className="text-sm font-medium">These returns are for composition dealers</p>
        <p className="text-xs text-muted-foreground mt-1">
          Your shop is on the regular scheme, so you file GSTR-1 and GSTR-3B instead. You can change
          this in Account → Feature Toggles if you have opted into the composition scheme.
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {/* CMP-08 — the quarterly payment */}
      <div className="rounded-2xl border border-border/60 bg-card shadow-card overflow-hidden">
        <div className="px-4 py-3 border-b border-border/60">
          <p className="font-semibold text-sm">CMP-08 · {c?.quarter}</p>
          <p className="text-2xs text-muted-foreground mt-0.5 flex items-center gap-1">
            <CalendarDays className="w-3 h-3" />
            Due {c?.dueDate ? new Date(c.dueDate).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '—'}
            {' · '}{c?.categoryLabel} · {c?.rate}% of turnover
          </p>
        </div>
        <div className="p-4 space-y-2">
          <Row label="Turnover this quarter" value={formatINR(c?.turnover || 0)} />
          <Row label="CGST" value={formatINR(c?.cgst || 0)} />
          <Row label="SGST" value={formatINR(c?.sgst || 0)} />
          <div className="pt-2 border-t border-border/60">
            <Row label="Tax to pay" value={formatINR(c?.total || 0)} strong />
          </div>
          <p className="text-2xs text-muted-foreground pt-1">
            You pay this from your own margin — your bills carry no GST.
          </p>
        </div>
      </div>

      {/* GSTR-4 — the annual return */}
      <div className="rounded-2xl border border-border/60 bg-card shadow-card overflow-hidden">
        <div className="px-4 py-3 border-b border-border/60">
          <p className="font-semibold text-sm">GSTR-4 · {a?.fy}</p>
          <p className="text-2xs text-muted-foreground mt-0.5 flex items-center gap-1">
            <CalendarDays className="w-3 h-3" />
            Due {a?.dueDate ? new Date(a.dueDate).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '—'}
          </p>
        </div>
        <div className="p-4 space-y-2">
          <Row label="Year's turnover (Table 6)" value={formatINR(a?.table6?.turnover || 0)} />
          <Row label="Tax on it" value={formatINR(a?.table6?.total || 0)} />
          <Row label="Reverse charge purchases" value={formatINR(a?.table4RcmInward?.tax || 0)} />
          <Row label="Already paid in CMP-08" value={`− ${formatINR(a?.table5PaidViaCmp08?.total || 0)}`} />
          <div className="pt-2 border-t border-border/60">
            <Row label="Still to pay" value={formatINR(a?.netPayable || 0)} strong />
          </div>
        </div>

        {/*
          * The single most expensive mistake available on this form, stated
          * where it will be read. A dealer looking at a small "still to pay"
          * figure is exactly the one tempted to leave Table 6 empty.
          */}
        <div className="px-4 py-3 bg-amber-50 dark:bg-amber-950/30 border-t border-amber-200 dark:border-amber-900 flex items-start gap-2">
          <AlertTriangle className="w-4 h-4 text-amber-600 dark:text-amber-400 flex-shrink-0 mt-0.5" />
          <p className="text-2xs text-amber-800 dark:text-amber-300">
            <b>Do not leave the turnover box empty</b> because you have already paid each quarter.
            The portal then treats everything you paid as excess, and months later sends a demand
            for tax you paid on time. Enter {formatINR(a?.table6?.turnover || 0)}.
          </p>
        </div>
      </div>
    </div>
  )
}
