'use client'

/**
 * "Your two returns agree" — stated plainly, because almost nobody can say it.
 *
 * WHY THIS IS ON SCREEN. A GSTR-1 vs GSTR-3B mismatch is the single most common
 * reason a shop receives a notice, and it is the first thing a CA checks when
 * they open a client's books. This app can now answer it honestly. Leaving that
 * answer buried in two separate reports means the shopkeeper never knows, and
 * the CA does the comparison by hand — which is the work this should remove.
 *
 * IT IS NOT AN EQUALITY CHECK. The two returns are not supposed to be identical:
 * advances live in their own GSTR-1 tables but inside 3.1(a) of GSTR-3B, and
 * nil/exempt supplies are split differently again. A card that demanded equality
 * would show a red warning on correct books every month, and a warning that is
 * usually wrong gets ignored — so it could not help on the month it was right.
 *
 * So the differences are LISTED AND EXPLAINED rather than hidden. A CA can see
 * the workings and tick them off; a shopkeeper sees a green line and moves on.
 */

import { useQuery } from '@tanstack/react-query'
import { CheckCircle2, AlertTriangle, ArrowRight } from 'lucide-react'
import { offlineFetch } from '@/lib/offline-fetch'
import { formatINR } from '@/lib/utils'

export function ReturnsAgree({ month }: { month: string }) {
  const { data, isLoading } = useQuery({
    queryKey: ['gst-reconciliation', month],
    queryFn: async () => {
      const r = await offlineFetch(`/api/gst-reconciliation?month=${month}`)
      if (!r.ok) throw new Error('Could not compare the returns')
      return r.json()
    },
    staleTime: 60 * 1000,
  })

  // Silent while loading: this sits among reports that have their own skeletons.
  if (isLoading || !data) return null

  const items = data.reconcilingItems || []

  if (!data.matched) {
    return (
      <div className="rounded-2xl border border-rose-200 dark:border-rose-900 bg-rose-50 dark:bg-rose-950/30 p-4">
        <div className="flex items-start gap-3">
          <AlertTriangle className="w-5 h-5 text-rose-600 dark:text-rose-400 flex-shrink-0 mt-0.5" />
          <div className="min-w-0">
            <p className="font-semibold text-sm text-rose-900 dark:text-rose-200">
              Your two returns do not agree
            </p>
            <p className="text-xs text-rose-800 dark:text-rose-300 mt-1">
              GSTR-3B shows{' '}
              <span className="font-semibold tabular-nums">{formatINR(Math.abs(data.unexplained))}</span>
              {data.unexplained > 0 ? ' more' : ' less'} tax than GSTR-1, and nothing explains it.
              Filing both as they stand is the most common reason a shop gets a notice.
            </p>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="rounded-2xl border border-emerald-200 dark:border-emerald-900 bg-emerald-50 dark:bg-emerald-950/30 overflow-hidden">
      <div className="p-4 flex items-start gap-3">
        <CheckCircle2 className="w-5 h-5 text-emerald-600 dark:text-emerald-400 flex-shrink-0 mt-0.5" />
        <div className="min-w-0">
          <p className="font-semibold text-sm text-emerald-900 dark:text-emerald-200">
            Your GSTR-1 and GSTR-3B agree
          </p>
          <p className="text-xs text-emerald-800 dark:text-emerald-300 mt-0.5">
            Both declare <span className="font-semibold tabular-nums">{formatINR(data.gstr3bTax)}</span> of
            tax for this month. A difference between the two is the most common reason a shop gets a
            notice — yours have none.
          </p>
        </div>
      </div>

      {/*
        * The workings, for whoever wants them.
        *
        * A CA will not take "they agree" on trust, and should not have to. These
        * are the differences that legitimately exist between the two returns,
        * each with the reason it is correct — the same list they would otherwise
        * reconstruct by hand from two PDFs.
        */}
      {items.length > 0 && (
        <details className="border-t border-emerald-200 dark:border-emerald-900 group">
          <summary className="px-4 py-2.5 text-xs font-medium text-emerald-900 dark:text-emerald-200 cursor-pointer list-none flex items-center gap-1.5 hover:bg-emerald-100/50 dark:hover:bg-emerald-900/20">
            <ArrowRight className="w-3.5 h-3.5 transition-transform group-open:rotate-90" />
            Show the workings ({items.length})
          </summary>
          <div className="px-4 pb-3 pt-1 space-y-2.5">
            <div className="flex items-baseline justify-between gap-3 text-xs">
              <span className="text-emerald-900 dark:text-emerald-200">Tax on invoices (GSTR-1)</span>
              <span className="font-semibold tabular-nums text-emerald-900 dark:text-emerald-200">
                {formatINR(data.gstr1Tax)}
              </span>
            </div>
            {items.map((it: { label: string; amount: number; why: string }) => (
              <div key={it.label} className="text-xs">
                <div className="flex items-baseline justify-between gap-3">
                  <span className="text-emerald-900 dark:text-emerald-200">{it.label}</span>
                  {it.amount !== 0 && (
                    <span className="font-semibold tabular-nums text-emerald-900 dark:text-emerald-200">
                      {it.amount > 0 ? '+' : '−'}{formatINR(Math.abs(it.amount))}
                    </span>
                  )}
                </div>
                <p className="text-emerald-800/80 dark:text-emerald-300/80 mt-0.5">{it.why}</p>
              </div>
            ))}
            <div className="flex items-baseline justify-between gap-3 text-xs pt-2 border-t border-emerald-200 dark:border-emerald-900">
              <span className="font-semibold text-emerald-900 dark:text-emerald-200">
                Tax payable (GSTR-3B)
              </span>
              <span className="font-bold tabular-nums text-emerald-900 dark:text-emerald-200">
                {formatINR(data.gstr3bTax)}
              </span>
            </div>
          </div>
        </details>
      )}
    </div>
  )
}
