'use client'

/**
 * "These invoices no longer match what you filed."
 *
 * WHY THIS SCREEN EXISTS (2026-08-09). The amendment engine landed a commit
 * earlier and was completely invisible: it emits Table 9A into the GSTR-1 JSON,
 * and unless a shopkeeper opened the raw file they had no idea a correction was
 * pending. That is the same mistake as the filing-readiness card, which shipped
 * mounted in the wrong branch and showed nothing at all — a correct engine with
 * no surface is not a feature.
 *
 * WHAT IT HAS TO COMMUNICATE, and why the wording is careful:
 *
 * A shopkeeper's instinct on seeing "this invoice changed" is that they have
 * done something wrong. They usually have not — editing a bill is a normal
 * thing to do, and the app allowed it. What is NOT normal is leaving the
 * department with a different version. So the tone is "this needs declaring",
 * never "you made a mistake".
 *
 * It also has to explain the consequence honestly, because the consequence
 * lands on someone else: for a B2B invoice the buyer's input credit comes from
 * the seller's FILED figures. Until the amendment is filed, the buyer is stuck
 * with the old ones and cannot fix it from their side.
 *
 * The original number is shown next to the new one deliberately. That pair is
 * what a CA reconciles against, and what the portal matches on.
 */

import { FileWarning, ArrowRight } from 'lucide-react'
import { formatINR } from '@/lib/utils'

interface AmendedInvoice {
  oinum: string
  oidt: string
  inum: string
  idt: string
  val: number
  changes: string[]
}

export function NeedsAmending({
  b2ba,
  b2cla,
}: {
  b2ba?: Array<{ ctin: string; inv: AmendedInvoice[] }>
  b2cla?: Array<{ pos: string; inv: AmendedInvoice[] }>
}) {
  const rows: Array<{ key: string; who: string; inv: AmendedInvoice }> = []
  for (const g of b2ba || []) for (const inv of g.inv) rows.push({ key: `b2b-${g.ctin}-${inv.oinum}`, who: g.ctin, inv })
  for (const g of b2cla || []) for (const inv of g.inv) rows.push({ key: `b2cl-${g.pos}-${inv.oinum}`, who: `Place of supply ${g.pos}`, inv })

  // Nothing to declare is the normal case, and it says nothing at all.
  if (rows.length === 0) return null

  return (
    <div className="rounded-2xl border border-amber-200 dark:border-amber-900 bg-amber-50 dark:bg-amber-950/30 overflow-hidden">
      <div className="px-4 py-3 flex items-start gap-3 border-b border-amber-200 dark:border-amber-900">
        <FileWarning className="w-5 h-5 text-amber-600 dark:text-amber-400 flex-shrink-0 mt-0.5" />
        <div className="min-w-0">
          <p className="font-semibold text-sm text-amber-900 dark:text-amber-200">
            {rows.length} {rows.length === 1 ? 'invoice needs' : 'invoices need'} amending
          </p>
          <p className="text-xs text-amber-800 dark:text-amber-300 mt-0.5">
            These changed after you filed the return they were in. They are included in this
            month&apos;s return as amendments, which is how a filed invoice is corrected — you do
            not need to do anything else.
          </p>
        </div>
      </div>

      <div className="divide-y divide-amber-200 dark:divide-amber-900">
        {rows.map(({ key, who, inv }) => (
          <div key={key} className="px-4 py-3">
            <div className="flex items-baseline justify-between gap-3">
              {/*
                * Original number beside the new one. That pair is what the
                * portal matches on and what a CA reconciles against, so it is
                * shown rather than hidden behind the current number alone.
                */}
              <p className="text-sm font-medium text-amber-900 dark:text-amber-200 truncate">
                {inv.oinum}
                {inv.inum !== inv.oinum && (
                  <span className="text-amber-700 dark:text-amber-400 font-normal">
                    {' '}<ArrowRight className="w-3 h-3 inline -mt-0.5" /> {inv.inum}
                  </span>
                )}
              </p>
              <span className="text-sm font-semibold tabular-nums text-amber-900 dark:text-amber-200 flex-shrink-0">
                {formatINR(inv.val)}
              </span>
            </div>
            <p className="text-2xs text-amber-700 dark:text-amber-400 mt-0.5">{who}</p>
            <ul className="mt-1.5 space-y-0.5">
              {inv.changes.map((c) => (
                <li key={c} className="text-xs text-amber-800 dark:text-amber-300">• {c}</li>
              ))}
            </ul>
          </div>
        ))}
      </div>

      {/*
        * The consequence lands on the BUYER, and they cannot fix it themselves —
        * their credit comes from the seller's filed figures. Worth saying, in
        * one line, without alarming anyone about a return that is about to
        * correct itself.
        */}
      {(b2ba || []).length > 0 && (
        <p className="px-4 py-2.5 text-2xs text-amber-800 dark:text-amber-300 bg-amber-100/60 dark:bg-amber-900/20 border-t border-amber-200 dark:border-amber-900">
          Your customer claims input credit from the figures you filed, so until this return is
          filed they are still working from the old ones.
        </p>
      )}
    </div>
  )
}
