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

import { useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { ChevronRight, Palette, Send, Coins, FileText, Hash } from 'lucide-react'
import { offlineFetch } from '@/lib/offline-fetch'
import { haptic } from '@/lib/haptic'
import { cn } from '@/lib/utils'
import { buildInvoiceDocument, type InvoiceSource, type InvoiceShop } from '@/lib/invoice-document'
import { InvoicePreview, type PreviewFocus } from './InvoicePreview'
import { InfoHint } from '@/components/common/InfoHint'

/** The three pages, and which part of the bill each one changes. */
/**
 * The three pages, what part of the bill each changes, and its colour.
 *
 * 🎨 2026-08-15, two corrections from Rahul.
 *
 * 1. "info button should only be there where it's hard to understand about the
 *    topic like you add with design and sending. everyone knows what its
 *    means." Correct — Design and Sending explain themselves, and a ⓘ beside
 *    an obvious word is noise that teaches the eye to ignore the ⓘ that
 *    matters. Only 'Rounding & tax' keeps one, because e-invoicing is a legal
 *    threshold nobody can infer from two words.
 *
 * 2. "if you are adding then add colourful icon so it looks good." The rows
 *    had grey glyphs on grey tiles while the Account menu one level up uses
 *    coloured ones — so this screen looked unfinished beside its own parent.
 */
export const INVOICE_SECTIONS = [
  {
    id: 'invoice-design',
    label: 'Design',
    summary: 'Layout and colour',
    icon: Palette,
    tint: 'text-violet-600 dark:text-violet-400',
    tintBg: 'bg-violet-100 dark:bg-violet-950',
    focus: 'header' as PreviewFocus,
  },
  {
    id: 'invoice-sending',
    label: 'Sending',
    summary: 'Picture or PDF, payment link',
    icon: Send,
    tint: 'text-emerald-600 dark:text-emerald-400',
    tintBg: 'bg-emerald-100 dark:bg-emerald-950',
    focus: 'footer' as PreviewFocus,
  },
  {
    id: 'invoice-content',
    label: 'On the bill',
    summary: 'Terms, signature, bank details, thank-you',
    icon: FileText,
    tint: 'text-blue-600 dark:text-blue-400',
    tintBg: 'bg-blue-100 dark:bg-blue-950',
    focus: 'footer' as PreviewFocus,
  },
  {
    id: 'invoice-numbering',
    label: 'Numbering',
    summary: 'Prefix and next bill number',
    // Rule 46(b) makes this a legal matter rather than a preference, and a
    // shopkeeper coming off a paper book will not guess that from the word.
    hint: 'GST law needs every bill to carry a number that never repeats in a financial year. A prefix like RG/26-27/ keeps that true across years and branches. If you are moving from a paper book, set the next number to carry on from it.',
    icon: Hash,
    tint: 'text-rose-600 dark:text-rose-400',
    tintBg: 'bg-rose-100 dark:bg-rose-950',
    focus: 'header' as PreviewFocus,
  },
  {
    id: 'invoice-tax',
    label: 'Rounding & tax',
    summary: 'Round off, e-invoicing',
    // The one that is genuinely not guessable from its name.
    hint: 'Round off drops the paise so the total is a whole rupee. e-Invoicing is a legal requirement once your turnover has crossed ₹5 crore in any year since 2017-18 — most shops do not need it.',
    icon: Coins,
    tint: 'text-amber-600 dark:text-amber-400',
    tintBg: 'bg-amber-100 dark:bg-amber-950',
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

/**
 * Is this bill worth previewing, or should the demo stand in?
 *
 * 📄 Extracted so it can be CALLED rather than only exercised by rendering.
 * CLAUDE.md's Cause 7 rule, earned 15 Aug: a rule buried inside a component
 * can only be tested by committing a real bug.
 *
 * A bill needs lines that carry money. Checking the transaction total alone is
 * exactly what let a real invoice render with a ₹0.00 line beside a ₹70,800
 * total — on a settings screen that reads as the shop's books being broken.
 */
export function isPreviewable(tx: unknown): boolean {
  const t = tx as { items?: unknown; totalAmount?: unknown } | null | undefined
  if (!t || !Array.isArray(t.items) || t.items.length === 0) return false
  if (typeof t.totalAmount !== 'number' || t.totalAmount <= 0) return false
  return (t.items as Array<{ total?: unknown; unitPrice?: unknown }>).some(
    it => (typeof it.total === 'number' && it.total > 0) ||
          (typeof it.unitPrice === 'number' && it.unitPrice > 0))
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
   * The shop's most recent bill, IN FULL.
   *
   * 🐛 2026-08-15, found in the browser on the deployed build and not before.
   * The first version read the list route alone, and that route deliberately
   * selects only `productName` and `quantity` per item — a performance fix, so
   * the ledger does not load fifteen columns for a thousand rows. Every line
   * therefore arrived with no rate and no amount, and the preview drew a real
   * invoice whose only item read ₹0.00 beside a ₹70,800 total. On a settings
   * screen that is worse than a sample: it looks like the shop's own books are
   * broken.
   *
   * I had even written the comment about a ₹0 preview looking like a bug, and
   * then checked only that the TRANSACTION had a total — never that its LINES
   * did. So: two requests. The list gives the newest sale's id; the detail
   * route gives its full items. Both cached, so moving between the four pages
   * refetches nothing.
   */
  const { data: latestId } = useQuery({
    queryKey: ['invoice-preview-latest-id'],
    queryFn: async () => {
      const r = await offlineFetch('/api/transactions?type=sale&limit=1')
      const j = await r.json()
      const first = (j?.transactions ?? j?.data ?? [])[0]
      return (first?.id as string) ?? null
    },
    staleTime: 5 * 60 * 1000,
  })

  const { data, isLoading } = useQuery({
    queryKey: ['invoice-preview-full', latestId],
    enabled: !!latestId,
    queryFn: async () => {
      const r = await offlineFetch(`/api/transactions/${latestId}`)
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
      // 📄 Phase 3, so the preview shows what the printed bill will carry.
      terms: setting?.invoiceTerms as string,
      thankYou: setting?.invoiceThankYou as string,
      signatureUrl: setting?.signatureUrl as string,
      showSignatureBox: setting?.showSignatureBox as boolean,
      showReceiverSignature: setting?.showReceiverSignature as boolean,
      bank: {
        name: setting?.bankName as string,
        accountName: setting?.bankAccountName as string,
        accountNumber: setting?.bankAccountNumber as string,
        ifsc: setting?.bankIfsc as string,
        branch: setting?.bankBranch as string,
      },
    }
    const latest = data?.transaction ?? data
    /*
     * Rahul: "if the user didn't created any bill then there should be a bill
     * too by default so user can check everything for demo". That is what
     * SAMPLE is — and it also covers a bill too incomplete to draw honestly.
     */
    const usable = isPreviewable(latest)
    const dueDays = (setting?.invoiceDueDays as number) ?? null
    if (!usable) return { doc: buildInvoiceDocument({ ...SAMPLE, dueDays }, shop), isSample: true }
    return { doc: buildInvoiceDocument({ ...(latest as InvoiceSource), dueDays }, shop), isSample: false }
  }, [data, setting])

  /*
   * Fill the card rather than sitting at a fixed 320px inside it. Measured,
   * because this screen is also used on a desktop sidebar where the column is
   * far wider and a phone-sized preview would look lost.
   */
  const cardRef = useRef<HTMLDivElement>(null)
  const [previewWidth, setPreviewWidth] = useState(340)
  useLayoutEffect(() => {
    const el = cardRef.current
    if (!el) return
    const measure = () => setPreviewWidth(Math.max(240, Math.min(520, el.clientWidth - 16)))
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const isHub = section === 'invoices'
  const current = INVOICE_SECTIONS.find(s => s.id === section)

  return (
    <div className="space-y-4">
      {/* The bill, above whatever is being changed.

          🎨 2026-08-15. Rahul: "there is unnecessary padding everywhere … in
          most of the part we can show the invoice." The card had 12px of its
          own padding around a preview that already cropped itself, on a screen
          where the page beneath adds 16px more. Down to 8px, and the preview
          is given the width that leaves. */}
      <div ref={cardRef} className="bg-card rounded-2xl border border-border/60 shadow-card p-2">
        {isLoading ? (
          <div className="mx-auto bg-muted animate-pulse rounded" style={{ maxWidth: 360, height: 240 }} />
        ) : (
          <InvoicePreview
            doc={doc}
            themeId={setting?.invoiceTheme as string}
            templateId={setting?.invoiceTemplate as string}
            paperId={setting?.invoicePaperSize as string}
            focus={current?.focus ?? null}
            isSample={isSample}
            width={previewWidth}
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
                <div className={cn(
                  'w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0',
                  s.tintBg,
                )}>
                  <Icon className={cn('w-5 h-5', s.tint)} />
                </div>
                <div className="flex-1 min-w-0">
                  <span className="font-medium text-sm inline-flex items-center gap-1.5">
                    {s.label}
                    {'hint' in s && s.hint && <InfoHint text={s.hint} label={s.label} />}
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
