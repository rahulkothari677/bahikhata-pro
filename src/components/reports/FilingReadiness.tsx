'use client'

/**
 * "Am I ready to file?" — one card, one answer.
 *
 * WHY (2026-08-08). The GST screens had grown four separate warning boxes in
 * two days. Each was correct and each was added beside the last, and stacked
 * they read as an app in trouble rather than a shop with two small things to
 * check. A shopkeeper could not tell which of them stopped them filing.
 *
 * A pile of warnings is not a design. It is what happens when findings get
 * appended instead of composed.
 *
 * DESIGN RULES THIS FOLLOWS:
 *
 *  - CALM WHEN FINE. Clean months are the common case and should feel like it:
 *    a single green line, no list, nothing to read. An app that shouts every
 *    month teaches the shopkeeper to ignore it, and then it cannot warn them
 *    when it matters.
 *  - SEVERITY IS VISIBLE BEFORE THE TEXT. Colour and icon say "stop", "check"
 *    or "for your information" at a glance, so the eye triages before reading.
 *  - INFORMATION IS NOT A WARNING. Credit held back under Rule 36(4) is the law
 *    working correctly. In amber beside a real error it taught shopkeepers to
 *    distrust a right answer.
 *  - EVERY PROBLEM HAS A DOOR. A finding without an action is a complaint.
 *  - PLAIN WORDS. "2 sales are missing an HSN code", not "Table 12 incomplete".
 */

import { useQuery } from '@tanstack/react-query'
import { CheckCircle2, AlertCircle, Info, ChevronRight, ShieldCheck } from 'lucide-react'
import { offlineFetch } from '@/lib/offline-fetch'
import { formatINR, cn } from '@/lib/utils'
import { useAppStore } from '@/store/app-store'

interface Check {
  id: string
  severity: 'blocker' | 'warn' | 'info' | 'ok'
  title: string
  detail: string
  amount?: number
  action?: { label: string; view: string }
}

/** Colour, icon and label for a severity. Kept in one place so the three
 *  states cannot drift apart visually the way the old boxes did. */
const TONE = {
  blocker: {
    icon: AlertCircle,
    ring: 'border-rose-200 dark:border-rose-900',
    bg: 'bg-rose-50 dark:bg-rose-950/30',
    fg: 'text-rose-600 dark:text-rose-400',
  },
  warn: {
    icon: AlertCircle,
    ring: 'border-amber-200 dark:border-amber-900',
    bg: 'bg-amber-50 dark:bg-amber-950/30',
    fg: 'text-amber-600 dark:text-amber-400',
  },
  info: {
    icon: Info,
    ring: 'border-border/60',
    bg: 'bg-muted/40',
    fg: 'text-muted-foreground',
  },
  ok: {
    icon: CheckCircle2,
    ring: 'border-border/60',
    bg: 'bg-muted/30',
    fg: 'text-emerald-600 dark:text-emerald-400',
  },
} as const

export function FilingReadiness({ from, to }: { from: Date; to: Date }) {
  const setView = useAppStore((s) => s.setView)

  const { data, isLoading } = useQuery({
    queryKey: ['gst-readiness', from.toISOString(), to.toISOString()],
    queryFn: async () => {
      const r = await offlineFetch(`/api/gst-readiness?from=${from.toISOString()}&to=${to.toISOString()}`)
      if (!r.ok) throw new Error('Could not check')
      return r.json()
    },
    staleTime: 60 * 1000,
  })

  // No skeleton: this sits above a report that has its own. A second shimmer
  // would make one screen look like two loading things.
  if (isLoading || !data) return null

  const checks: Check[] = data.checks || []
  const problems = checks.filter((c) => c.severity === 'blocker' || c.severity === 'warn')
  const notes = checks.filter((c) => c.severity === 'info')

  /*
   * The calm state. Everything passed, so say so in one line and stop talking.
   * Listing four green ticks would be the same wall of boxes in a nicer colour.
   */
  if (problems.length === 0 && notes.length === 0) {
    return (
      <div className="rounded-2xl border border-emerald-200 dark:border-emerald-900 bg-emerald-50 dark:bg-emerald-950/30 p-4 flex items-center gap-3">
        <ShieldCheck className="w-5 h-5 text-emerald-600 dark:text-emerald-400 flex-shrink-0" />
        <div className="min-w-0">
          <p className="font-semibold text-emerald-900 dark:text-emerald-200 text-sm">Ready to file</p>
          <p className="text-xs text-emerald-800 dark:text-emerald-300 mt-0.5">
            Nothing missing. Your figures add up and every sale is coded.
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="rounded-2xl border border-border/60 bg-card shadow-card overflow-hidden">
      {/* One headline that answers the question before any detail. */}
      <div className={cn(
        'px-4 py-3 border-b border-border/60 flex items-center gap-3',
        data.ready ? 'bg-amber-50 dark:bg-amber-950/30' : 'bg-rose-50 dark:bg-rose-950/30',
      )}>
        {data.ready
          ? <AlertCircle className="w-5 h-5 text-amber-600 dark:text-amber-400 flex-shrink-0" />
          : <AlertCircle className="w-5 h-5 text-rose-600 dark:text-rose-400 flex-shrink-0" />}
        <div className="min-w-0">
          <p className="font-semibold text-sm">
            {data.ready
              ? `You can file — ${problems.length} thing${problems.length === 1 ? '' : 's'} worth checking`
              : `Fix ${data.blockers} thing${data.blockers === 1 ? '' : 's'} before filing`}
          </p>
          <p className="text-2xs text-muted-foreground mt-0.5">
            {data.ready
              ? 'Nothing here stops you filing, but each one is a risk you should know about.'
              : 'Your return would be wrong or incomplete as it stands.'}
          </p>
        </div>
      </div>

      <div className="divide-y divide-border/60">
        {problems.map((c) => {
          const tone = TONE[c.severity]
          const Icon = tone.icon
          return (
            <div key={c.id} className="px-4 py-3 flex items-start gap-3">
              <Icon className={cn('w-4 h-4 flex-shrink-0 mt-0.5', tone.fg)} />
              <div className="min-w-0 flex-1">
                <div className="flex items-baseline justify-between gap-3">
                  <p className="text-sm font-medium">{c.title}</p>
                  {c.amount !== undefined && c.amount > 0 && (
                    <span className="text-sm font-semibold tabular-nums flex-shrink-0">{formatINR(c.amount)}</span>
                  )}
                </div>
                <p className="text-xs text-muted-foreground mt-0.5">{c.detail}</p>
                {c.action && (
                  <button
                    onClick={() => setView(c.action!.view as never)}
                    className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
                  >
                    {c.action.label}
                    <ChevronRight className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
            </div>
          )
        })}

        {/*
          * Notes sit below problems and are visually quieter. They are correct
          * outcomes a shopkeeper should know about — not things to fix — and
          * mixing them in amber with real problems is what made the old screen
          * feel alarming.
          */}
        {notes.map((c) => (
          <div key={c.id} className="px-4 py-3 flex items-start gap-3 bg-muted/20">
            <Info className="w-4 h-4 flex-shrink-0 mt-0.5 text-muted-foreground" />
            <div className="min-w-0 flex-1">
              <div className="flex items-baseline justify-between gap-3">
                <p className="text-sm text-muted-foreground">{c.title}</p>
                {c.amount !== undefined && c.amount > 0 && (
                  <span className="text-sm font-medium tabular-nums text-muted-foreground flex-shrink-0">
                    {formatINR(c.amount)}
                  </span>
                )}
              </div>
              <p className="text-xs text-muted-foreground mt-0.5">{c.detail}</p>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
