/**
 * 9a-3: the small rules behind the supplier-bills screen — kept here so they are
 * tested without a browser. The screen itself is components/reports/Gstr2bReconciliation.tsx.
 */
import { GST_RATE_SLABS } from '@/lib/gst-rates'
import { formatINR } from '@/lib/utils'

/** 2B writes dates as "10-10-2026" (dd-mm-yyyy). An ISO day ("2026-10-10"), or null if it is not one. */
export function twoBDate(s: string | null | undefined): string | null {
  const m = /^(\d{2})-(\d{2})-(\d{4})$/.exec(String(s ?? '').trim())
  if (!m) return null
  const [, d, mo, y] = m
  const day = new Date(Date.UTC(Number(y), Number(mo) - 1, Number(d)))
  if (day.getUTCDate() !== Number(d) || day.getUTCMonth() !== Number(mo) - 1) return null
  return `${y}-${mo}-${d}`
}

/**
 * The bill's GST rate, read off its tax and taxable value — only when that is
 * exactly a GST slab (to the paisa). A bill of mixed rates, or anything else,
 * gives null: the purchase form then asks, rather than EkBook guessing a rate.
 */
export function twoBRate(l: { taxableValue: number; cgst: number; sgst: number; igst: number }): number | null {
  if (!(l.taxableValue > 0)) return null
  const tax = l.cgst + l.sgst + l.igst
  for (const rate of GST_RATE_SLABS) {
    if (Math.abs(Math.round(l.taxableValue * rate) / 100 - tax) < 0.015) return rate
  }
  return null
}

export interface TwoBBill {
  supplierGstin: string
  supplierName?: string | null
  invoiceNumber: string
  invoiceDate: string | null
  taxableValue: number
  cgst: number
  sgst: number
  igst: number
}

/**
 * "Add as purchase": the new-purchase form, filled in from the 2B bill — the
 * supplier, their bill number and date, and one line at the bill's taxable value
 * and rate. The shopkeeper checks it and saves; nothing is saved from here.
 */
export function purchasePresetFrom(bill: TwoBBill, partyId: string | null) {
  const rate = twoBRate(bill)
  return {
    type: 'purchase' as const,
    data: {
      ...(partyId ? { partyId } : { partyName: bill.supplierName || bill.supplierGstin }),
      invoiceNo: bill.invoiceNumber,
      ...(twoBDate(bill.invoiceDate) ? { date: twoBDate(bill.invoiceDate) } : {}),
      items: [{
        name: `Goods as per bill ${bill.invoiceNumber}`,
        quantity: 1,
        unitPrice: bill.taxableValue,
        gstRate: rate ?? 0,
        unit: 'pcs',
        // The 2B's taxable value is before GST.
        priceIncludesGst: false,
      }],
    },
  }
}

/**
 * 9a-4 — "Record it": a supplier's credit note goes in the books as a return to the
 * supplier (the app's debit-note entry, which reduces credit in GSTR-3B the way the
 * portal's Table 4A does once the note is accepted — GSTN IMS FAQ Q15). Filled in
 * from 2B; the shop picks the reason (goods back, or a discount) and saves.
 */
export function returnPresetFrom(note: TwoBBill, partyId: string | null) {
  const rate = twoBRate(note)
  return {
    type: 'debit-note' as const,
    data: {
      ...(partyId ? { partyId } : { partyName: note.supplierName || note.supplierGstin }),
      ...(twoBDate(note.invoiceDate) ? { date: twoBDate(note.invoiceDate) } : {}),
      notes: `Supplier's credit note ${note.invoiceNumber}`,
      items: [{
        name: `As per supplier's credit note ${note.invoiceNumber}`,
        quantity: 1,
        unitPrice: note.taxableValue,
        gstRate: rate ?? 0,
        unit: 'pcs',
        priceIncludesGst: false,
      }],
    },
  }
}

/** The message for a supplier whose filed amount differs from the shop's bill. */
export function askSupplierText(no: string, filed: number, mine: number): string {
  return `Namaste. In your GSTR-1, bill ${no} shows ${formatINR(filed)}, but our bill says ${formatINR(mine)}. Please correct it in your GSTR-1 so the GST credit matches. Thank you.`
}

/** The message for a supplier who has not filed a bill yet. */
export function remindSupplierText(no: string | null, day: string, amount: number): string {
  return `Namaste. Our bill ${no ?? ''} dated ${day} for ${formatINR(amount)} is not in our GSTR-2B yet. Please file it in your GSTR-1 so we can take the GST credit. Thank you.`
}
