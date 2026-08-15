'use client'

/**
 * A live preview of the shop's own bill, while they choose how it looks.
 *
 * 📄 2026-08-15. Rahul: "in bill book everything is categori[s]ed properly with
 * live preview so i want you to do like that or better than that."
 *
 * ── WHERE THIS BEATS myBillBook ───────────────────────────────────────
 *
 * Every myBillBook settings screen shows a preview, which is the right idea and
 * why the idea is copied. But theirs is a picture of a STOCK invoice — "Business
 * Name", "Rakesh Enterprises", one Samsung A50 — identical on every screen for
 * every shop. It can tell you a band is gold. It cannot tell you that YOUR
 * longest product name runs off the end of its column, which is the thing that
 * actually goes wrong.
 *
 * This renders the shop's most recent real bill. If they have never made one it
 * falls back to a sample and SAYS SO, rather than quietly showing invented
 * numbers as though they were the shop's own.
 *
 * ── DRAWN FULL SIZE, THEN SCALED ──────────────────────────────────────
 *
 * The first version hand-picked tiny font sizes — text-[5px], text-[5.5px] — to
 * make a page fit a phone. The microtypography guard caught it, and the guard
 * was right twice over: those are off-scale values, and hand-tuning them meant
 * the preview's proportions were my guesses rather than the document's.
 *
 * So this draws an A4 page at its real 794px width using ordinary type tokens,
 * and shrinks the whole thing with a CSS transform. Every proportion is then
 * the real one, and there is no off-scale text anywhere — the text is normal
 * size and the page is small, which is what "preview" has always meant.
 *
 * ── WHY A FOURTH RENDERER IS SAFE ─────────────────────────────────────
 *
 * The PDF, the WhatsApp picture and the public bill page all draw the same
 * `InvoiceDocument`; this is the fourth. That is the architecture working, not
 * a new risk: it computes nothing, and the guard in
 * invoice-renderers-single-source stops any renderer importing the arithmetic.
 *
 * It APPROXIMATES the PDF and says so on screen. Rendering the true PDF would
 * mean shipping a rasteriser to a phone and redrawing on every tap.
 */

import { useMemo } from 'react'
import { cn } from '@/lib/utils'
import type { InvoiceDocument } from '@/lib/invoice-document'
import { getInvoiceTheme } from '@/lib/invoice-themes'
import { getInvoiceTemplate, metricsFor } from '@/lib/invoice-templates'

/** Which block the shopkeeper is editing, so the preview can point at it. */
export type PreviewFocus = 'header' | 'items' | 'totals' | 'footer' | null

/** A4 at 96dpi. The page is drawn at this size and then scaled down. */
const PAGE_W = 794
const PAGE_H = 1123
/** 1mm at 96dpi — turns the template's mm metrics into real page pixels. */
const MM = 96 / 25.4

const money = (n: number) =>
  `₹${n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

export function InvoicePreview({
  doc,
  themeId,
  templateId,
  focus = null,
  isSample = false,
  width = 320,
  className,
}: {
  doc: InvoiceDocument
  themeId?: string | null
  templateId?: string | null
  /**
   * Ring the block being edited.
   *
   * myBillBook draws a dashed box around the field you are changing, which is a
   * genuinely good idea — it answers "which of these am I editing?" without a
   * word. Kept, in the shop's accent rather than alarm red, because nothing is
   * wrong.
   */
  focus?: PreviewFocus
  /** True when this is invented data because the shop has no bills yet. */
  isSample?: boolean
  /** On-screen width. The page scales to fit it. */
  width?: number
  className?: string
}) {
  const theme = getInvoiceTheme(themeId)
  const template = getInvoiceTemplate(templateId)
  const metrics = metricsFor(template)
  const scale = width / PAGE_W

  const rows = useMemo(() => doc.items.slice(0, 12), [doc.items])
  const hidden = doc.items.length - rows.length

  const ringFor = (block: PreviewFocus) =>
    focus === block
      ? { boxShadow: `0 0 0 3px ${theme.accent}`, borderRadius: 4 }
      : undefined

  return (
    <div className={cn('w-full', className)}>
      {/* The wrapper takes the SCALED size so it occupies the right space; the
          page inside keeps its true dimensions and is transformed. */}
      <div
        className="mx-auto overflow-hidden"
        style={{ width, height: PAGE_H * scale }}
      >
        <div
          className="bg-white shadow-sm border border-black/10 origin-top-left"
          style={{
            width: PAGE_W,
            height: PAGE_H,
            transform: `scale(${scale})`,
            color: theme.text,
          }}
          aria-label="Preview of your invoice"
        >
          {/* ── the shop's identity ───────────────────────────────────── */}
          <div style={ringFor('header')}>
            {template.header === 'band' ? (
              <div
                style={{
                  background: theme.headerBg,
                  color: theme.headerText,
                  height: metrics.bandHeight * MM,
                  padding: '18px 24px',
                }}
              >
                <HeaderContent doc={doc} muted={theme.headerMuted} serif={template.titleFace === 'serif'} />
              </div>
            ) : template.header === 'rule' ? (
              <div
                style={{
                  padding: '18px 24px',
                  height: metrics.bandHeight * MM,
                  borderBottom: `4px solid ${theme.accent}`,
                }}
              >
                <HeaderContent doc={doc} muted={theme.muted} serif={template.titleFace === 'serif'} />
              </div>
            ) : (
              <div style={{ padding: 10 }}>
                <div style={{ border: `2px solid ${theme.accent}`, padding: '14px 20px' }}>
                  <HeaderContent doc={doc} muted={theme.muted} serif={template.titleFace === 'serif'} />
                </div>
              </div>
            )}
          </div>

          {/* ── items ─────────────────────────────────────────────────── */}
          <div style={{ padding: '20px 24px 0', ...ringFor('items') }}>
            <div
              className="flex text-xs font-bold uppercase tracking-wide"
              style={{ color: theme.accent, background: `${theme.accent}14`, padding: '6px 8px' }}
            >
              <span className="flex-1">Item</span>
              <span className="w-20 text-right">Qty</span>
              <span className="w-28 text-right">Rate</span>
              <span className="w-32 text-right">Amount</span>
            </div>
            {rows.map((item, i) => (
              <div
                key={i}
                className="flex items-center text-sm"
                style={{
                  height: metrics.rowHeight * MM,
                  padding: '0 8px',
                  background: template.table === 'zebra' && i % 2 === 1 ? '#FAFBFC' : 'transparent',
                  borderBottom: template.table === 'rows' ? `1px solid ${theme.line}` : undefined,
                  border: template.table === 'grid' ? `1px solid ${theme.line}` : undefined,
                }}
              >
                <span className="flex-1 truncate pr-2">{item.name}</span>
                <span className="w-20 text-right">{item.qty}</span>
                <span className="w-28 text-right tabular-nums">{money(item.rate)}</span>
                <span className="w-32 text-right tabular-nums">{money(item.total)}</span>
              </div>
            ))}
            {hidden > 0 && (
              <p className="text-xs mt-1" style={{ color: theme.muted }}>
                + {hidden} more {hidden === 1 ? 'item' : 'items'}
              </p>
            )}
          </div>

          {/* ── totals ────────────────────────────────────────────────── */}
          <div style={{ padding: '18px 24px 0', display: 'flex', justifyContent: 'flex-end' }}>
            <div style={{ width: 280, ...ringFor('totals') }}>
              <Line label="Subtotal" value={money(doc.subtotal)} color={theme.muted} />
              {doc.hasTax && <Line label="Tax" value={money(doc.taxTotal)} color={theme.muted} />}
              <div
                className={cn(
                  'flex justify-between items-center font-bold',
                  template.totals === 'plain' ? 'text-xl' : 'text-base',
                )}
                style={{
                  marginTop: 6,
                  padding: '6px 10px',
                  ...(template.totals === 'bar'
                    ? { background: theme.accent, color: '#fff' }
                    : template.totals === 'panel'
                      ? { border: `2px solid ${theme.accent}`, color: theme.accent }
                      : { color: theme.text, padding: '6px 0' }),
                }}
              >
                <span>TOTAL</span>
                <span className="tabular-nums">{money(doc.total)}</span>
              </div>
            </div>
          </div>

          {/* ── footer ────────────────────────────────────────────────── */}
          <div style={{ padding: '18px 24px 0', ...ringFor('footer') }}>
            <p className="text-xs" style={{ color: theme.muted }}>{doc.totalInWords}</p>
            <div
              className="flex justify-between text-xs"
              style={{ marginTop: 12, paddingTop: 8, borderTop: `1px solid ${theme.line}`, color: theme.muted }}
            >
              <span>{doc.placeOfSupply ? `Place of supply: ${doc.placeOfSupply}` : ''}</span>
              <span style={{ color: theme.accent }}>Made with EkBook</span>
            </div>
          </div>
        </div>
      </div>

      <p className="text-2xs text-muted-foreground text-center mt-2 px-4">
        {isSample
          ? 'A sample bill — make your first sale and this shows your own.'
          : 'Your most recent bill.'}{' '}
        Close to the printed PDF, not exact.
      </p>
    </div>
  )
}

function HeaderContent({
  doc, muted, serif,
}: {
  doc: InvoiceDocument
  muted: string
  serif: boolean
}) {
  return (
    <div className="flex items-start justify-between gap-4">
      <div className="min-w-0">
        <p className={cn('text-2xl font-bold truncate', serif && 'font-serif')}>{doc.shop.name}</p>
        <p className="text-xs truncate" style={{ color: muted }}>
          {[doc.shop.phone, doc.shop.gstin && `GSTIN ${doc.shop.gstin}`].filter(Boolean).join('  ·  ')}
        </p>
        {doc.shop.address && (
          <p className="text-xs truncate" style={{ color: muted }}>{doc.shop.address}</p>
        )}
      </div>
      <div className="text-right flex-shrink-0">
        <p className="text-xl font-bold">INVOICE</p>
        <p className="text-xs" style={{ color: muted }}>
          {doc.invoiceNo} · {doc.dateLabel}
        </p>
      </div>
    </div>
  )
}

function Line({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div className="flex justify-between text-sm" style={{ color, padding: '2px 10px' }}>
      <span>{label}</span>
      <span className="tabular-nums">{value}</span>
    </div>
  )
}
