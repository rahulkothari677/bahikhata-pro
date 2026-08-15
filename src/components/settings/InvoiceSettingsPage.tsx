'use client'

/**
 * Invoices & Bills: a hub of small pages, each with the bill above it.
 *
 * 📄 2026-08-15. Rahul: "adding everything … in the same section can be
 * frustrating for the user because if the user just want to change one thing
 * then he has to scroll everything, while in bill book everything is
 * categori[s]ed properly with live preview."
 *
 * ── THE SHAPE ─────────────────────────────────────────────────────────
 *
 * The hub lists three categories. Each opens its own page, and every page —
 * hub included — carries the live preview at the top, which is the myBillBook
 * pattern and the reason their settings are navigable at thirteen screens where
 * ours was one scroll at three.
 *
 * It was about to get much worse. Phase 3 of docs/INVOICE-ENGINE-PLAN.md adds
 * terms, signature, bank details, numbering and a thank-you line. On one page
 * that is six screens of scrolling to change a round-off toggle.
 *
 * ── WHERE IT IS BETTER THAN myBillBook ────────────────────────────────
 *
 * 1. The preview is the shop's OWN most recent bill, not a stock sample. See
 *    InvoicePreview for why that matters.
 * 2. The preview points at the part you are editing, so "which of these am I
 *    changing?" needs no explaining.
 * 3. Three categories, not thirteen loose rows. myBillBook's Invoice Settings
 *    screen is a flat list where Theme sits beside Signature beside Discount
 *    Type, and nothing says which of them changes the look.
 */

import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { ChevronRight, Palette, Send, Coins } from 'lucide-react'
import { offlineFetch } from '@/lib/offline-fetch'
import { haptic } from '@/lib/haptic'
import { cn } from '@/lib/utils'
import { buildInvoiceDocument, type InvoiceSource, type InvoiceShop } from '@/lib/invoice-document'
import { InvoicePreview, type PreviewFocus } from './InvoicePreview'
import { InfoHint } from '@/components/common/InfoHint'

/** The three pages, and which part of the bill each one changes. */
export const INVOICE_SECTIONS = [
  {
    id: 'invoice-design',
    label: 'Design',
    hint: 'The shape and colour of the bill. Every design carries the same GST fields, so none of them can make your invoice invalid.',
    summary: 'Layout and colour',
    icon: Palette,
    focus: 'header' as PreviewFocus,
  },
  {
    id: 'invoice-sending',
    label: 'Sending',
    hint: 'Whether a bill goes to your customer as a picture or a PDF, and whether a payment link goes with it.',
    summary: 'Picture or PDF, payment link',
    icon: Send,
    focus: 'footer' as PreviewFocus,
  },
  {
    id: 'invoice-tax',
    label: 'Rounding & tax',
    hint: 'Round off changes the total your customer pays. e-Invoicing is a legal requirement above ₹5 crore turnover. Both affect what you file.',
    summary: 'Round off, e-invoicing',
    icon: Coins,
    focus: 'totals' as PreviewFocus,
  },
] as const

/** A believable bill for a shop that has not made one yet. Labelled as sample. */
const SAMPLE: InvoiceSource = {
  invoiceNo: 'INV-0001',
  date: new Date().toISOString(),
  party: { name: 'Sharma Traders', gstin: null, state: null },
  items: [
    { productName: 'Atta 10 kg', quantity: 2, unitPrice: 450, gstRate: 5, total: 945, unit: 'bag', hsn: '1101' },
    { productName: 'Sugar 1 kg', quantity: 5, unitPrice: 45, gstRate: 5, total: 236.25, unit: 'pkt', hsn: '1701' },
    { productName: 'Sunflower Oil 1 L', quantity: 3, unitPrice: 180, gstRate: 5, total: 567, unit: 'btl', hsn: '1512' },
  ],
  subtotal: 1665,
  discountAmount: 0,
  cgst: 41.63,
  sgst: 41.63,
  igst: 0,
  totalAmount: 1748.25,
  paidAmount: 0,
  paymentMode: 'cash',
}

export function InvoiceSettingsPage({
  section,
  setting,
  onOpen,
  children,
}: {
  /** 'invoices' for the hub, or one of the three page ids. */
  section: string
  setting: Record<string, unknown> | undefined
  onOpen: (sectionId: string) => void
  /** The settings cards for a sub-page. Absent on the hub. */
  children?: React.ReactNode
}) {
  /*
   * The shop's most recent bill.
   *
   * `take: 1` and nothing else — this is a preview, not a report, so there is
   * no question of a silent cap hiding rows from an answer. Cached by
   * react-query, so moving between the four pages does not refetch.
   */
  const { data, isLoading } = useQuery({
    queryKey: ['invoice-preview-latest'],
    queryFn: async () => {
      const r = await offlineFetch('/api/transactions?type=sale&limit=1')
      return r.json()
    },
    staleTime: 5 * 60 * 1000,
  })

  const { doc, isSample } = useMemo(() => {
    const shop: InvoiceShop = {
      name: (setting?.shopName as string) || 'My Shop',
      phone: setting?.phone as string,
      email: setting?.email as string,
      gstin: setting?.gstin as string,
      address: setting?.address as string,
      state: setting?.state as string,
      upiId: setting?.upiId as string,
      logoUrl: setting?.logoUrl as string,
    }
    const latest = (data?.transactions ?? data?.data ?? [])[0]
    /*
     * A real bill needs its line items to be worth previewing. The list route
     * returns items with only name and quantity, so a row without a usable
     * `total` falls back to the sample rather than drawing a bill of zeroes —
     * a preview showing ₹0 would look like a bug in the shop's own books.
     */
    const usable =
      latest &&
      Array.isArray(latest.items) &&
      latest.items.length > 0 &&
      typeof latest.totalAmount === 'number' &&
      latest.totalAmount > 0

    if (!usable) return { doc: buildInvoiceDocument(SAMPLE, shop), isSample: true }
    return { doc: buildInvoiceDocument(latest as InvoiceSource, shop), isSample: false }
  }, [data, setting])

  const isHub = section === 'invoices'
  const current = INVOICE_SECTIONS.find(s => s.id === section)

  return (
    <div className="space-y-4">
      {/* The bill, above whatever is being changed. */}
      <div className="bg-card rounded-2xl border border-border/60 shadow-card p-3">
        {isLoading ? (
          <div className="mx-auto bg-muted animate-pulse rounded" style={{ maxWidth: 340, aspectRatio: '210 / 297' }} />
        ) : (
          <InvoicePreview
            doc={doc}
            themeId={setting?.invoiceTheme as string}
            templateId={setting?.invoiceTemplate as string}
            focus={current?.focus ?? null}
            isSample={isSample}
          />
        )}
      </div>

      {isHub ? (
        <div className="bg-card rounded-2xl shadow-card border border-border/60 overflow-hidden">
          {INVOICE_SECTIONS.map((s, i) => {
            const Icon = s.icon
            return (
              <button
                key={s.id}
                onClick={() => { haptic.click(); onOpen(s.id) }}
                className={cn(
                  'w-full flex items-center gap-3 p-3.5 hover:bg-muted/50 transition text-left active:bg-muted group',
                  i > 0 && 'border-t border-border/40',
                )}
              >
                <div className="w-10 h-10 rounded-xl bg-muted flex items-center justify-center flex-shrink-0">
                  <Icon className="w-5 h-5 text-muted-foreground" />
                </div>
                <div className="flex-1 min-w-0">
                  <span className="font-medium text-sm inline-flex items-center gap-1.5">
                    {s.label}
                    <InfoHint text={s.hint} label={s.label} />
                  </span>
                  <p className="text-xs text-muted-foreground truncate">{s.summary}</p>
                </div>
                <ChevronRight className="w-4 h-4 text-muted-foreground group-hover:text-primary group-hover:translate-x-0.5 transition flex-shrink-0" />
              </button>
            )
          })}
        </div>
      ) : (
        children
      )}
    </div>
  )
}
