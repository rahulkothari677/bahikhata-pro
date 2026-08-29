'use client'

/**
 * #94 — "these items were sorted under the old rules."
 *
 * Every product entered before 29 Aug 2026 had its GST treatment decided
 * against Notification 2/2017, which was cancelled and replaced by 10/2025.
 * Fixing the rule going forward left those rows alone, and GSTR-1 reads them
 * every month.
 *
 * ── WHY A LIST AND NOT A DIALOG PER ITEM ────────────────────────────────
 *
 * A shop with 300 items may have a dozen affected. Opening and closing twelve
 * dialogs is the kind of chore people abandon halfway, and half-corrected
 * books are worse than untouched ones: the shopkeeper believes it is done.
 * Everything is answered in place, in one list.
 *
 * ── IT NEVER CHANGES ANYTHING ON ITS OWN ────────────────────────────────
 *
 * Eleven of the twenty-one prefixes on the cancelled list are CONDITIONAL now,
 * and the condition is something only the shopkeeper can see — sold loose or
 * packaged, fresh or frozen. "Exempt" may well still be right for their shop.
 * Auto-correcting would swap one silent decision for another, which is the
 * mistake this whole task exists to undo.
 *
 * Hides itself when there is nothing to review, so it is not a permanent
 * banner on a healthy shop.
 */

import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Loader2, AlertTriangle, CheckCircle2 } from 'lucide-react'
import { toast as sonnerToast } from 'sonner'
import { offlineFetch } from '@/lib/offline-fetch'
import { CONDITION_QUESTION } from '@/lib/exempt-goods-lookup'
import { readError } from '@/lib/read-error'

interface Finding {
  id: string
  name: string
  hsn: string | null
  category: string | null
  currentTreatment: string
  verdict: 'should-be-exempt' | 'no-longer-listed' | 'needs-answer'
  reason: string
  description: string | null
  conditions: string[]
  suggested: 'exempt' | 'taxable' | null
  source: string | null
  serial: number | null
}

const TREATMENT_LABEL: Record<string, string> = {
  taxable: 'Taxable', nil: 'Nil-rated', exempt: 'Exempt', nonGst: 'Non-GST',
}

export function ExemptReclassifyReview() {
  const queryClient = useQueryClient()
  const [answers, setAnswers] = useState<Record<string, Record<string, 'exempt' | 'taxable'>>>({})
  const [saving, setSaving] = useState<string | null>(null)
  const [done, setDone] = useState<Record<string, string>>({})

  const { data, isLoading } = useQuery({
    queryKey: ['exempt-review'],
    queryFn: async () => (await offlineFetch('/api/products/exempt-review')).json(),
  })

  if (isLoading) {
    return <div className="py-8 flex justify-center"><Loader2 className="w-5 h-5 animate-spin text-muted-foreground" /></div>
  }
  /* Nothing to review — say nothing. A healthy shop should not carry a
     permanent compliance banner it can never clear. */
  if (!data || data.findingCount === 0) return null

  const findings: Finding[] = data.findings

  const apply = async (f: Finding, treatment: 'exempt' | 'taxable') => {
    setSaving(f.id)
    try {
      const r = await offlineFetch('/api/products/exempt-review', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ productId: f.id, gstTreatment: treatment }),
        offline: { invalidate: ['/api/products/exempt-review'] },
      })
      if (!r.ok) throw new Error(await readError(r))
      setDone(d => ({ ...d, [f.id]: treatment }))
      /* The item list shows the treatment too — leaving it stale would show
         two different answers for one product on two screens. */
      queryClient.invalidateQueries({ queryKey: ['products'] })
      sonnerToast.success(`${f.name} set to ${TREATMENT_LABEL[treatment]}`)
    } catch (e: any) {
      sonnerToast.error(e?.message || 'Could not save')
    } finally {
      setSaving(null)
    }
  }

  return (
    <Card className="shadow-card border-amber-300 dark:border-amber-900">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <AlertTriangle className="w-5 h-5 text-amber-600 dark:text-amber-400" />
          {data.findingCount} {data.findingCount === 1 ? 'item was' : 'items were'} sorted under the old GST rules
        </CardTitle>
        <CardDescription className="text-xs">
          {/*
            * The denominator is here on purpose. "12 problems" reads as a
            * disaster; "12 of your 340 zero-rated items" reads as an
            * afternoon. A compliance screen that frightens people gets closed.
            */}
          Checked {data.zeroRatedScanned} of your items that carry no GST. The list they were sorted
          against ({data.notification?.supersedes}) was cancelled and replaced by{' '}
          {data.notification?.notification} on {data.notification?.dated}. Nothing has been changed —
          please confirm each one.
        </CardDescription>
        {data.truncated && (
          <p className="text-2xs text-amber-700 dark:text-amber-400 mt-1">{data.truncationNote}</p>
        )}
      </CardHeader>

      <CardContent className="space-y-3">
        {findings.map(f => {
          const given = answers[f.id] || {}
          const askable = f.conditions.filter(c => CONDITION_QUESTION[c])
          const allAnswered = askable.length > 0 && askable.every(c => given[c])
          const wouldBe = allAnswered && askable.every(c => given[c] === 'exempt') ? 'exempt' : 'taxable'
          const settled = done[f.id]

          return (
            <div key={f.id} className="rounded-lg border border-border/60 p-3">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-sm font-medium truncate">{f.name}</p>
                  <p className="text-2xs text-muted-foreground">
                    {f.hsn ? `HSN ${f.hsn}` : 'no HSN'} · now {TREATMENT_LABEL[f.currentTreatment] || f.currentTreatment}
                  </p>
                </div>
                {settled
                  ? <Badge variant="outline" className="gap-1 shrink-0"><CheckCircle2 className="w-3 h-3" /> {TREATMENT_LABEL[settled]}</Badge>
                  : <Badge variant="outline" className="shrink-0 text-2xs">needs a look</Badge>}
              </div>

              <p className="text-2xs text-muted-foreground mt-2">{f.reason}</p>
              {f.description && (
                <p className="text-2xs italic text-muted-foreground mt-1">“{f.description}”</p>
              )}

              {!settled && f.verdict === 'needs-answer' && askable.map(code => {
                const q = CONDITION_QUESTION[code]
                return (
                  <div key={code} className="mt-3">
                    <p className="text-2xs font-medium">{q.question}</p>
                    <div className="flex flex-wrap gap-2 mt-2">
                      {(['exempt', 'taxable'] as const).map(side => (
                        <Button
                          key={side} type="button" size="sm"
                          variant={given[code] === side ? 'default' : 'outline'}
                          className="h-12"
                          onClick={() => setAnswers(a => ({ ...a, [f.id]: { ...(a[f.id] || {}), [code]: side } }))}
                        >
                          {side === 'exempt' ? q.exemptLabel : q.taxableLabel}
                        </Button>
                      ))}
                    </div>
                  </div>
                )
              })}

              {!settled && f.verdict === 'needs-answer' && (
                <Button
                  size="sm" className="mt-3 h-12"
                  disabled={!allAnswered || saving === f.id}
                  onClick={() => apply(f, wouldBe)}
                >
                  {saving === f.id ? <Loader2 className="w-4 h-4 animate-spin" />
                    : allAnswered ? `Save as ${TREATMENT_LABEL[wouldBe]}` : 'Answer above to save'}
                </Button>
              )}

              {!settled && f.verdict === 'should-be-exempt' && f.suggested && (
                <Button
                  size="sm" className="mt-3 h-12"
                  disabled={saving === f.id}
                  onClick={() => apply(f, f.suggested!)}
                >
                  {saving === f.id ? <Loader2 className="w-4 h-4 animate-spin" /> : `Change to ${TREATMENT_LABEL[f.suggested]}`}
                </Button>
              )}

              {/*
                * 'no-longer-listed' deliberately offers NO button. Either the
                * HSN is wrong or the treatment is, and this cannot tell which
                * — a one-click fix would push the shopkeeper into changing
                * whichever half happens to be right. The row says where to
                * look; they edit the item themselves.
                */}
              {!settled && f.verdict === 'no-longer-listed' && (
                <p className="text-2xs text-muted-foreground mt-2">
                  Open this item and check its HSN code — we cannot tell whether the code or the
                  treatment is the wrong one, so nothing is offered here.
                </p>
              )}

              {f.source && (
                <p className="text-3xs text-muted-foreground mt-2">
                  {f.source}{f.serial ? ` · entry ${f.serial}` : ''}
                </p>
              )}
            </div>
          )
        })}
      </CardContent>
    </Card>
  )
}
