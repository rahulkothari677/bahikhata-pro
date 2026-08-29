'use client'

/**
 * "Pay this supplier, or hand back the credit."
 *
 * #88. If a supplier is not paid within 180 days of their invoice, the input
 * credit claimed on that bill must be reversed with interest (second proviso
 * to Section 16(2), Rule 37).
 *
 * ── WHY IT IS A WARNING AND NOT A REPORT ────────────────────────────────
 *
 * Telling a shopkeeper they should have reversed credit four months ago is
 * bookkeeping. Telling them "pay this supplier within 12 days or hand back
 * ₹10,800" is the moat — §2, we say whether the return will survive while
 * there is still something cheap to do about it.
 *
 * So DUE SOON comes first, above OVERDUE, even though overdue is the more
 * serious state. Overdue money is already lost until the supplier is paid;
 * due-soon money can still be kept, and this screen exists for that.
 *
 * ── WHY IT IS NOT A LIST OF EVERY UNPAID PURCHASE ───────────────────────
 *
 * That list already exists — it is the purchases ledger. A warning panel that
 * repeats it becomes furniture. Only 'due-soon', 'overdue' and 'paid-late'
 * reach this screen; 'safe' and 'paid' are silent, and so is a shop with
 * nothing outstanding.
 *
 * ── WHAT IT DOES NOT CLAIM ──────────────────────────────────────────────
 *
 * It does not compute the interest, and it does not fill GSTR-3B Table 4(B)(2)
 * for you. Interest depends on the reversal and re-claim dates and the Section
 * 50 rate; a confident wrong number on money owed to the department would be
 * worse than no number. It says what fell due and sends the hard case to a CA.
 */

import { useQuery } from '@tanstack/react-query'
import { AlertTriangle, Clock, Info, Loader2 } from 'lucide-react'
import { offlineFetch } from '@/lib/offline-fetch'
import { formatINR } from '@/lib/utils'

interface Finding {
  id: string
  invoiceNo: string | null
  date: string
  supplier: string
  totalAmount: number
  status: 'due-soon' | 'overdue' | 'paid-late'
  deadline: string | null
  daysLeft: number | null
  unpaidAmount: number
  itcAtRisk: number
  reason: string
}

const fmtDay = (iso?: string | null) =>
  iso ? new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : ''

function Row({ f }: { f: Finding }) {
  return (
    <div className="rounded-lg border border-border/60 bg-background/60 p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-medium truncate">{f.supplier}</p>
          <p className="text-2xs text-muted-foreground">
            {f.invoiceNo || 'no bill number'} · {fmtDay(f.date)} · bill {formatINR(f.totalAmount)}
          </p>
        </div>
        <div className="text-right shrink-0">
          {/* The credit at stake is the largest thing in the row — §4: money is
              what the eye should land on, not the label beside it. */}
          <p className="text-base font-bold tabular-nums">{formatINR(f.itcAtRisk)}</p>
          <p className="text-3xs text-muted-foreground">credit at risk</p>
        </div>
      </div>
      <p className="text-2xs text-muted-foreground mt-2">{f.reason}</p>
      {f.unpaidAmount > 0 && (
        <p className="text-2xs mt-1">
          <span className="text-muted-foreground">Still owed to this supplier: </span>
          <span className="font-medium tabular-nums">{formatINR(f.unpaidAmount)}</span>
        </p>
      )}
    </div>
  )
}

export function ItcReversalWarning() {
  const { data, isLoading } = useQuery({
    queryKey: ['itc-reversal'],
    queryFn: async () => (await offlineFetch('/api/itc-reversal')).json(),
  })

  if (isLoading) {
    return <div className="py-6 flex justify-center"><Loader2 className="w-5 h-5 animate-spin text-muted-foreground" /></div>
  }
  /* A shop with nothing outstanding sees nothing. A permanent banner it can
     never clear is how a warning stops being read. */
  if (!data || data.findingCount === 0) return null

  const dueSoon: Finding[] = data.dueSoon || []
  const overdue: Finding[] = data.overdue || []
  const paidLate: Finding[] = data.paidLate || []

  return (
    <div className="space-y-3">
      {/*
        * DUE SOON FIRST, above the more serious overdue block.
        *
        * Overdue credit is already lost until the supplier is paid. Due-soon
        * credit can still be KEPT, and keeping it costs one payment. Ordering
        * by severity rather than by what can still be saved would bury the
        * only rows this screen can actually help with.
        */}
      {dueSoon.length > 0 && (
        <div className="rounded-2xl border border-amber-300 dark:border-amber-900 bg-amber-50 dark:bg-amber-950/30 overflow-hidden">
          <div className="px-4 py-3 border-b border-amber-200 dark:border-amber-900 flex items-start gap-2">
            <Clock className="w-5 h-5 text-amber-600 dark:text-amber-400 flex-shrink-0 mt-0.5" />
            <div>
              <p className="text-sm font-semibold text-amber-900 dark:text-amber-200">
                Pay {dueSoon.length === 1 ? 'this supplier' : `these ${dueSoon.length} suppliers`} soon
                to keep {formatINR(data.totals?.dueSoonItc || 0)} of credit
              </p>
              <p className="text-2xs text-amber-800 dark:text-amber-300 mt-1">
                If a supplier is not paid within {data.rule?.days} days of their bill, you must give
                back the input credit you claimed on it, with interest. Paying them keeps it.
              </p>
            </div>
          </div>
          <div className="p-3 space-y-2">
            {dueSoon.map(f => <Row key={f.id} f={f} />)}
          </div>
        </div>
      )}

      {overdue.length > 0 && (
        <div className="rounded-2xl border border-red-300 dark:border-red-900 bg-red-50 dark:bg-red-950/30 overflow-hidden">
          <div className="px-4 py-3 border-b border-red-200 dark:border-red-900 flex items-start gap-2">
            <AlertTriangle className="w-5 h-5 text-red-600 dark:text-red-400 flex-shrink-0 mt-0.5" />
            <div>
              <p className="text-sm font-semibold text-red-900 dark:text-red-200">
                {formatINR(data.totals?.overdueItc || 0)} of credit is already past {data.rule?.days} days
              </p>
              <p className="text-2xs text-red-800 dark:text-red-300 mt-1">
                {/* Stated as a thing to do, not a verdict. The credit comes back
                    the moment the supplier is paid, and a warning that reads as
                    pure loss gives nobody a reason to act. */}
                This should be reversed in your GSTR-3B, with interest — and you can claim it back
                as soon as you pay the supplier. Show these to your CA.
              </p>
            </div>
          </div>
          <div className="p-3 space-y-2">
            {overdue.map(f => <Row key={f.id} f={f} />)}
          </div>
        </div>
      )}

      {paidLate.length > 0 && (
        <div className="rounded-2xl border border-border/60 bg-muted/30 overflow-hidden">
          <div className="px-4 py-3 border-b border-border/60 flex items-start gap-2">
            <Info className="w-4 h-4 text-muted-foreground flex-shrink-0 mt-0.5" />
            <div>
              <p className="text-sm font-medium">
                {paidLate.length === 1 ? 'One bill was' : `${paidLate.length} bills were`} paid after the {data.rule?.days}-day limit
              </p>
              <p className="text-2xs text-muted-foreground mt-1">
                {/* The quiet one, and the easiest to miss: these read as paid on
                    every other screen, so nothing suggests a problem. */}
                These are settled now, so nothing is owed to the supplier. But the credit fell due
                for reversal while they were unpaid, and interest may apply. Worth checking with
                your CA.
              </p>
            </div>
          </div>
          <div className="p-3 space-y-2">
            {paidLate.map(f => <Row key={f.id} f={f} />)}
          </div>
        </div>
      )}

      <p className="text-3xs text-muted-foreground px-1">
        {data.rule?.citation}. Checked {data.purchasesChecked} purchases from the last{' '}
        {Math.round((data.lookbackDays || 0) / 365)} years. We do not fill the reversal into your
        GSTR-3B for you, and we do not calculate the interest.
        {data.truncated ? ` ${data.truncationNote}` : ''}
      </p>
    </div>
  )
}
