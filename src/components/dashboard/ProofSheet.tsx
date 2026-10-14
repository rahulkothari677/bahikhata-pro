'use client'

/**
 * ProofSheet — "how is this worked out?" for a number on Home (Phase 5b-1).
 *
 * Tap Today's sales, Profit, Net profit or Udhaar collected and this sheet
 * shows the lines that make the number, a total that matches it, one
 * comparison, and a button to the records themselves. Hard rule: every figure
 * shows receipts.
 *
 * The lines come from /api/dashboard/explain (or, for Cash in drawer, the
 * day-summary route the Close-the-day sheet uses) through the builders in
 * lib/proof-sheets.ts, which guarantee they add up. When the sheet's fresh
 * total differs from the number on the card (a sale landed in between), Home
 * is refreshed so the two agree again.
 *
 * Same slide-up panel as the + sheet; centred and narrower on a computer.
 */
import { useEffect } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from '@/components/ui/sheet'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { offlineFetch } from '@/lib/offline-fetch'
import { formatINR } from '@/lib/utils'
import { drawerProof, PROOF_MODES, type DrawerTerms, type ProofRow } from '@/lib/proof-sheets'
import { useTranslation } from '@/hooks/use-translation'

export type ProofSpec =
  | { kind: 'explain'; metric: 'sales' | 'profit' | 'netProfit' | 'got'; scope: 'today' | 'range'; from?: Date; to?: Date; titleKey: string; periodLabel?: string; shown?: number }
  | { kind: 'drawer'; titleKey: string; shown?: number }

export interface ProofAction { label: string; onClick: () => void }

interface ProofData {
  total: number
  rows: ProofRow[]
  count?: number
  compare?: { key: string; amount: number } | null
}

/** The explain route's address for a spec (exported for the guard). */
export function proofUrl(spec: Extract<ProofSpec, { kind: 'explain' }>): string {
  const q = new URLSearchParams({ metric: spec.metric, scope: spec.scope })
  if (spec.scope === 'range' && spec.from && spec.to) {
    q.set('from', spec.from.toISOString())
    q.set('to', spec.to.toISOString())
  }
  return `/api/dashboard/explain?${q.toString()}`
}

/** A line's words: its key translated (placeholders filled), or its plain label, plus the payment mode. */
export function proofRowLabel(r: ProofRow, t: (k: string) => string, showsGst: boolean): string {
  let s = r.key ? t(r.key === 'proof.net_sales' && showsGst ? 'proof.net_sales_gst' : r.key) : (r.label ?? '')
  for (const [k, v] of Object.entries(r.params ?? {})) s = s.replace(`{${k}}`, String(v))
  if (r.mode) s += ` · ${t(`proof.mode_${(PROOF_MODES as readonly string[]).includes(r.mode) ? r.mode : 'other'}`)}`
  return s
}

/** "1 bill" / "12 bills" (payments for the collected sheet). Exported for the guard. */
export function proofCountLine(n: number, payments: boolean, t: (k: string) => string): string {
  const key = payments ? (n === 1 ? 'proof.payments_one' : 'proof.payments_n') : (n === 1 ? 'proof.bills_one' : 'proof.bills_n')
  return t(key).replace('{n}', String(n))
}

export function ProofSheet({ spec, onClose, actions = [], showsGst }: {
  spec: ProofSpec | null
  onClose: () => void
  actions?: ProofAction[]
  showsGst: boolean
}) {
  const { t, language } = useTranslation()
  const queryClient = useQueryClient()
  const url = spec?.kind === 'explain' ? proofUrl(spec) : '/api/day-summary'

  const { data, isLoading, isError, refetch } = useQuery({
    // The drawer shares the Close-the-day sheet's cache: one fetch, one answer.
    queryKey: spec?.kind === 'drawer' ? ['day-summary'] : ['proof', url],
    enabled: !!spec,
    staleTime: 0,
    queryFn: async () => {
      const r = await offlineFetch(url)
      if (!r.ok) throw new Error(`proof ${r.status}`)
      return r.json()
    },
  })
  const proof: ProofData | undefined = !data ? undefined
    : spec?.kind === 'drawer' ? drawerProof(data as DrawerTerms) : (data as ProofData)

  // A sale saved between Home's load and this sheet makes the two differ: refresh Home.
  const shown = spec?.shown
  const total = proof?.total
  useEffect(() => {
    if (shown === undefined || total === undefined) return
    if (Math.round(shown * 100) !== Math.round(total * 100)) queryClient.invalidateQueries({ queryKey: ['dashboard'] })
  }, [shown, total, queryClient])

  if (!spec) return null

  const lastWeekDay = new Intl.DateTimeFormat(language === 'hi' ? 'hi-IN' : 'en-IN', { weekday: 'long', timeZone: 'Asia/Kolkata' })
    .format(new Date(Date.now() - 7 * 86_400_000))
  const compareLabel = proof?.compare ? t(proof.compare.key).replace('{day}', lastWeekDay) : ''
  const countLine = proof?.count == null ? '' : proofCountLine(proof.count, spec.kind === 'explain' && spec.metric === 'got', t)
  const note = spec.kind === 'drawer' ? t('proof.drawer_note')
    : spec.metric === 'profit' ? t('proof.profit_note') : ''

  return (
    <Sheet open onOpenChange={(o) => { if (!o) onClose() }}>
      <SheetContent
        side="bottom"
        className="rounded-t-3xl max-h-[88vh] overflow-y-auto gap-0 pb-[calc(1rem+var(--safe-bottom))] lg:mx-auto lg:max-w-lg"
      >
        <SheetHeader className="pb-1">
          <SheetTitle className="text-lg">{t(spec.titleKey)}</SheetTitle>
          <SheetDescription className="text-xs">
            {spec.kind === 'explain' && spec.periodLabel ? `${spec.periodLabel} · ` : ''}{t('proof.title_how')}
          </SheetDescription>
        </SheetHeader>

        <div className="px-4 space-y-3">
          {isLoading && (
            <div className="space-y-2" aria-label={t('proof.loading')}>
              <Skeleton className="h-9 w-40" />
              <Skeleton className="h-28 w-full rounded-2xl" />
            </div>
          )}

          {isError && !proof && (
            <div className="flex items-center justify-between gap-3 rounded-2xl bg-muted p-3 text-sm">
              <span>{t('proof.error')}</span>
              <Button variant="outline" onClick={() => refetch()}>{t('proof.retry')}</Button>
            </div>
          )}

          {proof && (
            <>
              <div>
                <p className="text-3xl font-bold tabular-nums">{formatINR(proof.total)}</p>
                {countLine && <p className="text-xs text-muted-foreground">{countLine}</p>}
              </div>

              <ul className="rounded-2xl border border-border divide-y divide-border overflow-hidden">
                {proof.rows.map((r, i) => (
                  <li key={i} className="flex items-center justify-between gap-3 px-3 py-2.5 text-sm">
                    <span className="min-w-0 break-words">{proofRowLabel(r, t, showsGst)}</span>
                    <span className="tabular-nums font-semibold whitespace-nowrap">
                      {r.amount < 0 ? '− ' : ''}{formatINR(Math.abs(r.amount))}
                    </span>
                  </li>
                ))}
                <li className="flex items-center justify-between gap-3 px-3 py-2.5 text-sm font-bold bg-muted/60">
                  <span>{t('proof.total')}</span>
                  <span className="tabular-nums whitespace-nowrap">{formatINR(proof.total)}</span>
                </li>
              </ul>

              {proof.compare && (
                <p className="text-sm text-muted-foreground">
                  {compareLabel}: <span className="font-semibold text-foreground tabular-nums">{formatINR(proof.compare.amount)}</span>
                </p>
              )}
              {note && <p className="text-xs text-muted-foreground">{note}</p>}

              {actions.length > 0 && (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-1">
                  {actions.map((a) => (
                    <Button key={a.label} variant="outline" className="min-h-12" onClick={() => { onClose(); a.onClick() }}>
                      {a.label}
                    </Button>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      </SheetContent>
    </Sheet>
  )
}
