'use client'

/**
 * Phase 8d (#116, #117) — under GSTR-3B Table 4: what the credit claim held
 * back, and why. One line each, only when there is something to say; the rule
 * behind ⓘ. A claim shown without its basis invites a shopkeeper to argue with
 * a number they cannot check.
 */
import { InfoHint } from '@/components/common/InfoHint'
import { formatINR, cn } from '@/lib/utils'

export interface ItcDetail {
  shortBy: number
  shortCount: number
  lateCount: number
  lateTax: number
  deferredCount: number
  deferredTax: number
  stillWaitingCount: number
  stillWaitingTax: number
  lapsedCount: number
  lapsedTax: number
}

const bills = (n: number) => `${n} ${n === 1 ? 'bill' : 'bills'}`

export function ItcClaimNotes({ detail }: { detail: ItcDetail | null | undefined }) {
  if (!detail) return null
  const waitingCount = detail.deferredCount + detail.stillWaitingCount
  const waitingTax = detail.deferredTax + detail.stillWaitingTax
  const lines: Array<{ key: string; tone: 'good' | 'check' | 'bad' | 'muted'; text: string; info: string }> = []
  if (detail.lateTax > 0) lines.push({
    key: 'late', tone: 'good',
    text: `${formatINR(detail.lateTax)} claimed now from ${bills(detail.lateCount)} of earlier months`,
    info: 'These suppliers filed late, so their bills reached your GSTR-2B this month. Credit is claimed in the month a bill first appears in GSTR-2B (Rule 36(4)), so it is claimed now, not lost.',
  })
  if (detail.shortBy > 0) lines.push({
    key: 'short', tone: 'check',
    text: `${formatINR(detail.shortBy)} not claimed — suppliers filed less than your bills (${bills(detail.shortCount)})`,
    info: 'Credit can only be what the supplier filed in GSTR-2B (Rule 36(4)); claiming more invites a DRC-01C notice (Rule 88D). Ask the supplier to correct their GSTR-1 — the rest is claimed when it appears.',
  })
  if (waitingTax > 0) lines.push({
    key: 'waiting', tone: 'muted',
    text: `${formatINR(waitingTax)} waiting for suppliers to file (${bills(waitingCount)})`,
    info: 'Not in your GSTR-2B yet. Each is claimed in the month it appears there — until 30 November after its financial year.',
  })
  if (detail.lapsedTax > 0) lines.push({
    key: 'lapsed', tone: 'bad',
    text: `${formatINR(detail.lapsedTax)} can no longer be claimed — past 30 November (${bills(detail.lapsedCount)})`,
    info: 'Section 16(4): credit for a bill must be claimed by 30 November after the end of its financial year (or the annual return, if filed earlier).',
  })
  if (lines.length === 0) return null

  return (
    <ul className="mt-3 pt-3 border-t space-y-1.5" data-testid="itc-claim-notes">
      {lines.map((l) => (
        <li key={l.key} className={cn('text-xs flex items-center gap-1', {
          'text-good': l.tone === 'good', 'text-check font-medium': l.tone === 'check', 'text-bad font-medium': l.tone === 'bad', 'text-muted-foreground': l.tone === 'muted',
        })}>
          <span className="min-w-0">{l.text}</span>
          <InfoHint text={l.info} label={l.text} className="ml-1" />
        </li>
      ))}
    </ul>
  )
}
