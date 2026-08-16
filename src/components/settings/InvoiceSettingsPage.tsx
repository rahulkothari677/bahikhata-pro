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
import { ChevronRight, Palette, Send, Coins, FileText, Hash, Eye, QrCode, ListPlus } from 'lucide-react'
import { offlineFetch } from '@/lib/offline-fetch'
import { haptic } from '@/lib/haptic'
import { cn } from '@/lib/utils'
import { buildInvoiceDocument, invoiceShopFromSetting, type InvoiceSource, type InvoiceShop } from '@/lib/invoice-document'
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
    // 🗑️ was "Picture or PDF, payment link" — there is no link any more.
    summary: 'Picture or PDF',
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
    /*
     * 🗑️➕ 2026-08-15. This section replaces the shareable link, and it is
     * where "how does my customer pay me" now lives — one place, rather than
     * a UPI id buried in Shop Profile and a link switch under Sending.
     */
    id: 'invoice-payment',
    label: 'Payment',
    summary: 'UPI ID or your own QR code',
    icon: QrCode,
    tint: 'text-teal-600 dark:text-teal-400',
    tintBg: 'bg-teal-100 dark:bg-teal-950',
    focus: 'footer' as PreviewFocus,
  },
  {
    /*
     * 📄 Phase 5. Sits BEFORE "Extra details" deliberately: this section
     * invents fields, that one switches existing ones on. A shopkeeper who
     * opens the wrong one finds nothing they were looking for, and the two
     * names are close enough that order is doing real work here.
     */
    id: 'invoice-extra-fields',
    label: 'Your own fields',
    summary: 'Batch no., expiry, PO number',
    // Genuinely not guessable from three words, and the distinction between
    // a bill field and a line column is the one people get wrong.
    hint: 'Add fields the app does not have — a batch number and expiry on every medicine, a PO number on the bill, an FSSAI licence on a customer. You choose whether each one prints on the bill or stays in your records.',
    icon: ListPlus,
    tint: 'text-fuchsia-600 dark:text-fuchsia-400',
    tintBg: 'bg-fuchsia-100 dark:bg-fuchsia-950',
    focus: 'items' as PreviewFocus,
  },
  {
    /*
     * 📄 Phase 4. Its own category rather than more rows under "On the bill":
     * that section is things the shop TYPES, this is things it switches on.
     * Mixing a text area with a column of toggles is what made the old App
     * Settings screen 4.3 screens long.
     *
     * No `hint` — every row carries its own where it needs one, and a
     * paragraph explaining "extra details" would be the kind of description
     * Rahul asked to stop adding where the label already says it.
     */
    id: 'invoice-visibility',
    label: 'Extra details',
    summary: 'Outstanding balance, description, time',
    icon: Eye,
    tint: 'text-cyan-600 dark:text-cyan-400',
    tintBg: 'bg-cyan-100 dark:bg-cyan-950',
    focus: 'items' as PreviewFocus,
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
  /*
   * 📄 Phase 4: the sample carries a description, an alternate unit and an
   * outstanding balance SO THE TOGGLES HAVE SOMETHING TO SHOW.
   *
   * Without this, a shop with no bills yet would flip "Item description",
   * watch the preview not move, and reasonably conclude the switch is broken —
   * which is the same complaint that started this phase, arriving by a
   * different route. The one line WITHOUT a description is deliberate too: it
   * shows that only items carrying notes gain a second line.
   */
  items: [
    { productName: 'Atta 10 kg', quantity: 2, unitPrice: 450, gstRate: 5, total: 945, unit: 'bag', hsn: '1101',
      description: 'Chakki fresh, 10 kg bag' },
    { productName: 'Sugar 1 kg', quantity: 5, unitPrice: 45, gstRate: 5, total: 236.25, unit: 'pkt', hsn: '1701' },
    { productName: 'Sunflower Oil 1 L', quantity: 3, unitPrice: 180, gstRate: 5, total: 567, unit: 'btl', hsn: '1512',
      description: 'Refined, pouch', enteredQuantity: 3000, enteredUnit: 'ml',
      customCols: [
        { key: 'batch', label: 'Batch', type: 'text', value: 'A-118', show: true },
        { key: 'expiry', label: 'Expiry', type: 'date', value: '2027-03-12', show: true },
      ] },
  ],
  /*
   * 📄 Phase 5: the sample carries custom fields too, so a shop that has
   * just defined 'Batch' can see where it lands before making a single bill.
   */
  customFields: [
    { key: 'po_number', label: 'PO Number', type: 'text', value: 'PO-4471', show: true },
  ],
  partyBalance: 12400,
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
  /*
   * 🐛 2026-08-15: both queries now THROW on a bad response.
   *
   * They used to call r.json() regardless, so a 403 or a 500 came back as
   * "no bills" — and the caption below cheerfully told a shop with 33 sales
   * this month to "make your first sale". Rahul watched that happen while
   * Vercel's DDoS rule was challenging his own requests.
   *
   * That is a silent failure wearing a friendly message, which is the exact
   * class this codebase spent a phase removing. Distinguishing the two costs
   * one `if` per query and turns a lie into a fact.
   */
  const { data: latestId, isError: idFailed } = useQuery({
    queryKey: ['invoice-preview-latest-id'],
    queryFn: async () => {
      const r = await offlineFetch('/api/transactions?type=sale&limit=1')
      if (!r.ok) throw new Error(`Could not load your bills (${r.status})`)
      const j = await r.json()
      const first = (j?.transactions ?? j?.data ?? [])[0]
      return (first?.id as string) ?? null
    },
    staleTime: 5 * 60 * 1000,
  })

  const { data, isLoading, isError: fullFailed } = useQuery({
    queryKey: ['invoice-preview-full', latestId],
    enabled: !!latestId,
    queryFn: async () => {
      const r = await offlineFetch(`/api/transactions/${latestId}`)
      if (!r.ok) throw new Error(`Could not load that bill (${r.status})`)
      return r.json()
    },
    staleTime: 5 * 60 * 1000,
  })

  /*
   * 🐛 2026-08-15 — the shop's field DEFINITIONS, so the preview can show a
   * field it has just been given.
   *
   * Rahul: "i tried to add the field but it's not working in the preview."
   * Nothing was broken. The preview draws the shop's most recent BILL, and a
   * bill created before a field existed carries no value for it — so there
   * was correctly nothing to draw.
   *
   * Correct is not the same as useful. A settings screen whose preview cannot
   * show the setting is the exact complaint that started this whole phase,
   * arriving by a third route. The preview now draws a defined-but-unfilled
   * field with a dash: the label sits where it will sit, and the dash stays
   * honest that THIS bill has no value for it.
   */
  const { data: cfData } = useQuery({
    queryKey: ['custom-fields'],
    queryFn: async () => {
      const r = await offlineFetch('/api/custom-fields')
      if (!r.ok) throw new Error('Could not load your fields')
      return r.json()
    },
    staleTime: 5 * 60 * 1000,
  })

  /** True only when we KNOW the shop has bills and we failed to fetch one. */
  const loadFailed = idFailed || fullFailed

  const { doc, isSample } = useMemo(() => {
    /*
     * 📄 Phase 4: the SAME mapper the download and the WhatsApp share use.
     *
     * This matters more here than anywhere else: if the preview built its shop
     * differently from the two paths that produce the real file, it would be
     * showing the shopkeeper a bill nobody ever receives.
     */
    const shop: InvoiceShop = invoiceShopFromSetting(setting)
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
  /**
   * Fields the shop has defined that the PREVIEWED bill carries no value for.
   *
   * Only the ones marked to print — a field kept for the shop's own records
   * must not appear on a preview of what the customer receives.
   */
  const pendingFields = useMemo(() => {
    const defs: { key: string; label: string; entity: string; showOnInvoice: boolean }[] =
      cfData?.fields ?? []
    /*
     * 🐛 Caught while verifying, in my own first version of this.
     *
     * I pooled every line's columns into ONE set, so a field filled on line 3
     * counted as filled on lines 1 and 2 and their dashes vanished. On screen
     * that read as "Expiry just does not show up" — the same symptom Rahul
     * reported, one layer down, and it would have shipped.
     *
     * The BILL is one scope and can be resolved here. A LINE is its own scope,
     * so item fields are passed through whole and the preview subtracts each
     * line's own columns. Presence is per-record, never pooled.
     */
    const onBill = new Set(doc.customFields.map(f => f.key))
    return defs
      .filter(f => f.showOnInvoice)
      .filter(f => (f.entity === 'invoice' ? !onBill.has(f.key) : f.entity === 'item'))
      .map(f => ({ key: f.key, label: f.label, entity: f.entity }))
  }, [cfData, doc])

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
            loadFailed={loadFailed}
            pendingFields={pendingFields}
            width={previewWidth}
          />
        )}
      </div>

      {isHub ? (
        <div className="bg-card rounded-2xl shadow-card border border-border/60 overflow-hidden">
          {INVOICE_SECTIONS.map((s, i) => {
            const Icon = s.icon
            return (
              /*
               * 🐛 2026-08-15. This row WAS a <button>, with the ⓘ rendered
               * inside it — a button nested in a button.
               *
               * That is invalid HTML. React reported it as a hydration error,
               * and the browser gives the outer control the click, so tapping
               * the ⓘ opened the section instead of the explanation. Rahul:
               * "icon button isn't working anywhere." I had blamed a
               * preventDefault() call and removed it; the real cause was the
               * nesting, and it was still here.
               *
               * Now: the row is a div, the tap target is one absolutely
               * positioned button covering it, and the ⓘ sits above that on
               * z-10 as a SIBLING. Same full-width tap area, valid markup,
               * and two controls that can each be pressed.
               */
              <div
                key={s.id}
                className={cn(
                  'relative flex items-center gap-3 p-3.5 hover:bg-muted/50 transition group',
                  i > 0 && 'border-t border-border/40',
                )}
              >
                <button
                  onClick={() => { haptic.click(); onOpen(s.id) }}
                  className="absolute inset-0 w-full h-full active:bg-muted/60"
                  aria-label={s.label}
                />
                <div className={cn(
                  'w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0',
                  s.tintBg,
                )}>
                  <Icon className={cn('w-5 h-5', s.tint)} />
                </div>
                <div className="flex-1 min-w-0">
                  <span className="font-medium text-sm inline-flex items-center gap-1.5">
                    {s.label}
                    {'hint' in s && s.hint && (
                      // Above the row-wide button, or it never receives the tap.
                      <span className="relative z-10">
                        <InfoHint text={s.hint} label={s.label} />
                      </span>
                    )}
                  </span>
                  <p className="text-xs text-muted-foreground truncate">{s.summary}</p>
                </div>
                <ChevronRight className="w-4 h-4 text-muted-foreground group-hover:text-primary group-hover:translate-x-0.5 transition flex-shrink-0" />
              </div>
            )
          })}
        </div>
      ) : (
        children
      )}
    </div>
  )
}
