'use client'

/**
 * Corrections to filed returns — Tables 9A / 9C (#103, #104, Phase 8c).
 *
 * Replaces the old "N invoices need amending" card, which told the shopkeeper
 * the corrections were already "included in this month's return … you do not
 * need to do anything else". That was the defect: an edit made for an internal
 * reason became a filed amendment with nobody's say. The CA, Q1.4: "never push
 * an amendment into a return without explicit user/CA confirmation".
 *
 * Each row: the document, Filed ₹ → Now ₹, what else changed, and a switch —
 * OFF until turned on (master plan 8c: "Include in November's GSTR-1"). The
 * server stores the switch against the correction's fingerprint, so editing
 * the bill again turns it off; the row then says so.
 *
 * Not a tinted warning box: corrections are routine, and the screen's own
 * warnings (Notice) keep their weight.
 */
import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { toast as sonnerToast } from 'sonner'
import { Switch } from '@/components/ui/switch'
import { InfoHint } from '@/components/common/InfoHint'
import { offlineFetch } from '@/lib/offline-fetch'
import { readError } from '@/lib/read-error'
import { haptic } from '@/lib/haptic'
import { formatINR, cn } from '@/lib/utils'

export interface CorrectionRow {
  key: string
  section: 'b2b' | 'b2cl' | 'cdnr' | 'cdnur'
  number: string
  firstFp: string
  lastFp: string
  filedVal: number
  nowVal: number
  changes: string[]
  fingerprint: string
  included: boolean
  lapsed: boolean
  canInclude: boolean
  problem: string | null
  /** The full advice behind the short problem, for ⓘ (a changed GSTIN, #100). */
  problemInfo?: string | null
  deadline: string
  /** "30 Nov 2027" — the row shows this; the sentence above sits behind ⓘ (#344). */
  deadlineDate: string
  daysLeft: number
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
/** "082026" → "Aug 2026". */
export const periodName = (fp: string) => `${MONTHS[Number(fp.slice(0, 2)) - 1] ?? fp.slice(0, 2)} ${fp.slice(2)}`

const CANCELLED = 'This was cancelled after the return was filed'

export function CorrectionsList({ month, monthName, rows, filed }: {
  /** "2026-10" — the return these would go into. */
  month: string
  /** "October" — for the switch's label. */
  monthName: string
  rows: CorrectionRow[] | undefined
  /** This month's GSTR-1 is already filed: nothing more can be switched on for it. */
  filed: boolean
}) {
  const qc = useQueryClient()
  const [busy, setBusy] = useState<string | null>(null)
  const toggle = useMutation({
    mutationFn: async (v: { row: CorrectionRow; include: boolean }) => {
      const r = await offlineFetch('/api/gstr-1', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ month, action: 'include', key: v.row.key, fingerprint: v.row.fingerprint, include: v.include }),
      })
      if (!r.ok) throw new Error(await readError(r))
      return r.json()
    },
    onMutate: (v) => setBusy(v.row.key),
    onSuccess: (_d, v) => {
      haptic.success()
      sonnerToast.success(v.include ? `${v.row.number} will go into ${monthName}'s GSTR-1` : `${v.row.number} taken out of ${monthName}'s GSTR-1`)
      qc.invalidateQueries({ queryKey: ['gstr-1', month] })
    },
    onError: (e: any) => {
      haptic.error()
      sonnerToast.error(e?.message || 'Could not change that')
      qc.invalidateQueries({ queryKey: ['gstr-1', month] })
    },
    onSettled: () => setBusy(null),
  })

  // Nothing to correct is the normal case, and it says nothing at all.
  if (!rows || rows.length === 0) return null
  const on = rows.filter((r) => r.included).length

  return (
    <section className="rounded-2xl border border-border bg-card" data-testid="corrections">
      <div className="px-4 pt-3 pb-2 flex items-start justify-between gap-3 border-b">
        <div className="min-w-0">
          <div className="flex items-center gap-1">
            <p className="text-sm font-semibold">Corrections to filed returns</p>
            <InfoHint
              label="corrections"
              text={'These bills changed after the return they were in was filed. A filed bill is corrected by declaring it in a later month\'s GSTR-1 (Tables 9A / 9C), with its original number and date.\n\nNothing goes in until you switch it on. If a bill changes again after you switch it on, the switch turns itself off so you can look again.\n\nFor a bill to a GST customer, their input credit comes from what you filed — until the correction is filed, they still see the old figures.'}
            />
          </div>
          <p className="text-xs text-muted-foreground">
            {on} of {rows.length} going into {monthName}&apos;s GSTR-1
          </p>
        </div>
      </div>

      <ul className="divide-y">
        {rows.map((r) => {
          const cancelled = r.changes.includes(CANCELLED)
          const others = r.changes.filter((c) => !c.startsWith('Value changed') && c !== CANCELLED && c !== r.problem)
          const switchId = `corr-${r.key}`
          return (
            <li key={r.key} className="px-4 py-3 flex items-start gap-3" data-testid="correction-row">
              <div className="min-w-0 flex-1">
                <p className="text-sm">
                  <span className="font-mono font-medium">{r.number}</span>
                  <span className="text-xs text-muted-foreground"> · filed in {periodName(r.lastFp)}</span>
                </p>
                <p className="text-sm tabular-nums mt-0.5">
                  <span className="text-muted-foreground">Filed {formatINR(r.filedVal)}</span>
                  <span className="text-muted-foreground"> → </span>
                  <span className="font-semibold">{cancelled ? 'Cancelled' : `Now ${formatINR(r.nowVal)}`}</span>
                </p>
                {others.map((c) => (
                  <p key={c} className="text-xs text-muted-foreground mt-0.5">{c}</p>
                ))}
                {r.problem ? (
                  <p className="text-xs text-check font-medium mt-1 flex items-center gap-1">
                    <span>{r.problem}</span>
                    {r.problemInfo && <InfoHint text={r.problemInfo} label={`how to correct ${r.number}`} className="ml-1" />}
                  </p>
                ) : (
                  <>
                    {r.lapsed && !r.included && (
                      <p className="text-xs text-check font-medium mt-1">Changed again since you switched it on — switch on again to include</p>
                    )}
                    {/* #344: the date on the row; the full rule (annual return closes it sooner) behind ⓘ. */}
                    <p className={cn('text-xs mt-1 flex items-center gap-1', r.daysLeft <= 30 ? 'text-check font-medium' : 'text-muted-foreground')}>
                      <span>Until {r.deadlineDate}{r.daysLeft <= 30 ? ` · ${r.daysLeft} ${r.daysLeft === 1 ? 'day' : 'days'} left` : ''}</span>
                      <InfoHint text={r.deadline} label={`deadline for ${r.number}`} className="ml-1" />
                    </p>
                  </>
                )}
              </div>
              {!r.problem && (
                <div className="flex flex-col items-end gap-1 flex-shrink-0 pt-0.5">
                  <Switch
                    id={switchId}
                    checked={r.included}
                    disabled={filed || !r.canInclude || busy === r.key}
                    onCheckedChange={(include) => toggle.mutate({ row: r, include })}
                    aria-label={`Include ${r.number} in ${monthName}'s GSTR-1`}
                  />
                  <label htmlFor={switchId} className="text-xs text-muted-foreground text-right max-w-[7.5rem] leading-tight">
                    {filed ? `${monthName} is filed` : `Include in ${monthName}'s GSTR-1`}
                  </label>
                </div>
              )}
            </li>
          )
        })}
      </ul>
    </section>
  )
}
