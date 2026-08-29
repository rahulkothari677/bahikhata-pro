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
import { AlertTriangle, CalendarDays, Info, Loader2 } from 'lucide-react'
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

/**
 * A date from the API, as a day a shopkeeper would say out loud.
 *
 * `shiftDays` exists because every period end from the API is EXCLUSIVE — the
 * first instant NOT covered. Printing it raw would name the day after the last
 * day included, and on a split quarter that is precisely the boundary in
 * dispute. Callers showing "up to X" pass -1 and get the last day that IS
 * covered. Returns '' rather than "Invalid Date" so a missing field degrades
 * to a gap instead of shouting.
 */
function fmtDay(iso?: string | null, shiftDays = 0): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  if (shiftDays) d.setDate(d.getDate() + shiftDays)
  return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })
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
    /*
     * Two different refusals used to print the same sentence.
     *
     * "You are on the regular scheme" is right for a shop that never opted in.
     * It is WRONG, and misleading, for a composition dealer who left part-way
     * through the year: that shop IS a composition dealer, just not for the
     * quarter being asked about, and telling it to go and opt in sends it to
     * change a setting that is already correct.
     *
     * The API distinguishes the two and writes the reason. Preferring its
     * `message` is the same rule as refusing WITH the reason on the way in —
     * a refusal that does not say why gets read as the app being limited.
     */
    const apiMessage = c?.message || a?.message
    return (
      <div className="rounded-2xl border border-border/60 bg-muted/30 p-4">
        <p className="text-sm font-medium">
          {apiMessage ? 'No CMP-08 for this quarter' : 'These returns are for composition dealers'}
        </p>
        <p className="text-xs text-muted-foreground mt-1">
          {apiMessage || (
            <>
              {/*
                * This used to say "Account → Feature Toggles". The composition
                * scheme is not there and never was: those toggles are display
                * switches, while this is a legal status that changes the tax
                * rate and which returns exist. It sits with e-invoicing in the
                * tax settings. A pointer to the wrong screen is worse than
                * none — the shopkeeper looks, finds nothing, and concludes the
                * app cannot do it.
                */}
              Your shop is on the regular scheme, so you file GSTR-1 and GSTR-3B instead. If you have
              opted in with form CMP-02, turn on the composition scheme in Settings → Invoice &amp; Tax.
            </>
          )}
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
          {/*
            * The label states the period it ACTUALLY covers. "Turnover this
            * quarter" is a lie on a split quarter, and it is the kind of lie
            * that reconciles — the reader checks the figure against three
            * months of sales, finds it short, and distrusts the app rather
            * than reading further.
            */}
          <Row
            label={c?.leftMidQuarter ? `Turnover up to ${fmtDay(c?.period?.to, -1)}` : 'Turnover this quarter'}
            value={formatINR(c?.turnover || 0)}
          />
          <Row label="CGST" value={formatINR(c?.cgst || 0)} />
          <Row label="SGST" value={formatINR(c?.sgst || 0)} />
          <div className="pt-2 border-t border-border/60">
            <Row label="Tax to pay" value={formatINR(c?.total || 0)} strong />
          </div>
          <p className="text-2xs text-muted-foreground pt-1">
            You pay this from your own margin — your bills carry no GST.
          </p>
        </div>

        {/*
          * THE SPLIT QUARTER (#42). Crossing the turnover limit ends
          * composition on the crossing day itself, so this CMP-08 can cover
          * six weeks of a thirteen-week quarter. Without this panel the only
          * visible symptom is a number that looks too small.
          *
          * Blue, not amber. Nothing has gone wrong and nothing is overdue —
          * the shop grew past the scheme. An alarm colour here would read as
          * "you have a problem", and the one real risk is the opposite
          * mistake: assuming the rest of the quarter needs no return at all.
          */}
        {c?.leftMidQuarter && (
          <div className="px-4 py-3 bg-blue-50 dark:bg-blue-950/30 border-t border-blue-200 dark:border-blue-900 flex items-start gap-2">
            <Info className="w-4 h-4 text-blue-600 dark:text-blue-400 flex-shrink-0 mt-0.5" />
            <div className="text-2xs text-blue-800 dark:text-blue-300 space-y-1">
              <p>{c.splitNote}</p>
              {c.regularPeriod && (
                <p>
                  <b>{fmtDay(c.regularPeriod.from)} to {fmtDay(c.regularPeriod.to, -1)}</b> is on the
                  regular scheme. That part goes in GSTR-1 and GSTR-3B, not here — it is not missing,
                  it is on a different form.
                </p>
              )}
            </div>
          </div>
        )}
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
          {/* Same rule as the quarterly card: name the period the figure
              actually covers, so a shopkeeper checking it against a full
              year's sales is not left thinking the total is short. */}
          <Row
            label={a?.leftMidYear ? `Turnover up to ${fmtDay(a?.period?.to, -1)} (Table 6)` : "Year's turnover (Table 6)"}
            value={formatINR(a?.table6?.turnover || 0)}
          />
          <Row label="Tax on it" value={formatINR(a?.table6?.total || 0)} />
          <Row label="Reverse charge purchases" value={formatINR(a?.table4RcmInward?.tax || 0)} />
          <Row label="Already paid in CMP-08" value={`− ${formatINR(a?.table5PaidViaCmp08?.total || 0)}`} />
          <div className="pt-2 border-t border-border/60">
            <Row label="Still to pay" value={formatINR(a?.netPayable || 0)} strong />
          </div>
        </div>

        {/*
          * A year that ended early, said on the annual return too (#42).
          * Table 6 asks for the year's outward supplies, and a dealer who left
          * in August must declare only the part while on the scheme — putting
          * the full year in would declare sales that already carried regular
          * GST. Without this the figure simply looks wrong against their books.
          */}
        {a?.leftMidYear && (
          <div className="px-4 py-3 bg-blue-50 dark:bg-blue-950/30 border-t border-blue-200 dark:border-blue-900 flex items-start gap-2">
            <Info className="w-4 h-4 text-blue-600 dark:text-blue-400 flex-shrink-0 mt-0.5" />
            <p className="text-2xs text-blue-800 dark:text-blue-300">
              You were on the composition scheme for part of this year only, so Table 6 covers your
              sales up to {fmtDay(a?.period?.to, -1)}. Do not enter the whole year here — the rest
              was on the regular scheme and is already declared in GSTR-1 and GSTR-3B.
            </p>
          </div>
        )}

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
