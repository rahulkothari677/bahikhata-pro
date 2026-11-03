'use client'

/**
 * Phase 8d (#116, #117) — under GSTR-3B Table 4: what the credit claim held
 * back, and why. One line each, only when there is something to say; the rule
 * behind ⓘ. A claim shown without its basis invites a shopkeeper to argue with
 * a number they cannot check.
 */
import { useState } from 'react'
import { InfoHint } from '@/components/common/InfoHint'
import { formatINR, cn } from '@/lib/utils'

/** #112: a bill whose credit window (s.16(4)) closes with this return or the next. */
export interface EndingSoonBill {
  id: string
  invoiceNo: string | null
  supplier: string | null
  gstin: string | null
  billFp: string
  tax: number
  /** True when THIS return is the last that can claim it. */
  final: boolean
}

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
  /** 9a-1: bills in 2B that 2B marks "ITC not available". */
  notAvailableCount?: number
  notAvailableTax?: number
  /** 9a-4: suppliers' credit notes in 2B not yet recorded in the books. */
  unrecordedNotesCount?: number
  unrecordedNotesTax?: number
  endingSoonTax?: number
  endingSoon?: EndingSoonBill[]
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const monthOf = (fp: string) => `${MONTHS[Number(fp.slice(0, 2)) - 1]} ${fp.slice(2)}`

/**
 * #112: the ending-soon line's rule, in dates. The window for a year's bills
 * shuts on 30 November after it (s.16(4)), so the October return is the last
 * to claim them — and a bill counts only once it is in GSTR-2B, whose cut-off
 * for October is 13 November (the supplier's GSTR-1 is due on the 11th).
 */
export function endingSoonInfo(bills: EndingSoonBill[]): string {
  const fy = (fp: string) => { const m = Number(fp.slice(0, 2)); const y = Number(fp.slice(2)); return m >= 4 ? y : y - 1 }
  const y = fy(bills[0].billFp)
  const label = `${y}-${String((y + 1) % 100).padStart(2, '0')}`
  const lastYear = y + 1
  return `Section 16(4): credit on ${label} bills can be claimed only until 30 November ${lastYear}, so the October ${lastYear} GSTR-3B is the last return that can carry it. `
    + `A bill counts only once it is in your GSTR-2B — ask each supplier to file it in their GSTR-1 by 11 November ${lastYear}, because October's GSTR-2B closes on 13 November. After that the credit is lost for good.`
}

const bills = (n: number) => `${n} ${n === 1 ? 'bill' : 'bills'}`

export function ItcClaimNotes({ detail }: { detail: ItcDetail | null | undefined }) {
  if (!detail) return null
  // #112: bills already named in the ending-soon box are not counted again on the waiting line.
  const soon = detail.endingSoon ?? []
  const waitingCount = detail.deferredCount + detail.stillWaitingCount - soon.length
  const waitingTax = Math.round((detail.deferredTax + detail.stillWaitingTax - (detail.endingSoonTax ?? 0)) * 100) / 100
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
  if ((detail.notAvailableTax ?? 0) > 0) lines.push({
    key: 'no-credit', tone: 'bad',
    text: `${formatINR(detail.notAvailableTax!)} not claimed — GSTR-2B says no credit (${bills(detail.notAvailableCount ?? 0)})`,
    info: 'Your GSTR-2B lists these bills with input credit marked "not available", so it is not claimed; claiming it would invite a DRC-01C notice (Rule 88D). The portal’s reason code is on the GSTR-2B screen. If it looks wrong, ask the supplier to check the GSTIN and place of supply on their bill.',
  })
  if ((detail.unrecordedNotesTax ?? 0) > 0) lines.push({
    key: 'notes', tone: 'check',
    text: `${formatINR(detail.unrecordedNotesTax!)} in suppliers' credit notes not in your books (${(detail.unrecordedNotesCount ?? 0) === 1 ? '1 note' : `${detail.unrecordedNotesCount} notes`})`,
    info: 'Your GSTR-2B has credit notes from suppliers. Once accepted on the portal, they cut your credit by their GST in GSTR-3B. Record each as a return to the supplier (Supplier bills → Notes from suppliers) so your figures match the portal.',
  })
  if (detail.lapsedTax > 0) lines.push({
    key: 'lapsed', tone: 'bad',
    text: `${formatINR(detail.lapsedTax)} can no longer be claimed — past 30 November (${bills(detail.lapsedCount)})`,
    info: 'Section 16(4): credit for a bill must be claimed by 30 November after the end of its financial year (or the annual return, if filed earlier).',
  })
  if (lines.length === 0 && soon.length === 0) return null

  return (
    <div className="mt-3 pt-3 border-t space-y-1.5" data-testid="itc-claim-notes">
    {soon.length > 0 && <EndingSoon bills={soon} total={detail.endingSoonTax ?? 0} />}
    <ul className="space-y-1.5">
      {lines.map((l) => (
        <li key={l.key} className={cn('text-xs flex items-center gap-1', {
          'text-good': l.tone === 'good', 'text-check font-medium': l.tone === 'check', 'text-bad font-medium': l.tone === 'bad', 'text-muted-foreground': l.tone === 'muted',
        })}>
          <span className="min-w-0">{l.text}</span>
          <InfoHint text={l.info} label={l.text} className="ml-1" />
        </li>
      ))}
    </ul>
    </div>
  )
}

/** #112: the credit about to be lost, by supplier — the one list worth phoning from. */
function EndingSoon({ bills: list, total }: { bills: EndingSoonBill[]; total: number }) {
  const [open, setOpen] = useState(false)
  const final = list.some((b) => b.final)
  const n = list.length
  return (
    <div className={cn('rounded-lg border px-3 py-2', final ? 'border-bad/30 bg-bad-soft' : 'border-check/30 bg-check-soft')} data-testid="itc-ending-soon">
      <div className="flex items-center gap-1 text-xs">
        <span className={cn('min-w-0 font-medium', final ? 'text-bad' : 'text-check')}>
          {formatINR(total)} of credit ends {final ? 'with this return' : 'next month'} — {bills(n)} your suppliers have not filed
        </span>
        <InfoHint text={endingSoonInfo(list)} label="when this credit ends" className="ml-1" />
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          className="ml-auto -my-2 flex-shrink-0 text-xs font-medium text-primary hover:underline min-h-12 px-2"
        >
          {open ? 'Hide' : n === 1 ? 'See bill' : 'See bills'}
        </button>
      </div>
      {open && (
        <ul className="mt-1.5 divide-y divide-border/60">
          {list.map((b) => (
            <li key={b.id} className="py-1.5 flex items-baseline gap-2 text-xs">
              <span className="min-w-0 flex-1 truncate">
                <span className="font-medium">{b.supplier || b.gstin || 'Supplier'}</span>
                <span className="text-muted-foreground"> · {b.invoiceNo || 'no bill no.'} · {monthOf(b.billFp)}</span>
              </span>
              <span className="tabular-nums font-semibold flex-shrink-0">{formatINR(b.tax)}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
