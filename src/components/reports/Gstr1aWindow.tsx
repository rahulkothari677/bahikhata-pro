'use client'

/**
 * "You can still fix this month's return — but not for long."
 *
 * WHY THIS EXISTS (#41). NeedsAmending, its sibling above, tells a shopkeeper
 * that a filed invoice has changed and will be corrected in a LATER period.
 * That is right once the period is closed, and it is the expensive answer while
 * GSTR-1A is still open.
 *
 * GSTR-3B's outward table has been locked since July 2025 — it fills itself
 * from GSTR-1 and cannot be typed over. So the two routes are not equivalent:
 *
 *   inside the window   correct GSTR-1 first, GSTR-3B auto-fills from the
 *                       corrected figure, right tax paid once.
 *   after it closes     GSTR-3B is locked to the wrong figure. Pay it, then
 *                       reclaim next month — having funded the gap meanwhile.
 *
 * And when the filed GSTR-1 declares MORE tax than GSTR-3B pays, that gap is
 * the Rule 88C condition our Notice Risk panel already warns about. We named
 * the problem and did not offer the remedy.
 *
 * WHY IT IS URGENT-LOOKING BUT NOT ALARMING. Nothing has gone wrong: editing a
 * bill is normal and the app allowed it. What is time-limited is the cheap way
 * to declare it. So the wording is about a door closing, not a mistake made —
 * the same tone rule NeedsAmending set.
 *
 * WHAT IT DOES NOT DO. It does not generate a GSTR-1A file. We do not hold the
 * portal's GSTR-1A JSON schema, and a file that looks upload-ready and is not
 * would be the worst output this app could produce. It says what is correctable
 * and what is not; the file waits for the schema.
 */

import { Clock, AlertTriangle, Info } from 'lucide-react'

interface Correction {
  inum: string
  changes: string[]
  fitsGstr1a: boolean
  reason: string
}

interface Props {
  window?: {
    state: 'not-filed-yet' | 'open' | 'closed' | 'unknown-for-qrmp'
    message: string
    isOpen: boolean
  } | null
  corrections?: Correction[]
  blockedCount?: number
}

export function Gstr1aWindow({ window, corrections = [], blockedCount = 0 }: Props) {
  /*
   * Silent unless there is something to say. 'not-filed-yet' is the ordinary
   * state of most months and needs no card — the invoice is simply editable,
   * which is what a shopkeeper already assumes.
   */
  if (!window || window.state === 'not-filed-yet') return null

  /*
   * Nothing has changed since filing, so the window being open is not news.
   * Announcing an empty correction list every month is how a panel becomes
   * furniture people stop reading.
   */
  if (window.state === 'open' && corrections.length === 0) return null

  if (window.state === 'unknown-for-qrmp') {
    return (
      <div className="rounded-2xl border border-border/60 bg-muted/30 p-4 flex items-start gap-2">
        <Info className="w-4 h-4 text-muted-foreground flex-shrink-0 mt-0.5" />
        <p className="text-xs text-muted-foreground">{window.message}</p>
      </div>
    )
  }

  /*
   * CLOSED, with corrections outstanding. Shown rather than hidden: the
   * shopkeeper needs to know the cheap route has gone and the later amendment
   * is now the only one, or they will look for a GSTR-1A button that no longer
   * applies to them.
   */
  if (window.state === 'closed') {
    if (corrections.length === 0) return null
    return (
      <div className="rounded-2xl border border-border/60 bg-muted/30 p-4">
        <p className="text-sm font-medium">GSTR-1A has closed for this month</p>
        <p className="text-xs text-muted-foreground mt-1">{window.message}</p>
      </div>
    )
  }

  const fixable = corrections.filter(c => c.fitsGstr1a)

  return (
    <div className="rounded-2xl border border-amber-300 dark:border-amber-900 bg-amber-50 dark:bg-amber-950/30 overflow-hidden">
      <div className="px-4 py-3 border-b border-amber-200 dark:border-amber-900 flex items-start gap-2">
        <Clock className="w-5 h-5 text-amber-600 dark:text-amber-400 flex-shrink-0 mt-0.5" />
        <div>
          <p className="text-sm font-semibold text-amber-900 dark:text-amber-200">
            You can still fix this month’s GSTR-1
          </p>
          <p className="text-2xs text-amber-800 dark:text-amber-300 mt-1">{window.message}</p>
        </div>
      </div>

      <div className="p-4 space-y-3">
        {fixable.length > 0 && (
          <div>
            <p className="text-2xs font-medium text-amber-900 dark:text-amber-200">
              {fixable.length === 1 ? 'This bill has' : `These ${fixable.length} bills have`} changed since you filed:
            </p>
            <ul className="mt-2 space-y-1">
              {fixable.map(c => (
                <li key={c.inum} className="text-2xs text-amber-800 dark:text-amber-300">
                  <span className="font-mono font-medium">{c.inum}</span>
                  {' — '}{c.changes.join(', ')}
                </li>
              ))}
            </ul>
          </div>
        )}

        {/*
          * THE ONE THING GSTR-1A CANNOT DO, and it is a common mistake rather
          * than an exotic one. Changing the customer's GSTIN moves input credit
          * from one taxpayer to another, and a same-period amendment may not do
          * that. Sending someone to a screen that refuses the change would make
          * them think the app was wrong, not the route.
          */}
        {blockedCount > 0 && (
          <div className="rounded-lg border border-amber-300 dark:border-amber-800 bg-amber-100/60 dark:bg-amber-900/30 p-3 flex items-start gap-2">
            <AlertTriangle className="w-4 h-4 text-amber-700 dark:text-amber-400 flex-shrink-0 mt-0.5" />
            <div>
              <p className="text-2xs font-medium text-amber-900 dark:text-amber-200">
                {blockedCount === 1 ? 'One correction cannot' : `${blockedCount} corrections cannot`} go in GSTR-1A
              </p>
              <ul className="mt-1 space-y-1">
                {corrections.filter(c => !c.fitsGstr1a).map(c => (
                  <li key={c.inum} className="text-2xs text-amber-800 dark:text-amber-300">
                    <span className="font-mono">{c.inum}</span> — {c.reason}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        )}

        <p className="text-2xs text-amber-700 dark:text-amber-400">
          File GSTR-1A on the portal before you file this month’s GSTR-3B. We do not generate the
          GSTR-1A file yet — this is telling you the window is open and what belongs in it.
        </p>
      </div>
    </div>
  )
}
