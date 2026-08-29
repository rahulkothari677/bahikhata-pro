'use client'

/**
 * "Will filing this get me a notice?" — answered before filing, not after.
 *
 * WHY THIS IS ON SCREEN. Since 2023, Rules 88C and 88D compare a taxpayer's own
 * returns against each other automatically and issue an intimation without an
 * officer touching it. The consequence is not the tax — it is that the portal
 * REFUSES THE NEXT GSTR-1 until the intimation is answered. Shops discover this
 * a month later, when they cannot bill compliantly and have no idea why.
 *
 * Every number involved is one this app already computes. Nobody shows it at
 * the only moment it is useful, which is before the return goes in. Afterwards
 * it is not a warning, it is just bad news.
 *
 * WHY IT NEVER SAYS "YOU ARE SAFE". A shortfall under the threshold is still a
 * shortfall — it simply is not escalated automatically. Calling unpaid tax
 * "fine" would be the kind of reassurance that costs someone interest, so an
 * under-threshold difference is shown plainly and told apart from a notice.
 *
 * AND SINCE 29 AUG 2026 IT DOES NOT PROMISE ONE EITHER. The CA review
 * established that 20% / ₹25 lakh was the Council's opening recommendation and
 * that GSTN runs a configurable, unpublished threshold. So this card reports
 * EXPOSURE — the real gap, in rupees and percent — rather than asserting that
 * a notice will or will not be issued. The 7-day window and the block on the
 * next GSTR-1 are confirmed and stay stated plainly.
 *
 * @see lib/notice-risk.ts for the thresholds and the AND that matters
 */

import { useQuery } from '@tanstack/react-query'
import { ShieldCheck, AlertTriangle, ShieldAlert, Info } from 'lucide-react'
import { offlineFetch } from '@/lib/offline-fetch'
import { formatINR } from '@/lib/utils'

export function NoticeRisk({ month }: { month: string }) {
  const { data, isLoading } = useQuery({
    queryKey: ['notice-risk', month],
    queryFn: async () => {
      const r = await offlineFetch(`/api/notice-risk?month=${month}`)
      if (!r.ok) throw new Error('Could not assess the notice risk')
      return r.json()
    },
    staleTime: 60 * 1000,
  })

  if (isLoading || !data) return null

  const notices = (data.rules || []).filter((r: any) => r.level === 'notice')
  const differences = (data.rules || []).filter((r: any) => r.level === 'difference')
  const isNotice = notices.length > 0

  const tone = isNotice
    ? {
      border: 'border-rose-200 dark:border-rose-900',
      bg: 'bg-rose-50 dark:bg-rose-950/30',
      title: 'text-rose-900 dark:text-rose-200',
      body: 'text-rose-800 dark:text-rose-300',
      icon: <ShieldAlert className="w-5 h-5 text-rose-600 dark:text-rose-400 flex-shrink-0 mt-0.5" />,
    }
    : differences.length > 0
      ? {
        border: 'border-amber-200 dark:border-amber-900',
        bg: 'bg-amber-50 dark:bg-amber-950/30',
        title: 'text-amber-900 dark:text-amber-200',
        body: 'text-amber-800 dark:text-amber-300',
        icon: <AlertTriangle className="w-5 h-5 text-amber-600 dark:text-amber-400 flex-shrink-0 mt-0.5" />,
      }
      : {
        border: 'border-emerald-200 dark:border-emerald-900',
        bg: 'bg-emerald-50 dark:bg-emerald-950/30',
        title: 'text-emerald-900 dark:text-emerald-200',
        body: 'text-emerald-800 dark:text-emerald-300',
        icon: <ShieldCheck className="w-5 h-5 text-emerald-600 dark:text-emerald-400 flex-shrink-0 mt-0.5" />,
      }

  /*
   * A CLEAN MONTH GETS ONE LINE, NOT A CARD.
   *
   * This sits third in a row of reassurance: "Ready to file", "Your returns
   * agree", and then this. Three full green boxes before the shopkeeper
   * reaches a single figure — and the note on ReturnsAgree records why that
   * is a mistake, because four stacked boxes on this exact screen once read
   * as an app in trouble rather than a shop with nothing to do.
   *
   * So the good news is quiet and the bad news is loud. When something is
   * actually at stake the full card returns below.
   *
   * `data.avoided` COUNTS AS SOMETHING AT STAKE.
   *
   * I got this wrong the first time. The condition was `!isNotice &&
   * differences.length === 0`, which returned this one-liner while credit was
   * being held back — so "we held back ₹1,620 that is not in your GSTR-2B",
   * the single most useful number this card produces, rendered nowhere. Found
   * live, by importing a 2B smaller than the books and looking at the screen.
   *
   * It is the same bug as FilingReadiness, in the same file, in the commit
   * whose message said "good news quiet, bad news loud": I made the good news
   * so quiet it swallowed a real finding. Held-back credit is not reassurance
   * — it is money the shopkeeper can still recover by chasing a supplier.
   */
  if (!isNotice && differences.length === 0 && !data.avoided) {
    const checked = data.inputs?.hasGstr2b
      ? 'Rules 88C and 88D'
      : 'Rule 88C'
    return (
      <div className="flex items-start gap-2 px-1 text-xs text-muted-foreground">
        <ShieldCheck className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400 flex-shrink-0 mt-0.5" />
        <p>
          <span className="font-medium text-foreground">No automatic notice from this filing.</span>{' '}
          Checked against {checked}
          {!data.inputs?.hasGstr2b && <> — import your GSTR-2B and Rule 88D is checked too</>}.
        </p>
      </div>
    )
  }

  return (
    <div className={`rounded-2xl border ${tone.border} ${tone.bg} overflow-hidden`}>
      <div className="p-4 flex items-start gap-3">
        {tone.icon}
        <div className="min-w-0 flex-1">
          {/* Three cases, not two. The filing can be perfectly safe AND have
              credit held back — saying "short-paid" there would be plainly
              wrong, and saying nothing would waste the card. */}
          <p className={`font-semibold text-sm ${tone.title}`}>
            {isNotice
              ? 'Filing this leaves you exposed to an automatic notice'
              : differences.length > 0
                ? 'No notice — but this period is short-paid'
                : 'No notice — and here is credit worth chasing'}
          </p>

          <div className="mt-3 space-y-3">
            {[...notices, ...differences].map((r: any) => (
              <div key={r.rule} className="rounded-xl bg-white/60 dark:bg-black/20 p-3">
                <div className="flex items-baseline justify-between gap-2 mb-1">
                  <p className={`text-xs font-bold ${tone.title}`}>
                    Rule {r.rule} · {r.rule === '88C' ? 'DRC-01B' : 'DRC-01C'}
                  </p>
                  <p className={`text-sm font-bold tabular-nums ${tone.title}`}>
                    {formatINR(r.excess)}
                  </p>
                </div>
                <p className={`text-xs ${tone.body}`}>{r.headline}</p>

                {/* The gap against the public guide figures — labelled as a
                    guide, because GSTN's actual threshold is configurable and
                    unpublished (CA review, 29 Aug 2026). Showing WHICH test it
                    passes is still useful; calling either one a legal trigger
                    is not something we can stand behind. */}
                <p className={`mt-2 text-3xs ${tone.body} opacity-80`}>
                  Against the commonly cited guide figures — GSTN sets the real
                  threshold and does not publish it:
                </p>
                <div className={`mt-1 grid grid-cols-2 gap-2 text-3xs ${tone.body}`}>
                  <div className="flex items-center gap-1.5">
                    <span className={r.crossedPercent ? 'font-bold' : 'opacity-70'}>
                      {r.crossedPercent ? 'over' : 'under'} 20%
                    </span>
                    <span className="opacity-70 tabular-nums">
                      ({Number.isFinite(r.excessPercent) ? `${r.excessPercent}%` : 'n/a'})
                    </span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span className={r.crossedAbsolute ? 'font-bold' : 'opacity-70'}>
                      {r.crossedAbsolute ? 'over' : 'under'} ₹25 lakh
                    </span>
                  </div>
                </div>

                {r.consequence && (
                  <p className={`text-xs mt-2 font-medium ${tone.body}`}>{r.consequence}</p>
                )}
                {r.action && (
                  <p className={`text-xs mt-1.5 ${tone.body} opacity-90`}>
                    <span className="font-semibold">What to do:</span> {r.action}
                  </p>
                )}
              </div>
            ))}
          </div>

          {/* What Rule 36(4) already prevented. This is the part no competitor
              can show, because they let the claim through in the first place. */}
          {data.avoided && (
            <div className="mt-3 rounded-xl bg-white/60 dark:bg-black/20 p-3">
              <div className="flex items-start gap-2">
                <ShieldCheck className="w-4 h-4 text-emerald-600 dark:text-emerald-400 flex-shrink-0 mt-0.5" />
                <div className="min-w-0">
                  <p className="text-xs font-bold text-emerald-900 dark:text-emerald-200">
                    We held back {formatINR(data.avoided.heldBack)} of input credit
                  </p>
                  <p className="text-xs text-emerald-800 dark:text-emerald-300 mt-1">
                    That much sits in your purchase bills but not in your GSTR-2B, so
                    Rule 36(4) does not allow it yet. Claiming it{' '}
                    {data.avoided.level === 'notice'
                      ? 'would have triggered a DRC-01C intimation.'
                      : 'would have invited interest and a reversal.'}{' '}
                    Chase the supplier who has not filed and it becomes claimable next month.
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* Absence of a 2B is stated, never guessed at. Treating "no file
              imported" as "no credit available" would accuse an ordinary shop
              of over-claiming its entire ITC. */}
          {!data.inputs?.hasGstr2b && (
            <div className={`mt-3 flex items-start gap-2 text-xs ${tone.body}`}>
              <Info className="w-4 h-4 flex-shrink-0 mt-0.5 opacity-70" />
              <p>
                <span className="font-medium">Rule 88D not checked.</span> Import your
                GSTR-2B for this month and this card will also tell you whether your
                input credit claim is safe.
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
