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

/**
 * The header row and every bill row share ONE column definition, so the due
 * and the input line up down the whole table. With `auto` columns each row
 * sized itself independently and a header could never align with them.
 *
 * Phone: two columns — details, then the box (the due moves under the invoice
 * number). Tablet up: three, with the due in its own column beside the box.
 */
const GRID_COLS = 'grid-cols-[minmax(0,1fr)_7rem] sm:grid-cols-[minmax(0,1fr)_6.5rem_7rem]'

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
      <div className="p-3 lg:p-4 space-y-3 max-w-3xl mx-auto w-full">
        <Skeleton className="h-10 w-48" />
        <Skeleton className="h-16 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    )
  }

  const owedLabel = balance > 0 ? 'They owe you' : balance < 0 ? 'You owe them' : 'Settled'

  return (
    /*
      LAYOUT
      ------
      A flex column at least one viewport tall, with the action bar STICKY at
      the bottom rather than `fixed`.

      Sticky solves three things `fixed` did not:
        - it cannot overlap MobileBottomNav, which is also `fixed bottom-0 z-40`
          — same edge, same z-index, so on a phone the two fought each other;
        - it needs no `md:pl-24` guess about the sidebar's width; and
        - when the content is SHORT the `flex-1` body pushes the bar down to the
          real bottom, so there is no dead strip under the last card.
    */
    <div className="flex flex-col min-h-[100dvh] w-full">
      {/* This screen carries its own top bar, so page.tsx renders it with
          header="never" — the same pattern Account and More use. The global
          "Dashboard" header above a focused settle screen was just noise. */}
      <div className="sticky top-0 z-20 shrink-0 border-b border-border bg-background/95 backdrop-blur">
        <div className="w-full px-3 lg:px-5 py-2.5 flex items-center gap-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setView('party-profile')}
            className="gap-1 -ml-2 shrink-0"
          >
            <ArrowLeft className="w-4 h-4" /> Back
          </Button>
          <div className="min-w-0 flex-1">
            <h1 className="text-base font-bold truncate flex items-center gap-2">
              <HandCoins className="w-4 h-4 shrink-0 text-primary" /> Settle Payment
            </h1>
            <p className="text-xs text-muted-foreground truncate">{party?.name}</p>
          </div>
        </div>
      </div>

      {/* Full width, matching the Bills page (which has no max-width and fills
          `main` directly). An earlier version centred this in a 768px column;
          on a 1920px desktop that left most of the screen blank while the bill
          table — the part that benefits most from width — stayed cramped. */}
      <div className="flex-1 w-full px-3 lg:px-5 py-3 space-y-3">
        {/*
          ONE summary line, not two cards.

          The old screen showed "Outstanding" and "Open bills" side by side,
          which for almost every party are the SAME number shown twice — they
          only diverge when an advance or a credit note sits outside the open
          bills. So lead with the outstanding figure, and mention the bills
          total only on the occasions it actually differs.
        */}
        <Card className="shadow-card border-border/60">
          <CardContent className="p-3 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
            <div className="flex items-baseline gap-2">
              <span className="text-xl font-bold tabular-nums">{formatINR(Math.abs(balance))}</span>
              <span className="text-sm text-muted-foreground">{owedLabel}</span>
            </div>
            <span className="text-sm text-muted-foreground">
              {openBills.length} open {openBills.length === 1 ? 'bill' : 'bills'}
              {roundMoney(Math.abs(totalOpen - Math.abs(balance))) > 0.005 && (
                <> · {formatINR(totalOpen)} on bills</>
              )}
            </span>
          </CardContent>
        </Card>

        <Card className="shadow-card border-border/60">
          <CardContent className="p-3 space-y-3">
            {/* Type, Mode, Amount and Notes on ONE row once there is width for
                it — four short fields stacked down a 1920px screen is what made
                the page feel empty. They collapse to two columns on a tablet
                and one on a phone.

                Type and Mode stay ABOVE the bills: both describe the money
                being handed over, so deciding them after allocating it read
                backwards. */}
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <div>
                <Label htmlFor="settle-type" className="text-sm">Payment Type</Label>
                <Select value={paymentType} onValueChange={(v) => setPaymentType(v as 'received' | 'paid')}>
                  <SelectTrigger id="settle-type" className="mt-1"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="received">Received from customer</SelectItem>
                    <SelectItem value="paid">Paid to supplier</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label htmlFor="settle-mode" className="text-sm">Payment Mode</Label>
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
                <Label htmlFor="settle-amount" className="text-sm">
                  {paymentType === 'received' ? 'Amount received (₹)' : 'Amount paid (₹)'}
                </Label>
                {/* Sized by its grid column now, rather than by a hard cap. The
                    old full-bleed box made a four-digit number hard to read. */}
                <Input
                  id="settle-amount"
                  inputMode="decimal"
                  type="number"
                  value={amount}
                  onChange={(e) => { setAmount(e.target.value); setTouched(false) }}
                  placeholder="0"
                  className="mt-1 w-full text-lg font-semibold tabular-nums"
                  autoFocus
                />
              </div>

              <div>
                <Label htmlFor="settle-notes" className="text-sm">Notes (optional)</Label>
                <Input
                  id="settle-notes"
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="e.g. Part payment for July"
                  className="mt-1"
                />
              </div>
            </div>

            {/* 🔒 DOUBLE-COUNT GUARD, at the moment of risk.
                This fires only when the amount EXCEEDS what is outstanding —
                the actual signature of re-entering money already typed into a
                bill's "Paid Amount". The screen used to carry a standing amber
                panel instead, which showed on every visit for every party with
                any payment history, i.e. always. A warning that is always on
                is furniture, and it was misread as "you have to pay this".

                Full width, below the row: a warning about money must not be
                squeezed into a quarter-width column and wrapped onto four
                lines. */}
            {overpayAmount > 0 && (
              <p className="text-sm text-rose-600 dark:text-rose-400">
                This is {formatINR(overpayAmount)} more than the {formatINR(Math.abs(balance))} outstanding.
                {alreadyPaidOnBills > 0
                  ? ' That usually means it is already recorded on a bill.'
                  : ''}
              </p>
            )}
            <p className="text-xs text-muted-foreground">
              Bills below fill automatically, oldest first. Change any of them if needed.
            </p>
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
                <p className="text-sm font-semibold">Apply to bills</p>
                {touched && parsedAmount > 0 && (
                  <button
                    type="button"
                    className="text-xs text-primary underline underline-offset-2 flex items-center gap-1"
                    onClick={() => setTouched(false)}
                  >
                    <Wand2 className="w-3.5 h-3.5" /> Auto-fill oldest first
                  </button>
                )}
              </div>

              {/*
                Capped ONLY once the list is long enough to push the running
                total out of sight. Below that there is no cap, so a party with
                two bills does not get a tall empty box — the complaint that the
                old fixed 45vh window created.
              */}
              <div
                className={cn(
                  '-mx-1 px-1 divide-y divide-border/70',
                  openBills.length > 6 && 'max-h-[42vh] overflow-y-auto',
                )}
              >
                {/*
                  Column headers, so nine rows of money read as a table rather
                  than as a caption floating a long way from its box.

                  INSIDE the scroll container, deliberately. Sitting outside it,
                  the header was 6px wider than the rows, because once the list
                  is capped it carries a scrollbar gutter and the header does
                  not — a misalignment measured in the browser, not guessed at.
                  In here it shares the rows' exact width, and `sticky` keeps
                  the labels visible while the list scrolls.

                  Hidden on a phone, where the due sits under the invoice number
                  and a header would only cost a line.
                */}
                <div className={cn(GRID_COLS, 'hidden sm:grid gap-x-3 sticky top-0 z-10 bg-card pb-1 text-xs text-muted-foreground')}>
                  <span>Bill</span>
                  <span className="text-right">Due</span>
                  <span className="text-right">Apply</span>
                </div>
                {openBills.map((b: any) => {
                  const v = roundMoney(parseFloat(alloc[b.id] || '0') || 0)
                  const isOver = v > b.due
                  return (
                    /* Three columns, so the due sits NEXT TO the box you type
                       into instead of being separated from it by a wide empty
                       gap on a desktop screen. */
                    <div
                      key={b.id}
                      className={cn('grid', GRID_COLS, 'items-center gap-x-3 gap-y-1 py-2')}
                    >
                      <div className="min-w-0">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <span className="text-sm font-medium truncate">
                            {b.invoiceNo || b.id.slice(-6)}
                          </span>
                          {v > 0 && v >= b.due && (
                            <Badge
                              variant="outline"
                              className="text-2xs px-1.5 py-0 text-emerald-600 border-emerald-300"
                            >
                              clears
                            </Badge>
                          )}
                        </div>
                        <p className="text-xs text-muted-foreground">
                          {formatDate(b.date)}
                          <span className="sm:hidden"> · due {formatINR(b.due)}</span>
                        </p>
                      </div>
                      <p className="hidden sm:block text-sm text-right text-muted-foreground tabular-nums whitespace-nowrap">
                        {formatINR(b.due)}
                      </p>
                      <Input
                        inputMode="decimal"
                        type="number"
                        value={alloc[b.id] ?? ''}
                        onChange={(e) => {
                          setTouched(true)
                          setAlloc(m => ({ ...m, [b.id]: e.target.value }))
                        }}
                        placeholder="0"
                        aria-label={`Amount to apply to ${b.invoiceNo || 'this bill'}`}
                        className={cn(
                          'h-9 w-28 text-sm text-right tabular-nums shrink-0',
                          isOver && 'border-rose-500 text-rose-600',
                        )}
                      />
                    </div>
                  )
                })}
              </div>

              <div
                className={cn(
                  'flex items-center justify-between text-sm pt-2 border-t border-border',
                  overAllocated ? 'text-rose-600' : 'text-muted-foreground',
                )}
              >
                <span>Applied to bills</span>
                <span className="font-semibold tabular-nums">
                  {formatINR(allocatedTotal)} of {formatINR(parsedAmount)}
                </span>
              </div>

              {overBill && (
                <p className="text-sm text-rose-600">
                  {overBill} is more than that bill still owes.
                </p>
              )}
              {overAllocated && (
                <p className="text-sm text-rose-600">
                  You have applied more than the amount received.
                </p>
              )}
              {!overAllocated && !overBill && parsedAmount > allocatedTotal && (
                <p className="text-xs text-muted-foreground">
                  {formatINR(parsedAmount - allocatedTotal)} will be kept as an advance.
                </p>
              )}
            </CardContent>
          </Card>
        )}

      </div>

      <div className="sticky bottom-0 z-20 shrink-0 border-t border-border bg-background/95 backdrop-blur p-3">
        {/* On a wide screen a full-bleed pair of buttons looks like a banner,
            so the actions cap out and sit right — where the eye already is
            after filling the last column. On a phone they still fill the row. */}
        <div className="w-full flex items-center gap-2 sm:justify-end px-0 lg:px-2">
          <Button
            variant="outline"
            onClick={() => setView('party-profile')}
            className="flex-1 sm:flex-none sm:w-40"
          >
            Cancel
          </Button>
          <Button
            onClick={handleSave}
            disabled={!canSave}
            className="flex-[2] sm:flex-none sm:w-64 bg-gradient-saffron gap-2"
          >
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
            {saving ? 'Saving…' : `Record ${formatINR(parsedAmount)}`}
          </Button>
        </div>
      </div>
      {confirmDialogEl}
    </div>
  )
}
