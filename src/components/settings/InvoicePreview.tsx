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

import { useLayoutEffect, useMemo, useRef, useState } from 'react'
import { cn } from '@/lib/utils'
import { PinchZoom } from '@/components/common/PinchZoom'
import type { InvoiceDocument } from '@/lib/invoice-document'
import { getInvoiceTheme } from '@/lib/invoice-themes'
import { getInvoiceTemplate, metricsFor } from '@/lib/invoice-templates'

/** Which block the shopkeeper is editing, so the preview can point at it. */
export type PreviewFocus = 'header' | 'items' | 'totals' | 'footer' | null

/** A4 at 96dpi. The page is drawn at this width and then scaled down. */
const PAGE_W = 794
const PAGE_H = 1123
/**
 * How much blank paper to keep below the last line.
 *
 * 🐛 2026-08-15. Rahul: "there is unnecessary padding everywhere … you don't
 * need to waste around 20-30% of space for padding in preview". The first
 * version always drew a full A4 page, so a two-line bill showed its content in
 * the top third and six hundred pixels of empty white below it — on a phone,
 * most of the screen spent on nothing. A real page IS mostly empty; a PREVIEW
 * of one should not be.
 */
const TAIL_PADDING = 24
/** 1mm at 96dpi — turns the template's mm metrics into real page pixels. */
const MM = 96 / 25.4

/**
 * 🐛 2026-08-15. Rahul: "the fonts are too light that it's almost not visible".
 *
 * He is right and the cause is the scaling. The theme's `muted` is chosen to
 * sit quietly on a full-size page; shrink that page to a third and a mid-grey
 * on white stops being quiet and starts being absent. Contrast that is
 * comfortable at 100% is not comfortable at 35%.
 *
 * So the preview darkens every secondary colour rather than using the theme's
 * own. This is not the theme being wrong — the PDF is read at full size and is
 * correct there. It is the preview needing more contrast than the thing it
 * previews, which is normal for any scaled-down view.
 */
function readable(color: string): string {
  // Blend the colour 45% toward black. Cheap, predictable, and it keeps the
  // hue so a Midnight bill still reads as blue-grey rather than turning
  // neutral.
  const m = color.trim().match(/^#([0-9a-f]{6})$/i)
  if (!m) return color
  const n = parseInt(m[1], 16)
  const mix = (c: number) => Math.round(c * 0.55)
  const r = mix((n >> 16) & 255), g = mix((n >> 8) & 255), b = mix(n & 255)
  return `rgb(${r}, ${g}, ${b})`
}

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
  const rawTheme = getInvoiceTheme(themeId)
  // Secondary text darkened for the scaled view; see `readable` above.
  const theme = { ...rawTheme, muted: readable(rawTheme.muted), text: readable(rawTheme.text) }
  const template = getInvoiceTemplate(templateId)
  const metrics = metricsFor(template)
  const scale = width / PAGE_W

  /*
   * Crop the page to its content. Measured rather than estimated: the height
   * depends on the item count, the density and whether a tax line shows, and
   * every one of those is a number this component does not own.
   */
  const pageRef = useRef<HTMLDivElement>(null)
  const [contentH, setContentH] = useState(PAGE_H)
  useLayoutEffect(() => {
    const el = pageRef.current
    if (!el) return
    const measure = () => {
      const h = el.scrollHeight + TAIL_PADDING
      setContentH(Math.min(PAGE_H, Math.max(240, h)))
    }
    measure()
    // The bill, the layout and the type can all change under us.
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [doc, templateId, themeId, width])

  const rows = useMemo(() => doc.items.slice(0, 12), [doc.items])
  const hidden = doc.items.length - rows.length

  const ringFor = (block: PreviewFocus) =>
    focus === block
      ? { boxShadow: `0 0 0 3px ${theme.accent}`, borderRadius: 4 }
      : undefined

  return (
    <div className={cn('w-full', className)}>
      {/* The wrapper takes the SCALED size so it occupies the right space; the
          page inside keeps its true dimensions and is transformed.

          PinchZoom sits OUTSIDE that: a pinch magnifies what is already on
          screen rather than re-rendering the page at a new size. See
          PinchZoom for why the gesture is hand-written — the app switches the
          browser’s own off. */}
      <PinchZoom label="Invoice preview" className="mx-auto">
      <div
        className="mx-auto overflow-hidden"
        style={{ width, height: contentH * scale }}
      >
        <div
          ref={pageRef}
          className="bg-white shadow-sm border border-black/10 origin-top-left"
          style={{
            width: PAGE_W,
            // Height follows the content; the wrapper above crops to it.
            minHeight: 240,
            paddingBottom: TAIL_PADDING,
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
            <p className="text-sm" style={{ color: theme.muted }}>{doc.totalInWords}</p>
            <div
              className="flex justify-between text-sm"
              style={{ marginTop: 12, paddingTop: 8, borderTop: `1px solid ${theme.line}`, color: theme.muted }}
            >
              <span>{doc.placeOfSupply ? `Place of supply: ${doc.placeOfSupply}` : ''}</span>
              <span style={{ color: theme.accent }}>Made with EkBook</span>
            </div>
          </div>
        </div>
      </div>
      </PinchZoom>

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
        <p className="text-sm truncate font-medium" style={{ color: muted }}>
          {[doc.shop.phone, doc.shop.gstin && `GSTIN ${doc.shop.gstin}`].filter(Boolean).join('  ·  ')}
        </p>
        {doc.shop.address && (
          <p className="text-sm truncate font-medium" style={{ color: muted }}>{doc.shop.address}</p>
        )}
      </div>
      <div className="text-right flex-shrink-0">
        <p className="text-xl font-bold">INVOICE</p>
        <p className="text-sm font-medium" style={{ color: muted }}>
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
