'use client'

/**
 * "This load probably needs an e-way bill."
 *
 * WHY IT SITS ON THE INVOICE (2026-08-09). This is the last screen a shopkeeper
 * sees before the goods go out — it is where Print and Send bill live, and it
 * is the moment the decision still matters. On the sale-entry screen it would
 * compete with finishing the bill; after the vehicle has left it is worthless.
 *
 * WHY IT NEVER SAYS "YOU MUST". Inter-state is a flat ₹50,000, but several
 * states notified HIGHER intra-state limits, so within a state the app cannot
 * know. It raises the question and names the number it used; asserting an
 * obligation it cannot verify would be a lie, and a shopkeeper who catches the
 * app being wrong once stops believing the warnings that matter.
 *
 * ONCE A NUMBER IS RECORDED IT GOES QUIET. A warning that stays up after the
 * job is done is how people learn to ignore warnings.
 */

import { Truck } from 'lucide-react'
import { formatINR } from '@/lib/utils'
import { ewayBillNeed, invoiceMovesGoods } from '@/lib/eway-bill'

export function EwayBillNotice({
  totalAmount,
  isInterState,
  items,
  ewayBillNo,
  type,
}: {
  totalAmount: number
  isInterState: boolean
  items: Array<{ hsn?: string | null }>
  ewayBillNo?: string | null
  type?: string
}) {
  // Only outward movement of goods. A purchase is the supplier's consignment.
  if (type && type !== 'sale') return null
  // Already generated — the shopkeeper has dealt with it.
  if (ewayBillNo) return null

  const need = ewayBillNeed({
    consignmentValue: totalAmount,
    isInterState,
    movesGoods: invoiceMovesGoods(items || []),
  })
  if (need.status !== 'likely-required') return null

  return (
    <div className="rounded-2xl border border-amber-200 dark:border-amber-900 bg-amber-50 dark:bg-amber-950/30 p-4 flex items-start gap-3">
      <Truck className="w-5 h-5 text-amber-600 dark:text-amber-400 flex-shrink-0 mt-0.5" />
      <div className="min-w-0">
        <p className="font-semibold text-sm text-amber-900 dark:text-amber-200">
          Check if this needs an e-way bill
        </p>
        <p className="text-xs text-amber-800 dark:text-amber-300 mt-1">{need.reason}</p>
        {/*
          * The number it judged on, stated plainly. A shopkeeper who can see
          * WHY it asked can tell in one glance whether it applies to them —
          * and can dismiss it correctly when their state allows more.
          */}
        <p className="text-2xs text-amber-700 dark:text-amber-400 mt-1.5">
          This bill is {formatINR(totalAmount)}. Generate it on the e-way bill portal before the
          goods leave, then save the number here.
        </p>
      </div>
    </div>
  )
}
