'use client'

/**
 * Phase 8f — "Discount after sale", from the sale itself.
 *
 * The job: a customer comes back and the shopkeeper takes ₹50 (or 5%) off a
 * bill already made. One sheet: the amount, what it does to the GST, and one
 * button. It writes an ordinary credit note (reason "post-sale-discount", no
 * stock movement) against this sale, so every report, the khata and GSTR-1
 * already know what to do with it.
 *
 * Law and arithmetic live in lib/post-sale-discount.ts (Finance Act 2026
 * s.153–154, from 1 Nov 2026; s.34(2) date). The GST preview runs the SAME
 * line calculation the server runs (computeLineItems), so the figures here
 * are the figures that get saved — not a second opinion.
 */
import { useMemo, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { toast as sonnerToast } from 'sonner'
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from '@/components/ui/sheet'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Notice } from '@/components/ui/notice'
import { InfoHint } from '@/components/common/InfoHint'
import { offlineFetch } from '@/lib/offline-fetch'
import { invalidateMoneyCaches } from '@/lib/invalidate-money-caches'
import { istDateString } from '@/lib/timezone'
import { computeLineItems } from '@/lib/line-items'
import { roundMoney } from '@/lib/money'
import { formatINR, cn } from '@/lib/utils'
import { discountLines, discountDeadline, POST_SALE_DISCOUNT_REASON } from '@/lib/post-sale-discount'

export interface DiscountSale {
  id: string
  invoiceNo: string | null
  date: string | Date
  partyId: string | null
  party?: { name?: string | null; gstin?: string | null } | null
  totalAmount: number
  isInterState?: boolean | null
  items: Array<{ gstRate: number; total: number; hsn?: string | null; unit?: string | null }>
  reversalTransactions?: Array<{ type: string; totalAmount: number }>
}

type Mode = 'rupees' | 'percent'
type GivenAs = 'khata' | 'cash'

const fmtDate = (d: Date) => d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })

export function DiscountAfterSaleSheet({ sale, chargesGst, due, onClose }: {
  sale: DiscountSale
  /** Does the shop put GST on its sales? Not registered → no GST lines, no date limit. */
  chargesGst: boolean
  /** What is still owed on the bill (computeInvoiceDue). A paid bill defaults to cash back. */
  due: number
  onClose: () => void
}) {
  const queryClient = useQueryClient()
  const [mode, setMode] = useState<Mode>('rupees')
  const [entry, setEntry] = useState('')
  const hasKhata = !!sale.partyId
  const [givenAs, setGivenAs] = useState<GivenAs>(hasKhata && due > 0 ? 'khata' : 'cash')
  const [saving, setSaving] = useState(false)

  // What is left to take off: the bill, less the credit notes already against it.
  const credited = roundMoney((sale.reversalTransactions || []).filter((r) => r.type === 'credit-note').reduce((s, r) => s + (r.totalAmount || 0), 0))
  const left = roundMoney(Math.max(0, sale.totalAmount - credited))

  const typed = Number(entry.replace(/[₹,\s%]/g, ''))
  const amount = !entry || !Number.isFinite(typed) || typed <= 0
    ? 0
    : mode === 'rupees' ? roundMoney(typed) : roundMoney((sale.totalAmount * typed) / 100)
  const tooBig = amount > left + 0.001

  const lines = useMemo(() => discountLines(sale.invoiceNo, sale.items, amount), [sale.invoiceNo, sale.items, amount])
  const preview = useMemo(() => {
    if (!lines.length) return null
    return computeLineItems({ items: lines as never, productMap: new Map(), isInterState: !!sale.isInterState, orderDiscount: 0, type: 'credit-note', chargesGst: !!chargesGst })
  }, [lines, sale.isInterState, chargesGst])

  const deadline = chargesGst ? discountDeadline(sale.date) : null
  const closed = !!deadline && !deadline.open
  const gst = preview ? roundMoney(preview.cgst + preview.sgst + preview.igst) : 0
  const buyerRegistered = chargesGst && !!sale.party?.gstin
  // #351: after the date the discount can still be given — on the khata, outside GST.
  const canSave = amount > 0 && !tooBig && !saving && lines.length > 0

  async function save() {
    if (!canSave) return
    setSaving(true)
    try {
      const r = await offlineFetch('/api/transactions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'credit-note',
          partyId: sale.partyId,
          date: istDateString(new Date()),
          originalTransactionId: sale.id,
          noteType: 'C',
          noteReason: POST_SALE_DISCOUNT_REASON,
          affectsStock: false,
          // #351: past the s.34(2) date the note carries no GST and stays out of the returns.
          outsideGst: closed,
          paymentMode: 'cash',
          paidAmount: givenAs === 'cash' ? amount : 0,
          items: lines,
        }),
        offline: { queueable: false, invalidate: ['/api/transactions', '/api/dashboard', '/api/parties'] },
      })
      const j = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(j.message || j.error || 'Could not save the discount')
      invalidateMoneyCaches(queryClient)
      sonnerToast.success(`${formatINR(amount)} discount given${closed ? ' (no GST)' : ''}`, {
        description: `Credit note ${j.transaction?.invoiceNo || j.invoiceNo || ''} on ${sale.invoiceNo || 'this bill'}`.trim(),
      })
      onClose()
    } catch (e: any) {
      sonnerToast.error('Discount not saved', { description: e.message })
    } finally {
      setSaving(false)
    }
  }

  return (
    <Sheet open onOpenChange={(o) => { if (!o) onClose() }}>
      <SheetContent
        side="bottom"
        className="rounded-t-3xl max-h-[88vh] overflow-y-auto gap-0 pb-[calc(1rem+var(--safe-bottom))] lg:mx-auto lg:max-w-lg"
        data-testid="discount-after-sale"
      >
        <SheetHeader className="pb-1">
          <SheetTitle className="text-lg">Discount on {sale.invoiceNo || 'this bill'}</SheetTitle>
          <SheetDescription className="text-xs">
            Bill {formatINR(sale.totalAmount)}{credited > 0 ? ` · ${formatINR(left)} left after earlier notes` : ''}
          </SheetDescription>
        </SheetHeader>

        <div className="px-4 space-y-4">
          {closed && (
            <Notice
              level="act"
              title="Too late to lower the GST on this bill"
              info={`Section 34(2) of the CGST Act: a credit note for a ${fmtDate(new Date(sale.date))} sale had to be declared by ${fmtDate(deadline!.effectiveDeadline)}. After that the GST on it can no longer be reduced. The discount can still be given: it lowers the customer's khata and your sales, carries no GST, and stays out of GSTR-1 and GSTR-3B.`}
            >
              Last date was {fmtDate(deadline!.effectiveDeadline)}. Give it on the khata, without GST.
            </Notice>
          )}
          {(
            <>
              {/* Amount, in rupees or a percentage of the bill. */}
              <div className="flex items-stretch gap-2">
                <div className="relative min-w-0 flex-1">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-lg font-semibold text-muted-foreground" aria-hidden>
                    {mode === 'rupees' ? '₹' : '%'}
                  </span>
                  <Input
                    autoFocus
                    inputMode="decimal"
                    aria-label={mode === 'rupees' ? 'Discount in rupees' : 'Discount as a percentage of the bill'}
                    value={entry}
                    onChange={(e) => setEntry(e.target.value)}
                    placeholder="0"
                    className="pl-9 text-2xl font-bold tabular-nums h-14"
                  />
                </div>
                <div role="group" aria-label="Discount in" className="flex rounded-xl border border-input p-1 gap-1 flex-shrink-0">
                  {(['rupees', 'percent'] as const).map((m) => (
                    <button
                      key={m}
                      type="button"
                      aria-pressed={mode === m}
                      onClick={() => { setMode(m); setEntry('') }}
                      className={cn('min-w-12 min-h-12 rounded-lg text-base font-semibold', mode === m ? 'bg-primary text-primary-foreground' : 'text-muted-foreground')}
                    >
                      {m === 'rupees' ? '₹' : '%'}
                    </button>
                  ))}
                </div>
              </div>

              {mode === 'percent' && amount > 0 && (
                <p className="text-sm text-muted-foreground -mt-2">= <span className="font-semibold text-foreground tabular-nums">{formatINR(amount)}</span></p>
              )}
              {tooBig && (
                <p className="text-sm text-bad -mt-2" role="alert">At most {formatINR(left)} can come off this bill.</p>
              )}

              {/* What it does to the GST — only for a shop that charges it. */}
              {chargesGst && !closed && preview && !tooBig && (
                <div className="rounded-2xl border border-border/60 divide-y divide-border/60" data-testid="discount-gst-split">
                  <Row label="Value before GST" value={preview.subtotal} />
                  {preview.igst > 0 ? (
                    <Row label="IGST" value={preview.igst} />
                  ) : (
                    <>
                      <Row label="CGST" value={preview.cgst} />
                      <Row label="SGST" value={preview.sgst} />
                    </>
                  )}
                  <Row label="Customer gets" value={amount} strong />
                </div>
              )}

              {buyerRegistered && !closed && gst > 0 && !tooBig && (
                <Notice
                  level="note"
                  title={`${sale.party?.name || 'The buyer'} must reverse ${formatINR(gst)} of input credit`}
                  info="Finance Act 2026 (s.153, from 1 November 2026): GST on a discount given after the sale comes off only when the buyer reverses the input credit on it. The credit note goes in your GSTR-1; the buyer sees it in their IMS and GSTR-2B and reverses it there."
                />
              )}

              {/* How the customer gets it. A walk-in sale has no khata, so cash it is. */}
              {hasKhata && amount > 0 && !tooBig && (
                <div role="radiogroup" aria-label="How the customer gets it" className="grid grid-cols-2 gap-2">
                  {(['khata', 'cash'] as const).map((g) => (
                    <button
                      key={g}
                      type="button"
                      role="radio"
                      aria-checked={givenAs === g}
                      onClick={() => setGivenAs(g)}
                      className={cn('min-h-12 rounded-xl border px-3 text-sm font-medium', givenAs === g ? 'border-primary bg-primary/10 text-primary' : 'border-input text-muted-foreground')}
                    >
                      {g === 'khata' ? 'Less to pay (khata)' : 'Cash back'}
                    </button>
                  ))}
                </div>
              )}

              {deadline && !closed && (
                <p className="text-xs text-muted-foreground flex items-center gap-1">
                  Last date for this note: {fmtDate(deadline.effectiveDeadline)}
                  <InfoHint
                    label="Last date for a credit note"
                    text="Section 34(2) of the CGST Act: a credit note must be declared by 30 November after the end of the financial year of the sale, or the annual return if that is filed earlier."
                  />
                </p>
              )}

              <Button size="touch" className="w-full text-base" disabled={!canSave} onClick={save}>
                {saving ? 'Saving…' : amount > 0 ? `Give ${formatINR(amount)} discount${closed ? ' (no GST)' : ''}` : 'Give discount'}
              </Button>
            </>
          )}
        </div>
      </SheetContent>
    </Sheet>
  )
}

function Row({ label, value, strong }: { label: string; value: number; strong?: boolean }) {
  return (
    <div className={cn('flex items-center justify-between px-4 py-2.5 text-sm', strong && 'font-semibold')}>
      <span className={strong ? '' : 'text-muted-foreground'}>{label}</span>
      <span className="tabular-nums">{formatINR(value)}</span>
    </div>
  )
}
