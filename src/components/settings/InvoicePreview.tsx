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
import { formatCustomValue } from '@/lib/custom-fields'
import { getInvoiceTheme } from '@/lib/invoice-themes'
import { getInvoiceTemplate, metricsFor } from '@/lib/invoice-templates'
import { getPaperSize, paperPx, MM_TO_PX } from '@/lib/invoice-paper'

/** Which block the shopkeeper is editing, so the preview can point at it. */
export type PreviewFocus = 'header' | 'items' | 'totals' | 'footer' | null

/**
 * 🐛 2026-08-15, CORRECTED. I cropped the page to its content and Rahul said:
 * "i wanted unnecessary padding removed but not what's important like you make
 * the preview section just the size of the bill which should not be like that.
 * it should be the A4 size".
 *
 * He is right and I had over-corrected. The wasted space he meant was the app's
 * own chrome — card padding around the preview — not the paper. A sheet with
 * white below the last line IS the document; cropping it showed a shape that
 * would never come out of a printer, so the preview stopped answering the
 * question it exists for.
 *
 * The page is the chosen sheet now, at full proportion. See invoice-paper.ts.
 */
/** 1mm at 96dpi — turns the template's mm metrics into real page pixels. */
const MM = MM_TO_PX

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
  paperId,
  focus = null,
  isSample = false,
  loadFailed = false,
  pendingFields = [],
  width = 320,
  className,
}: {
  doc: InvoiceDocument
  themeId?: string | null
  templateId?: string | null
  /** Setting.invoicePaperSize. The preview shows the sheet they will print on. */
  paperId?: string | null
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
  /** The shop HAS bills, and fetching one failed. Never guessed at. */
  loadFailed?: boolean
  /**
   * Fields the shop has DEFINED but which this bill carries no value for.
   *
   * 🐛 2026-08-15. Rahul: "i tried to add the field but it's not working in
   * the preview." Nothing was broken — the preview shows the shop's most
   * recent bill, and a bill created before a field existed has no value for
   * it, so there was correctly nothing to draw.
   *
   * Correct and useless are not the same thing. A settings screen whose
   * preview cannot show the setting is the complaint that started this whole
   * phase, arriving by a third route. So a defined-but-unfilled field is
   * drawn with a dash: the label lands where it will land, and the dash is
   * honest that THIS bill has no value.
   */
  pendingFields?: { key: string; label: string; entity: string }[]
  /** On-screen width. The page scales to fit it. */
  width?: number
  className?: string
}) {
  const rawTheme = getInvoiceTheme(themeId)
  // Secondary text darkened for the scaled view; see `readable` above.
  const theme = { ...rawTheme, muted: readable(rawTheme.muted), text: readable(rawTheme.text) }
  const template = getInvoiceTemplate(templateId)
  const metrics = metricsFor(template)
  const paper = getPaperSize(paperId)
  const page = paperPx(paper)
  const scale = width / page.width

  const rows = useMemo(() => doc.items.slice(0, 12), [doc.items])

  /*
   * 📄 Phase 7 — the shop's own columns, as COLUMNS, matching the PDF.
   *
   * 🐛 Caught before shipping: the PDF grew a column layout and this did not,
   * so choosing "Dispensary" changed the file and left the preview identical.
   * A shopkeeper would pick the design, see no difference, and conclude it
   * was broken — which is precisely the report Rahul filed twice. A preview
   * that does not show the setting is not a preview.
   *
   * The same fallback rule as the PDF: real columns only while the item name
   * stays usable, otherwise back to the sub-line.
   */
  const extraNames = useMemo(() => {
    if (template.extraColumns !== 'columns') return []
    const all = Array.from(new Set(doc.items.flatMap(i => i.customCols.map(c => c.label))))
    // The PDF's own rule: extras are funded from the whole table, and the
    // name must survive at 26mm. See invoice-pdf for why it is not 58/22.
    const forNameAndExtras = 178 - 6 - (16 + 14 + 20 + 12 + 26)
    return forNameAndExtras - all.length * 16 >= 26 ? all : []
  }, [doc.items, template.extraColumns])
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
        style={{ width, height: page.height * scale }}
      >
        <div
          className="bg-white shadow-sm border border-black/10 origin-top-left"
          style={{
            width: page.width,
            height: page.height,
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
                <HeaderContent doc={doc} muted={theme.headerMuted} serif={template.titleFace === 'serif'} pendingFields={pendingFields} />
              </div>
            ) : template.header === 'rule' ? (
              <div
                style={{
                  padding: '18px 24px',
                  height: metrics.bandHeight * MM,
                  borderBottom: `4px solid ${theme.accent}`,
                }}
              >
                <HeaderContent doc={doc} muted={theme.muted} serif={template.titleFace === 'serif'} pendingFields={pendingFields} />
              </div>
            ) : (
              <div style={{ padding: 10 }}>
                <div style={{ border: `2px solid ${theme.accent}`, padding: '14px 20px' }}>
                  <HeaderContent doc={doc} muted={theme.muted} serif={template.titleFace === 'serif'} pendingFields={pendingFields} />
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
              {extraNames.map(n => (
                <span key={n} className="w-24 truncate">{n}</span>
              ))}
              <span className="w-20 text-right">Qty</span>
              <span className="w-28 text-right">Rate</span>
              <span className="w-32 text-right">Amount</span>
            </div>
            {rows.map((item, i) => (
              <div
                key={i}
                style={{
                  padding: '0 8px',
                  background: template.table === 'zebra' && i % 2 === 1 ? '#FAFBFC' : 'transparent',
                  borderBottom: template.table === 'rows' ? `1px solid ${theme.line}` : undefined,
                  border: template.table === 'grid' ? `1px solid ${theme.line}` : undefined,
                }}
              >
                <div className="flex items-center text-sm" style={{ height: metrics.rowHeight * MM }}>
                  <span className="flex-1 truncate pr-2">{item.name}</span>
                  {extraNames.map(n => {
                    const v = item.customCols.find(cc => cc.label === n)
                    return (
                      <span key={n} className="w-24 truncate">
                        {v ? formatCustomValue(v) : ''}
                      </span>
                    )
                  })}
                  <span className="w-20 text-right">{item.qty}</span>
                  <span className="w-28 text-right tabular-nums">{money(item.rate)}</span>
                  <span className="w-32 text-right tabular-nums">{money(item.total)}</span>
                </div>
                {/*
                  * 📄 Phase 4 — the same sub-line the PDF draws, in the same
                  * two places: description under the name, unit-as-typed under
                  * the quantity. The row grows here exactly as it grows there,
                  * because a preview that lays the row out differently from the
                  * file is not previewing the file.
                  */}
                {(item.description || item.altQty || item.customCols.length > 0
                  || pendingFields.some(f => f.entity === 'item')) && (
                  <div className="flex text-2xs" style={{ paddingBottom: 5, color: readable(theme.muted) }}>
                    <span className="flex-1 truncate pr-2">
                      {/* 📄 Phase 5 — same sub-line as the PDF, same order. */}
                      {[item.description,
                        // Only what did NOT get its own column.
                        ...item.customCols
                          .filter(v => !extraNames.includes(v.label))
                          .map(v => `${v.label}: ${formatCustomValue(v)}`),
                        // Per LINE, not pooled: a field filled on another
                        // line is still missing from this one.
                        ...pendingFields
                          .filter(f => f.entity === 'item' && !item.customCols.some(c => c.key === f.key))
                          .map(f => `${f.label}: —`)]
                        .filter(Boolean).join("  ·  ")}
                    </span>
                    <span className="w-20 text-right">{item.altQty ? `(${item.altQty})` : ''}</span>
                    <span className="w-28" />
                    <span className="w-32" />
                  </div>
                )}
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
              {/* 📄 Phase 4 — under the total, matching where the PDF puts it. */}
              {doc.partyBalanceLabel && (
                <p className="text-xs text-right" style={{ marginTop: 6, color: readable(theme.muted) }}>
                  {doc.partyBalanceLabel}: {money(doc.partyBalance ?? 0)}
                </p>
              )}
            </div>
          </div>

          {/* ── footer ────────────────────────────────────────────────── */}
          <div style={{ padding: '18px 24px 0', ...ringFor('footer') }}>
            <p className="text-sm" style={{ color: theme.muted }}>{doc.totalInWords}</p>

            {/* 📄 Phase 3. Shown here for the same reason the whole preview
                exists: a shopkeeper typing terms should see where they land and
                how much of the page they take. */}
            {/*
              * 🐛 2026-08-15 — THE PAYMENT QR, which this preview never drew.
              *
              * Rahul: "neither QR code has been added." He was right, and the
              * cause was mine: I wired the QR into the PDF and the WhatsApp
              * picture and forgot the one surface he actually looks at. A
              * shopkeeper uploads their counter QR, opens the preview, and
              * sees no change — so the upload reads as broken.
              *
              * Drawn here whatever the bill's status, unlike the PDF, which
              * shows it only when money is owed. This is a PREVIEW of the
              * layout, and a shop whose recent bills are all cash-paid would
              * otherwise never see where their QR lands.
              */}
            {(doc.shop.paymentQrUrl || doc.shop.upiId) && (
              <div className="flex items-center gap-3 mt-3">
                {doc.shop.paymentQrUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={doc.shop.paymentQrUrl} alt="" className="w-20 h-20 object-contain" />
                ) : (
                  <div className="w-20 h-20 grid place-items-center rounded"
                    style={{ border: `1px solid ${theme.line}` }}>
                    <span className="text-2xs text-center px-1" style={{ color: theme.muted }}>QR</span>
                  </div>
                )}
                <div className="min-w-0">
                  <p className="text-sm font-bold" style={{ color: theme.text }}>Scan to pay</p>
                  <p className="text-xs" style={{ color: theme.muted }}>
                    {/* The same honest distinction the printed bill makes: an
                        uploaded code cannot carry the amount. */}
                    {doc.shop.paymentQrUrl
                      ? `Enter ${money(doc.due > 0 ? doc.due : doc.total)}`
                      : doc.shop.upiId}
                  </p>
                </div>
              </div>
            )}

            <div className="flex justify-between gap-6 mt-3">
              <div className="min-w-0 flex-1">
                {doc.shop.terms && (
                  <>
                    <p className="text-xs font-bold" style={{ color: theme.text }}>Terms &amp; Conditions</p>
                    <p className="text-xs whitespace-pre-line" style={{ color: theme.muted }}>
                      {doc.shop.terms.slice(0, 240)}
                    </p>
                  </>
                )}
                {(doc.shop.bank?.accountNumber || doc.shop.bank?.name) && (
                  <div className="mt-2">
                    <p className="text-xs font-bold" style={{ color: theme.text }}>Bank Details</p>
                    <p className="text-xs" style={{ color: theme.muted }}>
                      {[doc.shop.bank?.name, doc.shop.bank?.accountNumber && `A/c ${doc.shop.bank.accountNumber}`,
                        doc.shop.bank?.ifsc && `IFSC ${doc.shop.bank.ifsc}`].filter(Boolean).join(" · ")}
                    </p>
                  </div>
                )}
              </div>

              {(doc.shop.showSignatureBox !== false || doc.shop.signatureUrl) && (
                <div className="text-right flex-shrink-0" style={{ width: 200 }}>
                  <p className="text-xs" style={{ color: theme.muted }}>For {doc.shop.name}</p>
                  {doc.shop.signatureUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={doc.shop.signatureUrl} alt="" className="h-10 ml-auto object-contain" />
                  ) : (
                    <div style={{ height: 40 }} />
                  )}
                  <div style={{ borderTop: `1px solid ${theme.line}` }} />
                  <p className="text-xs" style={{ color: theme.muted }}>Authorised Signatory</p>
                </div>
              )}
            </div>

            {doc.shop.thankYou && (
              <p className="text-xs text-center mt-3" style={{ color: theme.muted }}>
                {doc.shop.thankYou}
              </p>
            )}
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

      {/*
        * 🐛 2026-08-15. This said "make your first sale" to a shop with 33
        * sales that month, because a FAILED fetch and an EMPTY ledger both
        * arrived here as `isSample`. Rahul saw it happen while Vercel's DDoS
        * rule was challenging his requests.
        *
        * Telling a shopkeeper they have never made a sale is not a cosmetic
        * slip — for a moment it says their books are empty. Three states now,
        * and the app only claims the ledger is empty when it actually knows.
        */}
      <p className="text-2xs text-muted-foreground text-center mt-2 px-4">
        {loadFailed
          ? "Couldn't load your latest bill, so this is a sample. Check your connection and pull to refresh."
          : isSample
            ? 'A sample bill — make your first sale and this shows your own.'
            : 'Your most recent bill.'}{' '}
        Close to the printed PDF, not exact.
      </p>
    </div>
  )
}

function HeaderContent({
  doc, muted, serif, pendingFields = [],
}: {
  doc: InvoiceDocument
  muted: string
  serif: boolean
  /** Defined by the shop, absent from THIS bill. See the prop on the parent. */
  pendingFields?: { key: string; label: string; entity: string }[]
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
          {doc.invoiceNo} · {doc.dateLabel}{doc.timeLabel ? `, ${doc.timeLabel}` : ''}
        </p>
        {/* 📄 Phase 5 — the bill's own fields, under the number. */}
        {doc.customFields.slice(0, 4).map(f => (
          <p key={f.key} className="text-sm font-medium" style={{ color: muted }}>
            {f.label}: {formatCustomValue(f)}
          </p>
        ))}
        {/* Defined, but this bill has none — see pendingFields. */}
        {pendingFields.filter(f => f.entity === 'invoice').slice(0, 4).map(f => (
          <p key={f.key} className="text-sm font-medium" style={{ color: muted }}>
            {f.label}: —
          </p>
        ))}
        {/* 📄 Phase 3: a real date, high on the page. */}
        {doc.dueDateLabel && (
          <p className="text-sm font-semibold" style={{ color: muted }}>
            Please pay by {doc.dueDateLabel}
          </p>
        )}
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
