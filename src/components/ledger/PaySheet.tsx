'use client'

/**
 * Phase 6d — the Counter's Pay sheet and the "Saved" sheet that follows it
 * (final design plan §1 and §5; build plan 6d).
 *
 * Pay: one sheet, three ways — Cash (with the change worked out, and the notes
 * a customer is likely to hand over as buttons, #230), UPI (the shop's QR for
 * the exact amount when a UPI ID is saved), Udhaar (needs a customer — the
 * server's own rule, lib/paid-amount.ts owedByNobody). The button names the
 * amount: "Save ₹282".
 *
 * Saved: what a shopkeeper does next is almost always "give the bill" (#145):
 * Share on WhatsApp, Print, or start the next bill. The Counter stays open.
 */
import { useEffect, useMemo, useState } from 'react'
import { QRCodeSVG } from 'qrcode.react'
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from '@/components/ui/sheet'
import { Button } from '@/components/ui/button'
import { NumberField } from '@/components/ui/number-field'
import { formatINR, cn } from '@/lib/utils'
import { quickCashNotes, changeFor } from '@/lib/quick-cash'
import { CheckCircle2, Printer, Share2, Plus, CloudOff } from 'lucide-react'

export type PayMode = 'cash' | 'upi' | 'card' | 'credit'

const MODES: { id: PayMode; label: string }[] = [
  { id: 'cash', label: 'Cash' },
  { id: 'upi', label: 'UPI' },
  { id: 'card', label: 'Card' },
  { id: 'credit', label: 'Udhaar' },
]

/**
 * What a Pay choice sends to the save: the payment mode and the paid amount
 * as the form holds it ('' = paid in full; the server reads an empty amount on
 * an udhaar sale as ₹0 paid). Cash given below the bill pays that much and
 * leaves the rest on the customer's khata; given above it pays the bill and
 * the difference is change.
 */
export function payChoice(mode: PayMode, total: number, given: number | null): { paymentMode: PayMode; paidAmount: string } {
  if (mode === 'credit') return { paymentMode: 'credit', paidAmount: '0' }
  if (mode === 'cash' && given !== null && given > 0 && changeFor(total, given) < 0) {
    return { paymentMode: 'cash', paidAmount: String(given) }
  }
  return { paymentMode: mode, paidAmount: '' }
}

export function PaySheet({ open, onOpenChange, total, customerName, upiLink, saving, onSave, onPickCustomer }: {
  open: boolean
  onOpenChange: (open: boolean) => void
  total: number
  /** The bill's customer, or null for a cash (walk-in) sale. */
  customerName: string | null
  /** upi://pay link for the exact amount, or null when the shop has no UPI ID. */
  upiLink: string | null
  saving: boolean
  onSave: (choice: { paymentMode: PayMode; paidAmount: string; given: number | null }) => void
  /** Udhaar needs a customer: close the sheet and put the cursor in the customer search. */
  onPickCustomer: () => void
}) {
  const [mode, setMode] = useState<PayMode>('cash')
  const [given, setGiven] = useState('')
  useEffect(() => { if (open) { setMode('cash'); setGiven('') } }, [open])

  const notes = useMemo(() => quickCashNotes(total), [total])
  const givenNum = given === '' ? null : Number(given) || 0
  const change = givenNum === null ? null : changeFor(total, givenNum)
  const shortWithoutCustomer = mode === 'cash' && change !== null && change < 0 && !customerName
  const blocked = (mode === 'credit' && !customerName) || shortWithoutCustomer || saving || total <= 0
  const choice = payChoice(mode, total, givenNum)
  const saveLabel = mode === 'credit'
    ? `Save ${formatINR(total)} on udhaar`
    : choice.paidAmount !== ''
      ? `Save · ${formatINR(Number(choice.paidAmount))} paid`
      : `Save ${formatINR(total)}`

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="bottom" className="rounded-t-3xl max-h-[92vh] overflow-y-auto gap-0 pb-[calc(1rem+var(--safe-bottom))] lg:mx-auto lg:max-w-md">
        <SheetHeader className="pb-1">
          <SheetTitle className="text-base">Pay{customerName ? ` · ${customerName}` : ''}</SheetTitle>
          <SheetDescription className="sr-only">How the customer pays</SheetDescription>
        </SheetHeader>
        <div className="px-4 space-y-4">
          <p className="text-3xl font-bold tabular-nums">{formatINR(total)}</p>

          <div className="grid grid-cols-4 gap-2" role="radiogroup" aria-label="How the customer pays">
            {MODES.map((m) => (
              <button
                key={m.id}
                type="button"
                role="radio"
                aria-checked={mode === m.id}
                onClick={() => setMode(m.id)}
                className={cn(
                  'min-h-12 rounded-xl border text-sm font-semibold transition',
                  mode === m.id ? 'bg-primary text-primary-foreground border-primary' : 'border-border hover:bg-muted',
                )}
              >
                {m.label}
              </button>
            ))}
          </div>

          {mode === 'cash' && (
            <div className="space-y-3">
              <div className="grid grid-cols-4 gap-2">
                <button type="button" onClick={() => setGiven(String(total))} className="min-h-12 rounded-xl border border-border text-sm font-semibold tabular-nums hover:bg-muted">Exact</button>
                {notes.map((n) => (
                  <button key={n} type="button" onClick={() => setGiven(String(n))} className="min-h-12 rounded-xl border border-border text-sm font-semibold tabular-nums hover:bg-muted">
                    {formatINR(n)}
                  </button>
                ))}
              </div>
              <NumberField
                id="field-cash-given"
                aria-label="Cash given"
                value={given}
                onValueChange={setGiven}
                placeholder="Cash given (optional)"
                min={0}
                step={10}
                decimals={2}
                prefix="₹"
              />
              {change !== null && change > 0 && (
                <p className="text-lg font-bold text-good tabular-nums">Return {formatINR(change)}</p>
              )}
              {change !== null && change < 0 && (
                <p className={cn('text-sm font-semibold tabular-nums', customerName ? 'text-bad' : 'text-check')}>
                  {formatINR(-change)} short{customerName ? ` · goes on ${customerName}'s khata` : ' · pick a customer for udhaar'}
                </p>
              )}
            </div>
          )}

          {mode === 'upi' && (
            upiLink ? (
              <div className="flex flex-col items-center gap-2">
                <div className="rounded-2xl bg-white p-3">
                  <QRCodeSVG value={upiLink} size={176} aria-label={`UPI QR for ${formatINR(total)}`} />
                </div>
                <p className="text-xs text-muted-foreground">Customer scans to pay {formatINR(total)}</p>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">Add your UPI ID in Settings to show a QR.</p>
            )
          )}

          {mode === 'credit' && !customerName && (
            <div className="flex items-center justify-between gap-3">
              <p className="text-sm text-check font-semibold">Udhaar needs a customer</p>
              <Button type="button" variant="outline" onClick={onPickCustomer}>Pick customer</Button>
            </div>
          )}

          <Button
            type="button"
            className="w-full h-14 text-base font-bold"
            disabled={blocked}
            onClick={() => onSave({ ...choice, given: mode === 'cash' ? givenNum : null })}
          >
            {saving ? 'Saving…' : saveLabel}
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  )
}

export interface SavedBill {
  id: string | null
  invoiceNo: string | null
  total: number
  change: number | null
  offline: boolean
}

export function SavedSheet({ bill, onShare, onPrint, onNext, sharing }: {
  bill: SavedBill | null
  onShare: () => void
  onPrint: () => void
  onNext: () => void
  sharing: boolean
}) {
  return (
    <Sheet open={!!bill} onOpenChange={(o) => { if (!o) onNext() }}>
      <SheetContent side="bottom" className="rounded-t-3xl gap-0 pb-[calc(1rem+var(--safe-bottom))] lg:mx-auto lg:max-w-md">
        <SheetHeader className="pb-1">
          <SheetTitle className="text-base flex items-center gap-2 text-good">
            <CheckCircle2 className="w-5 h-5" aria-hidden /> Saved{bill?.invoiceNo ? ` · ${bill.invoiceNo}` : ''}
          </SheetTitle>
          <SheetDescription className="sr-only">Share, print or start the next bill</SheetDescription>
        </SheetHeader>
        {bill && (
          <div className="px-4 space-y-3">
            <p className="text-3xl font-bold tabular-nums">{formatINR(bill.total)}</p>
            {bill.change !== null && bill.change > 0 && (
              <p className="text-lg font-bold text-good tabular-nums">Return {formatINR(bill.change)}</p>
            )}
            {bill.offline ? (
              <p className="text-sm text-muted-foreground flex items-center gap-2"><CloudOff className="w-4 h-4" aria-hidden /> Saved on this phone, sends when online</p>
            ) : (
              <div className="grid grid-cols-2 gap-2">
                <Button type="button" variant="outline" className="h-12 gap-2" onClick={onShare} disabled={sharing}>
                  <Share2 className="w-4 h-4" aria-hidden /> {sharing ? 'Preparing…' : 'Share on WhatsApp'}
                </Button>
                <Button type="button" variant="outline" className="h-12 gap-2" onClick={onPrint}>
                  <Printer className="w-4 h-4" aria-hidden /> Print
                </Button>
              </div>
            )}
            <Button type="button" className="w-full h-14 text-base font-bold gap-2" onClick={onNext} autoFocus>
              <Plus className="w-5 h-5" aria-hidden /> Next bill
            </Button>
          </div>
        )}
      </SheetContent>
    </Sheet>
  )
}
