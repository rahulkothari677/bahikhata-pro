'use client'

/**
 * Shown when a report's data arrived but the part it needs is missing.
 *
 * WHY THIS EXISTS (2026-08-07, money sweep). Each of these reports opened with
 * a line like:
 *
 *   const summary = data?.summary || { totalRevenue: 0, totalProfit: 0, ... }
 *
 * added to stop a crash, and it does stop it. What it puts on screen instead is
 * a shop that earned ₹0 and made ₹0 profit — stated as confidently as real
 * figures, with nothing marking them as invented.
 *
 * For a ledger that is the worst available failure. A blank says "I don't know"
 * and the shopkeeper waits or retries; a fabricated ₹0 says "your month was
 * empty" and they believe it, because the app has never lied to them before.
 *
 * Reports.tsx already blocks these components until data exists, so this is
 * reachable only when the API answers 200 with a body missing its summary. Rare
 * — and precisely the case where a wrong number would be least questioned.
 */

import { AlertCircle } from 'lucide-react'

export function ReportUnavailable({ what = 'report' }: { what?: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-16 px-4 text-center">
      <div className="w-12 h-12 rounded-full bg-amber-100 dark:bg-amber-950 flex items-center justify-center mb-3">
        <AlertCircle className="w-6 h-6 text-amber-600 dark:text-amber-400" />
      </div>
      <h3 className="font-semibold text-slate-800 dark:text-slate-200 mb-1">
        Couldn&apos;t load this {what}
      </h3>
      <p className="text-sm text-slate-500 dark:text-slate-400 max-w-sm">
        The figures came back incomplete, so nothing is shown rather than a total
        that might be wrong. Please try again, or pick a shorter date range.
      </p>
    </div>
  )
}
