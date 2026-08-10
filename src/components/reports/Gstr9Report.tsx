'use client'

/**
 * GSTR-9 — the annual return.
 *
 * WHAT THIS SCREEN HAS TO GET RIGHT, above being pretty: an annual return
 * assembled from an incomplete year looks completely normal. Nine months of
 * twelve produces a plausible total, and nothing about it says a quarter is
 * missing. So coverage is the FIRST thing on the screen, not a footnote —
 * before any figure, because every figure below it is conditional on it.
 *
 * The second is Table 6. The form splits input credit three ways — Inputs,
 * Capital Goods, Input Services — and we do not record that on a purchase.
 * It is shown as an explicit gap with the reason, rather than filled with a
 * guess. A return that is honestly incomplete can be finished; one that is
 * confidently wrong gets filed.
 */

import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { Badge } from '@/components/ui/badge'
import { ChevronLeft, ChevronRight, AlertTriangle, CheckCircle2, Info, CalendarDays } from 'lucide-react'
import { formatINR } from '@/lib/utils'
import { offlineFetch } from '@/lib/offline-fetch'

/** "042026" → "Apr 2026", for naming the months that are missing. */
function monthLabel(my: string): string {
  const names = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
  return `${names[Number(my.slice(0, 2)) - 1]} ${my.slice(2)}`
}

/** The FY containing today, April–March. */
function currentFy(): string {
  const d = new Date()
  const start = d.getMonth() + 1 >= 4 ? d.getFullYear() : d.getFullYear() - 1
  return `${start}-${String((start + 1) % 100).padStart(2, '0')}`
}

function Row({ label, value, tax, bold, indent }: {
  label: string; value?: number; tax?: { cgst: number; sgst: number; igst: number }; bold?: boolean; indent?: boolean
}) {
  return (
    <tr className={bold ? 'font-semibold' : ''}>
      <td className={`py-1.5 pr-2 ${indent ? 'pl-4' : ''}`}>{label}</td>
      <td className="py-1.5 px-2 text-right tabular-nums">{value !== undefined ? formatINR(value) : '—'}</td>
      <td className="py-1.5 px-2 text-right tabular-nums">{tax ? formatINR(tax.cgst) : '—'}</td>
      <td className="py-1.5 px-2 text-right tabular-nums">{tax ? formatINR(tax.sgst) : '—'}</td>
      <td className="py-1.5 pl-2 text-right tabular-nums">{tax ? formatINR(tax.igst) : '—'}</td>
    </tr>
  )
}

export function Gstr9Report() {
  const [fy, setFy] = useState(currentFy())

  const { data, isLoading, error } = useQuery({
    queryKey: ['gstr-9', fy],
    queryFn: async () => {
      const r = await offlineFetch(`/api/gstr-9?fy=${fy}`)
      if (!r.ok) {
        const j = await r.json().catch(() => ({}))
        throw new Error(j.message || j.error || `Request failed (${r.status})`)
      }
      return r.json()
    },
  })

  const shiftFy = (delta: number) => {
    const start = Number(fy.split('-')[0]) + delta
    setFy(`${start}-${String((start + 1) % 100).padStart(2, '0')}`)
  }

  const header = (
    <div className="flex items-center justify-between gap-2">
      <button onClick={() => shiftFy(-1)} aria-label="Previous financial year" className="p-2 rounded-lg hover:bg-muted">
        <ChevronLeft className="w-4 h-4" />
      </button>
      <div className="text-center">
        <p className="text-sm font-bold">FY {fy}</p>
        <p className="text-2xs text-muted-foreground">Annual return · GSTR-9</p>
      </div>
      <button onClick={() => shiftFy(1)} aria-label="Next financial year" className="p-2 rounded-lg hover:bg-muted">
        <ChevronRight className="w-4 h-4" />
      </button>
    </div>
  )

  if (isLoading) {
    return <div className="space-y-4">{header}<Skeleton className="h-32 w-full rounded-xl" /><Skeleton className="h-64 w-full rounded-xl" /></div>
  }

  if (error) {
    return (
      <div className="space-y-4">
        {header}
        <div className="rounded-2xl border border-amber-200 dark:border-amber-900 bg-amber-50 dark:bg-amber-950/30 p-4 flex items-start gap-3">
          <Info className="w-5 h-5 text-amber-600 dark:text-amber-400 flex-shrink-0 mt-0.5" />
          <p className="text-sm text-amber-900 dark:text-amber-200">{(error as Error).message}</p>
        </div>
      </div>
    )
  }

  if (!data) return null

  const cov = data.coverage
  const t4 = data.table4
  const t5 = data.table5

  return (
    <div className="space-y-4">
      {header}

      {/* ── COVERAGE — before any figure, because they all depend on it ── */}
      {cov.complete ? (
        <div className="rounded-2xl border border-emerald-200 dark:border-emerald-900 bg-emerald-50 dark:bg-emerald-950/30 p-4 flex items-start gap-3">
          <CheckCircle2 className="w-5 h-5 text-emerald-600 dark:text-emerald-400 flex-shrink-0 mt-0.5" />
          <div>
            <p className="font-semibold text-sm text-emerald-900 dark:text-emerald-200">All 12 months are filed</p>
            <p className="text-xs text-emerald-800 dark:text-emerald-300 mt-1">
              This annual return summarises a complete year of GSTR-1 and GSTR-3B filings.
            </p>
          </div>
        </div>
      ) : (
        <div className="rounded-2xl border border-rose-200 dark:border-rose-900 bg-rose-50 dark:bg-rose-950/30 p-4">
          <div className="flex items-start gap-3">
            <AlertTriangle className="w-5 h-5 text-rose-600 dark:text-rose-400 flex-shrink-0 mt-0.5" />
            <div className="min-w-0">
              <p className="font-semibold text-sm text-rose-900 dark:text-rose-200">
                {cov.missing.length} of 12 months are not filed — these figures are incomplete
              </p>
              <p className="text-xs text-rose-800 dark:text-rose-300 mt-1">
                An annual return built from a part-year still looks like a normal total, which is
                what makes it dangerous. File the months below, then come back.
              </p>
              <div className="flex flex-wrap gap-1 mt-2">
                {cov.missing.map((m: string) => (
                  <Badge key={m} variant="destructive" className="text-3xs">{monthLabel(m)}</Badge>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Is it even required? ─────────────────────────────────────── */}
      <Card className="shadow-card border-border/60">
        <CardContent className="p-4">
          <div className="flex items-start gap-3">
            <CalendarDays className="w-4 h-4 text-muted-foreground flex-shrink-0 mt-0.5" />
            <div className="text-xs">
              <p>
                Turnover <span className="font-semibold tabular-nums">{formatINR(data.filing.turnover)}</span> —{' '}
                {data.filing.isMandatory
                  ? <span className="font-semibold text-rose-600">GSTR-9 is mandatory for you.</span>
                  : <span>below the ₹2 crore line, so GSTR-9 is <span className="font-semibold">optional</span> and carries no penalty if you skip it.</span>}
              </p>
              <p className="text-muted-foreground mt-1">Due {data.filing.dueDate}.</p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* ── Table 4 ──────────────────────────────────────────────────── */}
      <Card className="shadow-card border-border/60">
        <CardHeader className="pb-2"><CardTitle className="text-sm">4. Supplies on which tax IS payable</CardTitle></CardHeader>
        <CardContent className="p-4 pt-0 overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-muted-foreground border-b border-border">
                <th className="text-left py-1.5 font-medium">Row</th>
                <th className="text-right py-1.5 px-2 font-medium">Taxable</th>
                <th className="text-right py-1.5 px-2 font-medium">CGST</th>
                <th className="text-right py-1.5 px-2 font-medium">SGST</th>
                <th className="text-right py-1.5 pl-2 font-medium">IGST</th>
              </tr>
            </thead>
            <tbody>
              <Row label="A · To unregistered (B2C)" value={t4.b2c.taxableValue} tax={t4.b2c} />
              <Row label="B · To registered (B2B)" value={t4.b2b.taxableValue} tax={t4.b2b} />
              <Row label="G · Inward on reverse charge" value={t4.rcmInward.taxableValue} tax={t4.rcmInward} />
              <Row label="H · Sub-total" value={t4.subTotalH.taxableValue} tax={t4.subTotalH} bold />
              <Row label="I · Credit notes (−)" value={t4.creditNotesI.taxableValue} tax={t4.creditNotesI} indent />
              <Row label="J · Debit notes (+)" value={t4.debitNotesJ.taxableValue} tax={t4.debitNotesJ} indent />
              <Row label="M · Sub-total (I to L)" value={t4.subTotalM.taxableValue} tax={t4.subTotalM} />
              <Row label="N · Total (H + M)" value={t4.totalN.taxableValue} tax={t4.totalN} bold />
            </tbody>
          </table>
        </CardContent>
      </Card>

      {/* ── Table 5 ──────────────────────────────────────────────────── */}
      <Card className="shadow-card border-border/60">
        <CardHeader className="pb-2"><CardTitle className="text-sm">5. Supplies on which tax is NOT payable</CardTitle></CardHeader>
        <CardContent className="p-4 pt-0">
          <div className="space-y-1.5 text-xs">
            {[
              ['D · Exempted', t5.exemptedD],
              ['E · Nil rated', t5.nilRatedE],
              ['F · Non-GST', t5.nonGstF],
            ].map(([k, v]) => (
              <div key={k as string} className="flex justify-between"><span>{k}</span><span className="tabular-nums">{formatINR(v as number)}</span></div>
            ))}
            <div className="flex justify-between font-semibold pt-1.5 border-t border-border">
              <span>G · Sub-total</span><span className="tabular-nums">{formatINR(t5.subTotalG)}</span>
            </div>
            <div className="flex justify-between font-semibold pt-1.5 border-t border-border">
              <span>N · Total turnover</span><span className="tabular-nums">{formatINR(t5.totalTurnoverN)}</span>
            </div>
            <p className="text-3xs text-muted-foreground pt-1">
              Total turnover takes reverse-charge purchases back out — you owe tax on them, but
              they are not your sales.
            </p>
          </div>
        </CardContent>
      </Card>

      {/* ── Table 6, and the honest gap ──────────────────────────────── */}
      <Card className="shadow-card border-border/60">
        <CardHeader className="pb-2"><CardTitle className="text-sm">6. Input tax credit availed</CardTitle></CardHeader>
        <CardContent className="p-4 pt-0 space-y-3">
          <div className="flex justify-between text-xs font-semibold">
            <span>A · Total ITC per GSTR-3B</span>
            <span className="tabular-nums">{formatINR(data.table6.totalItcPer3bA.cgst + data.table6.totalItcPer3bA.sgst + data.table6.totalItcPer3bA.igst)}</span>
          </div>
          {data.table6.splitUnavailable && (
            <div className="rounded-xl border border-amber-200 dark:border-amber-900 bg-amber-50 dark:bg-amber-950/30 p-3 flex items-start gap-2">
              <AlertTriangle className="w-4 h-4 text-amber-600 dark:text-amber-400 flex-shrink-0 mt-0.5" />
              <div className="text-xs text-amber-900 dark:text-amber-200">
                <p className="font-semibold">Rows B, C and D cannot be filled yet</p>
                <p className="mt-1">
                  The form splits every purchase three ways — <strong>goods you resell</strong>,
                  <strong> equipment you keep</strong>, and <strong>services you buy</strong>. We do not
                  record which is which, and it cannot be worked out afterwards.
                </p>
                <p className="mt-1">
                  We show the total rather than guessing. A return that is honestly incomplete can be
                  finished; one that is confidently wrong gets filed.
                </p>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* ── The form's own checks ────────────────────────────────────── */}
      <Card className="shadow-card border-border/60">
        <CardHeader className="pb-2"><CardTitle className="text-sm">Checks</CardTitle></CardHeader>
        <CardContent className="p-4 pt-0 space-y-2">
          {data.checks.map((c: { id: string; passes: boolean; detail: string }) => (
            <div key={c.id} className="flex items-start gap-2 text-xs">
              {c.passes
                ? <CheckCircle2 className="w-4 h-4 text-emerald-600 dark:text-emerald-400 flex-shrink-0 mt-0.5" />
                : <AlertTriangle className="w-4 h-4 text-rose-600 flex-shrink-0 mt-0.5" />}
              <div>
                <p className={c.passes ? '' : 'font-semibold text-rose-700 dark:text-rose-300'}>{c.id}</p>
                {!c.passes && <p className="text-2xs text-muted-foreground">{c.detail}</p>}
              </div>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  )
}
