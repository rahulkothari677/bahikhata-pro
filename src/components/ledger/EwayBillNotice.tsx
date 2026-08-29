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

import { useState } from 'react'
import { Truck, Loader2 } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { offlineFetch } from '@/lib/offline-fetch'
import { toast as sonnerToast } from 'sonner'
import { useQueryClient } from '@tanstack/react-query'
import { formatINR } from '@/lib/utils'
import { ewayBillNeed, invoiceMovesGoods } from '@/lib/eway-bill'

export function EwayBillNotice({
  totalAmount,
  isInterState,
  items,
  ewayBillNo,
  type,
  transactionId,
  stateCode,
}: {
  totalAmount: number
  isInterState: boolean
  items: Array<{ hsn?: string | null }>
  ewayBillNo?: string | null
  type?: string
  transactionId?: string
  /**
   * GST state code of the place of supply, for the intra-state threshold.
   * Absent falls back to the central ₹50,000 — safe in the direction that
   * matters. See lib/eway-bill.ts.
   */
  stateCode?: string | null
}) {
  const [num, setNum] = useState('')
  const [saving, setSaving] = useState(false)
  const qc = useQueryClient()

  /*
   * Saving the number is what makes the warning go away, so it lives ON the
   * warning. Sending the shopkeeper to an edit screen to record it would leave
   * the alert up while they hunted for the field.
   */
  const save = async () => {
    if (!transactionId) return
    setSaving(true)
    try {
      const r = await offlineFetch('/api/eway-bill', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ transactionId, ewayBillNo: num.trim() }),
      })
      const b = await r.json().catch(() => ({}))
      if (!r.ok) { sonnerToast.error(b.message || b.error || 'Could not save'); return }
      sonnerToast.success('E-way bill number saved')
      qc.invalidateQueries({ queryKey: ['transaction'] })
    } finally { setSaving(false) }
  }
  // Only outward movement of goods. A purchase is the supplier's consignment.
  if (type && type !== 'sale') return null

  /*
   * Already generated — show the number, quietly.
   *
   * It used to return null here, and the only place the number appeared was
   * inside the e-invoice card. That card is hidden for any shop below the ₹5
   * crore e-invoicing threshold — which is almost every shop this app is for —
   * so a shopkeeper could save the number and never see it again. E-way bills
   * and e-invoices are unrelated obligations and must not share a surface.
   *
   * This is also the number an officer asks for at a checkpoint, so it belongs
   * on the bill, not two screens away.
   */
  if (ewayBillNo) {
    return (
      <div className="rounded-2xl border border-border/60 bg-muted/30 px-4 py-3 flex items-center gap-3">
        <Truck className="w-4 h-4 text-muted-foreground flex-shrink-0" />
        <p className="text-xs text-muted-foreground">
          E-way bill <span className="font-mono font-medium text-foreground">{ewayBillNo}</span>
        </p>
      </div>
    )
  }

  const need = ewayBillNeed({
    consignmentValue: totalAmount,
    isInterState,
    movesGoods: invoiceMovesGoods(items || []),
    stateCode,
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

        {/*
          * The number goes in on the warning itself. Sending the shopkeeper to
          * an edit screen would leave the alert up while they hunted for the
          * field — and a warning that cannot be resolved where it appears is
          * one people learn to scroll past.
          */}
        {transactionId && (
          <div className="mt-3 flex items-center gap-2">
            <Input
              value={num}
              onChange={(e) => setNum(e.target.value)}
              inputMode="numeric"
              placeholder="12-digit number"
              className="h-9 text-sm bg-white dark:bg-background"
              aria-label="E-way bill number"
            />
            <Button size="sm" className="h-9 flex-shrink-0" onClick={save} disabled={saving || num.trim().length === 0}>
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Save'}
            </Button>
          </div>
        )}
      </div>
    </div>
  )
}
