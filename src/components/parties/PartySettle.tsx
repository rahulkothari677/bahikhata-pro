'use client'

/**
 * 🔒 AUDIT C5 — Settle Payment, on its own page.
 *
 * This was a dialog. With nine open bills the bill list pushed Payment Mode,
 * Notes and the Record button off-screen and the dialog became unusable — a
 * shopkeeper could see the bills or the save button, never both.
 *
 * ONE INTERFACE, NOT TWO MODES. The earlier dialog had a read-only "this will
 * clear" preview plus a separate "choose bills myself" editor, and the
 * shopkeeper had to know the second one existed. Here the bills are always
 * listed with editable amounts, auto-filled oldest-first as the total is typed.
 * Typing ₹500 fills the oldest bills automatically; changing any box just
 * works. Nothing to discover.
 *
 * Auto-fill STOPS the moment a box is edited by hand. Silently overwriting a
 * deliberate choice on the next keystroke would be worse than not helping at
 * all.
 */

import { useState, useEffect, useMemo, useRef } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import { useAppStore } from '@/store/app-store'
import { formatINR, formatDate, cn } from '@/lib/utils'
import { roundMoney } from '@/lib/money'
import { computeInvoiceDue, planAllocationOldestFirst } from '@/lib/invoice-due'
import { offlineFetch, isQueuedResponse } from '@/lib/offline-fetch'
import { invalidateMoneyCaches } from '@/lib/invalidate-money-caches'
import { readError } from '@/lib/read-error'
import { haptic } from '@/lib/haptic'
import { useConfirmDialog } from '@/hooks/use-confirm-dialog'
import { toast as sonnerToast } from 'sonner'
import { ArrowLeft, HandCoins, Loader2, Wand2 } from 'lucide-react'

export function PartySettle() {
  const {
    selectedPartyId, setView, pendingSettle, setPendingSettle, triggerRefresh,
  } = useAppStore()
  const queryClient = useQueryClient()
  const { confirmDialog, dialog: confirmDialogEl } = useConfirmDialog()

  const [paymentType, setPaymentType] = useState<'received' | 'paid'>('received')
  const [amount, setAmount] = useState('')
  const [mode, setMode] = useState('cash')
  const [notes, setNotes] = useState('')
  const [saving, setSaving] = useState(false)
  const [alloc, setAlloc] = useState<Record<string, string>>({})
  // Once the shopkeeper edits a bill box, auto-fill stops. Their choice wins.
  const [touched, setTouched] = useState(false)
  const consumedIntent = useRef(false)

  const { data, isLoading } = useQuery({
    queryKey: ['party', selectedPartyId, 'settle'],
    queryFn: async () => {
      const r = await fetch(`/api/parties/${selectedPartyId}`)
      if (!r.ok) throw new Error('Failed to load party')
      return r.json()
    },
    enabled: !!selectedPartyId,
  })

  const party = data?.party
  const balance = Number(data?.stats?.balance ?? 0)

  /** Open bills, oldest first — the order money reaches them. */
  const openBills = useMemo(() => {
    return (data?.transactions || [])
      // Only sale/purchase. A credit note is a return, not something a payment
      // settles.
      .filter((t: any) => t.type === 'sale' || t.type === 'purchase')
      .map((t: any) => ({ ...t, due: computeInvoiceDue(t) }))
      .filter((b: any) => b.due > 0)
      .sort((a: any, b: any) => new Date(a.date).getTime() - new Date(b.date).getTime())
  }, [data])

  const parsedAmount = roundMoney(parseFloat(amount) || 0)
  const totalOpen = roundMoney(openBills.reduce((s: number, b: any) => s + b.due, 0))
  const stats = data?.stats

  /**
   * 🔒 DOUBLE-COUNT GUARD (2026-07-22, hit for real).
   *
   * Money typed into a bill's "Paid Amount" and money recorded here BOTH reduce
   * what the customer owes. Entering the same ₹100 in both places makes the
   * dues read ₹100 low, and the statement sent to that customer understates the
   * debt — so the shopkeeper under-collects.
   *
   * Carried over from the dialog this page replaced. Moving a screen must not
   * quietly drop its safety rails; a guard test caught that I had.
   *
   * Received money compares against invoice `totalReceived`, money paid out
   * against `totalPaid` — using one for both would show a supplier the customer
   * figure.
   */
  const alreadyPaidOnBills = paymentType === 'received'
    ? (stats?.totalReceived ?? 0)
    : (stats?.totalPaid ?? 0)

  /** How far the typed amount exceeds what is actually outstanding. */
  const overpayAmount = Math.max(0, parsedAmount - Math.abs(balance))

  /**
   * Default the direction once, when the party loads.
   *
   * Two things point at "money going out", not one:
   *  - a supplier, who is normally paid rather than collected from; and
   *  - ANY party whose balance is negative, which by this app's convention
   *    (see the "You owe them" label below) means we owe them — a customer who
   *    overpaid, or whose credit notes exceed their bills. Settling that means
   *    handing money back.
   *
   * Dropping the second branch would let the page read "You owe them" while the
   * direction box said "Received", and a shopkeeper who didn't catch it would
   * record the payment backwards — moving the balance the wrong way by twice
   * the amount.
   *
   * Guarded by a ref so a manual change to the dropdown is never overwritten.
   */
  const directionDefaulted = useRef(false)
  useEffect(() => {
    if (!data || directionDefaulted.current) return
    directionDefaulted.current = true
    if (party?.type === 'supplier' || balance < 0) setPaymentType('paid')
  }, [data, party?.type, balance])

  /**
   * "Settle THIS bill", handed over from the Bills page. Pre-fills the amount
   * with that bill's due and points the allocation at it — but the amount stays
   * editable, because paying ₹200 against a ₹553 bill is the ordinary case.
   */
  useEffect(() => {
    if (!pendingSettle || consumedIntent.current) return
    consumedIntent.current = true
    setAmount(String(pendingSettle.amount))
    setAlloc({ [pendingSettle.transactionId]: String(pendingSettle.amount) })
    setTouched(true)   // an explicit bill choice must not be auto-overwritten
    setPendingSettle(null)
  }, [pendingSettle, setPendingSettle])

  /**
   * Auto-fill oldest-first as the total changes — using the SAME planner the
   * server uses, so what is shown is what will happen.
   */
  useEffect(() => {
    if (touched) return
    if (parsedAmount <= 0) { setAlloc({}); return }
    const plan = planAllocationOldestFirst(openBills, parsedAmount)
    const next: Record<string, string> = {}
    for (const a of plan.allocations) next[a.transactionId] = String(a.amount)
    setAlloc(next)
  }, [parsedAmount, openBills, touched])

  const allocatedTotal = roundMoney(
    Object.values(alloc).reduce((s, v) => s + (parseFloat(v) || 0), 0),
  )
  const overBill = useMemo(() => {
    for (const b of openBills as any[]) {
      if (roundMoney(parseFloat(alloc[b.id] || '0') || 0) > b.due) {
        return b.invoiceNo || b.id.slice(-6)
      }
    }
    return null
  }, [alloc, openBills])

  const overAllocated = allocatedTotal > parsedAmount
  const canSave = parsedAmount > 0 && !overAllocated && !overBill && !saving

  const handleSave = async () => {
    if (!canSave) return

    // 🔒 Over-payment requires a deliberate act, and the confirmation happens
    // BEFORE the network call. The original bug warned only after the server
    // had already stored it — too late to be a warning at all.
    const outstanding = Math.abs(balance)
    // The 0.005 tolerance matters: settling the EXACT outstanding amount must
    // not ask "are you sure". Without it, float drift on a figure like
    // ₹2,706.74 can read as a fraction-of-a-paisa overpayment and prompt every
    // time — and a confirmation that fires on the normal case is one people
    // learn to click through, which is how the real warning stops working.
    if (parsedAmount > outstanding + 0.005) {
      const extra = roundMoney(overpayAmount)
      const confirmed = await confirmDialog(
        alreadyPaidOnBills > 0
          ? `${party?.name} owes ${formatINR(outstanding)}, but you are recording ${formatINR(parsedAmount)} — ${formatINR(extra)} extra. ${formatINR(alreadyPaidOnBills)} is already recorded as paid on their bills. If this money was typed into a bill's "Paid Amount", recording it again here will make the dues show ${formatINR(extra)} less than reality.`
          : `${party?.name} owes ${formatINR(outstanding)}, but you are recording ${formatINR(parsedAmount)}. The extra ${formatINR(extra)} will be treated as an advance.`,
        { title: 'More than they owe', confirmLabel: 'Yes, record it', destructive: true },
      )
      if (!confirmed) return
    }

    setSaving(true)
    try {
      const allocations = Object.entries(alloc)
        .map(([transactionId, v]) => ({ transactionId, amount: roundMoney(parseFloat(v) || 0) }))
        .filter(a => a.amount > 0)

      const r = await offlineFetch('/api/payments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          partyId: selectedPartyId,
          amount: parsedAmount,
          type: paymentType,
          mode,
          notes: notes || undefined,
          // Always explicit from this screen: the shopkeeper can see exactly
          // which bills the money is going to, so sending anything else would
          // mean the screen and the result could differ.
          allocations: allocations.length > 0 ? allocations : undefined,
        }),
        offline: { invalidate: ['/api/parties', '/api/dashboard'] },
      })
      if (!r.ok) throw new Error(await readError(r))

      sonnerToast.success(
        isQueuedResponse(r)
          ? 'Saved — will sync when online'
          : paymentType === 'received' ? 'Payment received!' : 'Payment recorded!',
      )
      haptic.success()
      queryClient.invalidateQueries({ queryKey: ['party'] })
      invalidateMoneyCaches(queryClient)
      triggerRefresh()
      setView('party-profile')
    } catch (e: any) {
      sonnerToast.error(e?.message || 'Could not record payment')
    } finally {
      setSaving(false)
    }
  }

  if (isLoading || !data) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-10 w-48" />
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    )
  }

  return (
    <div className="space-y-4 pb-28">
      <div className="flex items-center gap-2">
        <Button variant="ghost" size="sm" onClick={() => setView('party-profile')} className="gap-1">
          <ArrowLeft className="w-4 h-4" /> Back
        </Button>
        <div className="min-w-0">
          <h1 className="text-lg font-bold truncate flex items-center gap-2">
            <HandCoins className="w-4 h-4 shrink-0 text-primary" /> Settle Payment
          </h1>
          <p className="text-xs text-muted-foreground truncate">{party?.name}</p>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <Card className="shadow-card border-border/60">
          <CardContent className="p-3">
            <p className="text-2xs text-muted-foreground uppercase tracking-wide">Outstanding</p>
            <p className="text-lg font-bold">{formatINR(Math.abs(balance))}</p>
            <p className="text-2xs text-muted-foreground">
              {balance > 0 ? 'They owe you' : balance < 0 ? 'You owe them' : 'Settled'}
            </p>
          </CardContent>
        </Card>
        <Card className="shadow-card border-border/60">
          <CardContent className="p-3">
            <p className="text-2xs text-muted-foreground uppercase tracking-wide">Open bills</p>
            <p className="text-lg font-bold text-rose-600">{formatINR(totalOpen)}</p>
            <p className="text-2xs text-muted-foreground">
              {openBills.length} {openBills.length === 1 ? 'bill' : 'bills'}
            </p>
          </CardContent>
        </Card>
      </div>

      <Card className="shadow-card border-border/60">
        <CardContent className="p-3 space-y-3">
          <div>
            <Label htmlFor="settle-type">Payment Type</Label>
            <Select value={paymentType} onValueChange={(v) => setPaymentType(v as 'received' | 'paid')}>
              <SelectTrigger id="settle-type" className="mt-1"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="received">Received from customer</SelectItem>
                <SelectItem value="paid">Paid to supplier</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {/* 🔒 DOUBLE-COUNT GUARD — the numbers on screen BEFORE saving, not a
              toast afterwards. See the note on alreadyPaidOnBills above. */}
          {alreadyPaidOnBills > 0 && (
            <div className="rounded-lg border border-amber-300 bg-amber-50 dark:bg-amber-950/30 p-3 text-2xs space-y-1">
              <p className="font-semibold text-amber-900 dark:text-amber-200">
                Already recorded on this party&rsquo;s bills: {formatINR(alreadyPaidOnBills)}
              </p>
              <p className="text-amber-800 dark:text-amber-300">
                Enter money received <strong>separately</strong> from the bills.
                If that {formatINR(alreadyPaidOnBills)}{' '}
                was already typed into a bill&rsquo;s &ldquo;Paid Amount&rdquo;,
                do not enter it again here.
              </p>
              <p className="text-amber-800 dark:text-amber-300">
                Outstanding right now: <strong>{formatINR(Math.abs(balance))}</strong>
              </p>
            </div>
          )}
          <div>
            <Label htmlFor="settle-amount">Amount received (₹)</Label>
            <Input
              id="settle-amount"
              inputMode="decimal"
              type="number"
              value={amount}
              onChange={(e) => { setAmount(e.target.value); setTouched(false) }}
              placeholder="0"
              className="mt-1 text-lg font-semibold"
              autoFocus
            />
            {overpayAmount > 0 && (
              <p className="text-2xs text-rose-600 dark:text-rose-400 mt-1">
                This is {formatINR(overpayAmount)} more than the {formatINR(Math.abs(balance))} outstanding.
                {alreadyPaidOnBills > 0 ? ' That usually means this amount is already recorded on a bill.' : ''}
              </p>
            )}
            <p className="text-2xs text-muted-foreground mt-1">
              Bills below fill automatically, oldest first. Change any of them if needed.
            </p>
          </div>
        </CardContent>
      </Card>

      {/*
        The bills are ALWAYS listed — not revealed once an amount is typed.
        A shopkeeper needs to see what is outstanding in order to decide the
        amount; hiding the list until after that decision is backwards.
        Each row shows its billing DATE, because with nine invoices numbered
        alike the date is how a customer refers to one.
      */}
      {openBills.length > 0 && (
        <Card className="shadow-card border-border/60">
          <CardContent className="p-3 space-y-2">
            <div className="flex items-center justify-between gap-2">
              <p className="text-xs font-semibold">Apply to bills</p>
              {touched && parsedAmount > 0 && (
                <button
                  type="button"
                  className="text-2xs text-primary underline underline-offset-2 flex items-center gap-1"
                  onClick={() => setTouched(false)}
                >
                  <Wand2 className="w-3 h-3" /> Auto-fill oldest first
                </button>
              )}
            </div>

            {/* Scrolls independently, so the total and the Record button below
                stay reachable no matter how many bills there are — the exact
                failure that made the dialog unusable. */}
            <div className="max-h-[45vh] overflow-y-auto -mx-1 px-1 space-y-1.5">
              {openBills.map((b: any) => {
                const v = roundMoney(parseFloat(alloc[b.id] || '0') || 0)
                const isOver = v > b.due
                return (
                  <div key={b.id} className="flex items-center justify-between gap-2 py-1">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span className="text-xs font-medium truncate">
                          {b.invoiceNo || b.id.slice(-6)}
                        </span>
                        {v > 0 && v >= b.due && (
                          <Badge variant="outline" className="text-3xs px-1 py-0 text-emerald-600 border-emerald-300">
                            clears
                          </Badge>
                        )}
                      </div>
                      <p className="text-2xs text-muted-foreground">
                        {formatDate(b.date)} · due {formatINR(b.due)}
                      </p>
                    </div>
                    <Input
                      inputMode="decimal"
                      type="number"
                      value={alloc[b.id] ?? ''}
                      onChange={(e) => {
                        setTouched(true)
                        setAlloc(m => ({ ...m, [b.id]: e.target.value }))
                      }}
                      placeholder="0"
                      className={cn('h-8 w-28 text-xs shrink-0', isOver && 'border-rose-500 text-rose-600')}
                    />
                  </div>
                )
              })}
            </div>

            <div
              className={cn(
                'flex items-center justify-between text-xs pt-2 border-t border-border',
                overAllocated ? 'text-rose-600' : 'text-muted-foreground',
              )}
            >
              <span>Applied to bills</span>
              <span className="font-semibold tabular-nums">
                {formatINR(allocatedTotal)} of {formatINR(parsedAmount)}
              </span>
            </div>

            {overBill && (
              <p className="text-2xs text-rose-600">
                {overBill} is more than that bill still owes.
              </p>
            )}
            {overAllocated && (
              <p className="text-2xs text-rose-600">
                You have applied more than the amount received.
              </p>
            )}
            {!overAllocated && !overBill && parsedAmount > allocatedTotal && (
              <p className="text-2xs text-muted-foreground">
                {formatINR(parsedAmount - allocatedTotal)} will be kept as an advance.
              </p>
            )}
          </CardContent>
        </Card>
      )}

      <Card className="shadow-card border-border/60">
        <CardContent className="p-3 space-y-3">
          <div>
            <Label htmlFor="settle-mode">Payment Mode</Label>
            <Select value={mode} onValueChange={setMode}>
              <SelectTrigger id="settle-mode" className="mt-1"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="cash">Cash</SelectItem>
                <SelectItem value="upi">UPI</SelectItem>
                <SelectItem value="card">Card</SelectItem>
                <SelectItem value="bank">Bank Transfer</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label htmlFor="settle-notes">Notes (optional)</Label>
            <Input
              id="settle-notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="e.g. Part payment for July"
              className="mt-1"
            />
          </div>
        </CardContent>
      </Card>

      {/* Pinned so it is reachable regardless of list length. */}
      <div className="fixed bottom-0 left-0 right-0 border-t border-border bg-background/95 backdrop-blur p-3 z-40 md:pl-24">
        <div className="max-w-3xl mx-auto flex items-center gap-2">
          <Button variant="outline" onClick={() => setView('party-profile')} className="flex-1">
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={!canSave} className="flex-[2] bg-gradient-saffron gap-2">
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
            {saving ? 'Saving…' : `Record ${formatINR(parsedAmount)}`}
          </Button>
        </div>
      </div>
    {confirmDialogEl}
    </div>
  )
}
