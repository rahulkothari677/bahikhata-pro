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
import { Notice } from '@/components/ui/notice'

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
      <Notice
        level="clear"
        icon={Truck}
        title={<>E-way bill <span className="font-mono">{ewayBillNo}</span></>}
      />
    )
  }

  const need = ewayBillNeed({
    consignmentValue: totalAmount,
    isInterState,
    movesGoods: invoiceMovesGoods(items || []),
    stateCode,
  })
  if (need.status !== 'likely-required') return null

  /*
   * Phase 4b: the one warning box, level Act (it has a ₹ amount and a thing
   * to do). The amount it judged on stays on screen, so a shopkeeper can tell
   * at a glance whether it applies; the reason behind it sits behind ⓘ.
   *
   * The number goes in on the warning itself. Sending the shopkeeper to an
   * edit screen would leave the alert up while they hunted for the field,
   * and a warning that cannot be resolved where it appears is one people
   * learn to scroll past.
   */
  return (
    <Notice
      level="act"
      icon={Truck}
      title="Check if this needs an e-way bill"
      info={`${need.reason} Generate it on the e-way bill portal before the goods leave, then save the number here.`}
      action={transactionId ? (
        <div className="flex items-center gap-2 w-full min-w-0">
          <Input
            value={num}
            onChange={(e) => setNum(e.target.value)}
            inputMode="numeric"
            placeholder="12-digit number"
            className="h-12 text-base bg-card"
            aria-label="E-way bill number"
          />
          <Button className="h-12 min-w-20 flex-shrink-0" onClick={save} disabled={saving || num.trim().length === 0}>
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Save'}
          </Button>
        </div>
      ) : undefined}
    >
      This bill is {formatINR(totalAmount)}.
    </Notice>
  )
}
