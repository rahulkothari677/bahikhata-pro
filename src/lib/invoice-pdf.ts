/**
 * generateInvoicePDF — creates a professional, branded PDF invoice using jsPDF.
 *
 * V26 Phase 8 PDF Redesign v3 — aligned to EkBook-PDF-Redesign-Spec.md:
 * - Brand band (32 mm) with shop info left + INVOICE / invoice no / date / status pill right.
 * - Bill To as a real card (light bg, rounded rect, 1 px border) on the left.
 * - Right twin card for Place of Supply + Payment Mode — ONLY when party has GSTIN
 *   (per spec). The previous "INVOICE DETAILS" right column was redundant with the
 *   brand band header and is removed.
 * - Item table with HSN, zebra striping, brand-colour header.
 * - Totals on the right with GRAND TOTAL in a filled brand box.
 * - Amount-in-words strip, UPI QR (when upiId + balance due), signature block, footer.
 *
 * Layout targets Part 3 of the auditor spec. The two correctness items from Part 4
 * (statement R9-1/R9-2) live in PartyProfile.tsx, not here.
 */

import { registerUnicodeFont, THEME, formatPDFMoney } from './pdf/theme'
import { footerRoomMm, padStopY, bottomBlockNeedMm } from './invoice-footer-room'
import { paletteFor } from './pdf/palette'
import { getInvoiceLayout, layoutFitsPaper, type InvoiceLayout } from './invoice-layouts'
import { getInvoiceStyle, DENSITY_METRICS } from './invoice-styles'
import { getPaperSize } from './invoice-paper'
import { formatCustomValue } from './custom-fields'
import type { InvoiceDocument } from './invoice-document'
import { drawFooter, drawUPIQRBlock, drawImageQRBlock, newPageIfNeeded, fitToWidth } from './pdf/primitives'


/*
 * 📄 2026-08-15, Phase 1 of docs/INVOICE-ENGINE-PLAN.md.
 *
 * The local InvoiceItem / InvoiceData / ShopSetting shapes that used to live
 * here are GONE. They were a second description of an invoice, beside
 * invoice-document.ts — the layer written so the arithmetic happens exactly
 * once and renderers only lay out what they are handed. The PDF ignored it and
 * recomputed the due amount, the status and the amount in words for itself.
 *
 * It agreed with the picture and the payment page only because both happened to
 * call computeInvoiceDue. Nothing made that true, and every field added to a
 * bill from here on would have had to be added in two places — which is the
 * 'two things describing one thing' mistake that has produced four bugs in this
 * codebase already.
 *
 * Now: one document in, one PDF out. If a number is wrong it is wrong
 * everywhere, which is far easier to notice than wrong in one place.
 */

export interface InvoicePdfOptions {
  /** Setting.invoiceTheme. Drives the palette — see pdf/palette.ts. */
  themeId?: string | null
  /**
   * Setting.invoiceTemplate. Drives the STRUCTURE — see invoice-templates.ts.
   *
   * Separate from the theme on purpose: the template decides the bones and
   * the theme decides the colour, so eight themes and six templates give
   * forty-eight looks from fourteen entries. Defaults to 'standard', which
   * reproduces exactly what this renderer produced before templates existed.
   */
  templateId?: string | null
  /**
   * Setting.invoicePaperSize — the SHEET. See invoice-paper.ts.
   *
   * 2026-08-15: Rahul asked for a size option that carries through to what is
   * downloaded and what goes to WhatsApp, which is why it lands here and not
   * only in the preview. A picker that changed a picture on screen but not the
   * file the customer receives would be the invoiceTheme bug all over again.
   */
  paperId?: string | null
  /**
   * Setting.invoiceStyle — how the blocks are DRESSED. See invoice-styles.
   *
   * Separate from the layout so a shopkeeper can keep their skeleton and
   * change only the rules and spacing, and so a new style does not have to
   * be checked against every layout by hand.
   */
  styleId?: string | null
}

export async function generateInvoicePDF(
  invoice: InvoiceDocument,
  opts: InvoicePdfOptions = {},
): Promise<Blob> {
  const jsPDFMod: any = await import('jspdf')
  /*
   * The sheet. jsPDF is created in millimetres, which is why invoice-paper.ts
   * stores millimetres — nothing converts between the setting and the page.
   */
  const paper = getPaperSize(opts.paperId)
  const doc = new jsPDFMod.jsPDF({ unit: 'mm', format: paper.id })

  await registerUnicodeFont(doc)

  // Layout constants stay in THEME; every COLOUR now comes from the shop's
  // chosen theme. `band` is the header; `accent` is the highlight the table
  // header, the rules and the grand total use — the same split the WhatsApp
  // image and the payment page already make, so all three agree.
  // Page geometry from the chosen sheet, not from THEME's A4 constants.
  const margin = paper.marginMm
  const pageWidth = paper.widthMm
  const pageHeight = paper.heightMm
  const {
    band, onBand, onBandMuted, accent, accentSoft,
    text, textMuted, border, zebra, cardBg, white, paid, partial, due,
  } = paletteFor(opts.themeId)

  /*
   * The template supplies every structural number below. `standard` resolves
   * to the values this file used to hardcode — 32mm band, 7mm rows, 9pt body —
   * so no shop's invoice changes until they choose a different one.
   */
  /*
   * 📄 Phase 7c — THREE choices, not one.
   *
   * `templateId` now carries the LAYOUT (where blocks sit) and `styleId` the
   * STYLE (how they are dressed). They were one muddled value before, and
   * because the layout half was hardcoded, thirteen designs drew one page.
   *
   * The option keeps its old name so no caller and no stored row has to
   * change: Setting.invoiceTemplate held a template id and now holds a
   * layout id, and an unrecognised one falls back to Classic — which is what
   * every old template already looked like.
   */
  const chosenLayout = getInvoiceLayout(opts.templateId)
  /*
   * 🐛 2026-08-16 — TWELVE COLUMNS ON A HALF SHEET.
   *
   * Rahul sent a real bill: A5, and every item name running straight into the
   * HSN number beside it. "Fortune Sunflower Oil 1L1512". "GSTTEST Item
   * 0pc 0401". Unreadable, and it went to a customer.
   *
   * `layoutFitsPaper` exists precisely to refuse this, and says so in its own
   * comment — "rather than print off the page, the caller is told, and falls
   * back". THERE WAS NO CALLER. It was reached only by `presetIsLegal`, which
   * asks about A4. So the rule was written, tested, and never run on a bill.
   *
   * Falls back the COLUMNS only, not the whole design. The shop keeps the
   * frame, header and party block it chose — the thing that makes its bill
   * look like its bill — and gets a column set that fits the paper. Swapping
   * the entire layout would answer a legibility problem by taking away the
   * design, which is not a trade a shopkeeper asked for.
   */
  const layout: InvoiceLayout = layoutFitsPaper(chosenLayout, paper.id)
    ? chosenLayout
    : { ...chosenLayout, columns: 'simple' }
  const style = getInvoiceStyle(opts.styleId)
  const metrics = DENSITY_METRICS[style.density]
  // Read by the blocks below. `template` is gone; these two replace it.
  const lineW = style.lineWidth
  /*
   * Every figure below is READ, never recomputed.
   *
   * This block used to call computeInvoiceDue and derive the status itself.
   * `invoice.paid` is also a real correction, not a rename: the old code
   * printed `invoice.paid`, which is what was paid AT THE TILL, while the due
   * figure beside it already accounted for payments settled against the bill
   * afterwards. A part-paid bill could therefore print 'Paid 200' and 'Balance
   * Due 0' on the same page. The document's `paid` is total minus due, so the
   * two lines are now arithmetically forced to agree.
   */
  // 📄 Phase 4: the time joins the date rather than taking its own line — a
  // bill header is the most crowded part of the page. Null unless the shop
  // asked for it, so this is the date exactly as before by default.
  const dateStr = invoice.timeLabel ? `${invoice.dateLabel}, ${invoice.timeLabel}` : invoice.dateLabel
  const dueAmount = invoice.due
  const status = invoice.status
  const hasPartyGstin = !!(invoice.party?.gstin && invoice.party.gstin.trim())

  // ═══════════════════════════════════════════════════════════════════
  // 1. BRAND BAND — 32 mm full-width, shop info left, INVOICE + meta + status right
  // ═══════════════════════════════════════════════════════════════════
  const bandHeight = metrics.bandHeight
  /*
   * How the shop's identity is presented. `band` is the original: a filled
   * strip across the page, so every line inside it is drawn in `onBand`.
   * `rule` and `frame` leave the paper white, which means the same lines must
   * be drawn in body text instead — hence `headText`/`headMuted` below rather
   * than `onBand` used directly.
   */
  // 'band-name' and 'band-title' both fill; 'plain-name' leaves the paper white.
  const filledHeader = layout.header === 'band-name' || layout.header === 'band-title'
  const headText = filledHeader ? onBand : text
  const headMuted = filledHeader ? onBandMuted : textMuted

  /*
   * 📄 Phase 7c — THE FRAME, drawn before anything else.
   *
   * On the Jaipur reference this is the entire "premium" cue: two thin gold
   * rectangles and four corner brackets. It costs six lines and does more for
   * how the bill reads than any amount of colour — which is the lesson from
   * the research too. Expensive documents are restrained, not decorated.
   */
  if (layout.frame !== 'none') {
    doc.setDrawColor(accent.r, accent.g, accent.b)
    const outer = 6
    doc.setLineWidth(lineW * 2)
    doc.rect(outer, outer, pageWidth - outer * 2, pageHeight - outer * 2)

    if (layout.frame === 'double') {
      // The inner rule sits close, so the pair reads as one border.
      const inner = outer + 2
      doc.setLineWidth(lineW)
      doc.rect(inner, inner, pageWidth - inner * 2, pageHeight - inner * 2)

      /*
       * Corner brackets — an L in each corner, sitting ON the inner rule.
       * Drawn as two lines rather than a glyph so they scale with the sheet
       * and need no font.
       */
      if (style.ornament) {
        const arm = 9
        doc.setLineWidth(lineW * 2)
        const corners: [number, number, number, number][] = [
          [inner, inner, 1, 1],
          [pageWidth - inner, inner, -1, 1],
          [inner, pageHeight - inner, 1, -1],
          [pageWidth - inner, pageHeight - inner, -1, -1],
        ]
        for (const [cxp, cyp, dx, dy] of corners) {
          doc.line(cxp, cyp, cxp + arm * dx, cyp)
          doc.line(cxp, cyp, cxp, cyp + arm * dy)
        }
      }
    }
  }

  if (filledHeader) {
    doc.setFillColor(band.r, band.g, band.b)
    doc.rect(0, 0, pageWidth, bandHeight, 'F')
  } else {
    /*
     * 'plain-name' — no band. A rule under the identity block instead, so the
     * header still reads as a block rather than as floating text. The Jaipur
     * and Bengaluru references both do exactly this.
     */
    doc.setDrawColor(accent.r, accent.g, accent.b)
    doc.setLineWidth(lineW * 3)
    doc.line(margin, bandHeight - 4, pageWidth - margin, bandHeight - 4)
  }

  // 🔒 PDF Redesign Spec Part 3 §2: Shop logo at 16×16 mm in the brand band,
  // left of the shop name. If no logo, fall back to a rounded square with
  // the shop's initials (mirrors the in-app avatar). Fetch the logo as a
  // data URL so jsPDF can embed it (it can also accept http URLs but those
  // require the image to be CORS-accessible — Cloudinary serves with
  // permissive CORS headers, so direct addImage(url) works too).
  const logoSize = 16
  const logoX = margin
  const logoY = (bandHeight - logoSize) / 2  // vertical center in band
  let textLeftX = margin  // text starts at left margin by default
  if (invoice.shop.logoUrl) {
    try {
      // Fetch + convert to data URL. Cloudinary returns CORS headers so this
      // works from the browser. Wrapped in try/catch — if the fetch fails
      // (offline, network error), we just skip the logo and the brand band
      // renders without it (graceful degradation).
      const logoRes = await fetch(invoice.shop.logoUrl)
      if (logoRes.ok) {
        const blob = await logoRes.blob()
        const dataUrl = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader()
          reader.onload = () => resolve(reader.result as string)
          reader.onerror = () => reject(new Error('FileReader failed'))
          reader.readAsDataURL(blob)
        })
        // Detect format from blob type — jsPDF needs the format string.
        const fmt = blob.type.includes('png') ? 'PNG' : blob.type.includes('webp') ? 'WEBP' : 'JPEG'
        doc.addImage(dataUrl, fmt, logoX, logoY, logoSize, logoSize)
        // Shift the shop name right to make room for the logo + 3mm gap.
        textLeftX = margin + logoSize + 3
      }
    } catch (err) {
      // Logo fetch failed — fall back to no-logo rendering.
      console.warn('[invoice-pdf] Logo fetch failed, rendering without logo:', err)
    }
  }

  // Left: shop name (white, bold, 16pt) — 20pt per spec is too tall for typical Indian
  // shop names (often 20+ chars); 16pt keeps the band at one line.
  doc.setFont(THEME.font, 'bold')
  doc.setFontSize(16)
  doc.setTextColor(headText.r, headText.g, headText.b)
  /*
   * The one place a template may change the face. Body text stays in the
   * registered Unicode sans, which is the only font here that can draw
   * Devanagari, Gujarati and Tamil — offering a shop a serif that cannot
   * render its own language would not be a choice.
   */
  if (style.titleFace === 'serif') doc.setFont('times', 'bold')
  doc.text(invoice.shop.name || 'My Shop', textLeftX, 13)
  doc.setFont(THEME.font, 'bold')

  // Left: shop details (white, 8pt) — phone | GSTIN | address (one or two lines)
  doc.setFont(THEME.font, 'normal')
  doc.setFontSize(8)
  doc.setTextColor(headMuted.r, headMuted.g, headMuted.b)
  let detailY = 18
  const shopDetails: string[] = []
  if (invoice.shop.phone) shopDetails.push(invoice.shop.phone)
  if (invoice.shop.gstin) shopDetails.push('GSTIN: ' + invoice.shop.gstin)
  if (shopDetails.length > 0) {
    doc.text(shopDetails.join('  |  '), textLeftX, detailY)
    detailY += 4
  }
  if (invoice.shop.address) {
    const truncated = invoice.shop.address.length > 70 ? invoice.shop.address.slice(0, 67) + '...' : invoice.shop.address
    doc.text(truncated, textLeftX, detailY)
  }

  // Right: INVOICE word (16 pt), invoice no + date beneath.
  doc.setFont(THEME.font, 'bold')
  /*
   * 📄 Phase 7d — the invoice details, boxed on a bandless page.
   *
   * On the Jaipur and Bengaluru references the shop name is large and plain,
   * and the document details sit in their own small bordered card on the
   * right. That pairing is what makes the page read as letterhead rather
   * than as software output: the shop is the headline, the paperwork is a
   * footnote with a box round it.
   *
   * On a banded layout the details stay inside the band, where they always
   * were — a box drawn on top of a filled strip is just a box on a strip.
   */
  if (!filledHeader) {
    const label = invoice.title === 'PURCHASE BILL' ? 'PURCHASE BILL' : 'TAX INVOICE - ORIGINAL FOR RECIPIENT'
    doc.setFont(THEME.font, 'bold')
    doc.setFontSize(10)
    doc.setTextColor(accent.r, accent.g, accent.b)
    doc.text(label, pageWidth - margin, 14, { align: 'right' })

    /*
     * Label bold, value light, both right-aligned to the same edge — so the
     * eye finds the number without reading the word. Drawn as two runs
     * because jsPDF has no rich text, and measured so they do not collide.
     */
    const rows: [string, string][] = [
      ['Invoice No: ', invoice.invoiceNo || '—'],
      ['Date: ', dateStr],
    ]
    if (invoice.placeOfSupply) rows.push(['Place of Supply: ', invoice.placeOfSupply])

    let ry = 20
    doc.setFontSize(8.5)
    for (const [lab, val] of rows) {
      doc.setFont(THEME.font, 'normal')
      doc.setTextColor(text.r, text.g, text.b)
      const vw = doc.getTextWidth(val)
      doc.text(val, pageWidth - margin, ry, { align: 'right' })
      doc.setFont(THEME.font, 'bold')
      doc.text(lab, pageWidth - margin - vw, ry, { align: 'right' })
      ry += 5
    }
  } else {
    doc.setFontSize(16)
    doc.setTextColor(headText.r, headText.g, headText.b)
    doc.text('INVOICE', pageWidth - margin, 12, { align: 'right' })
    doc.setFont(THEME.font, 'normal')
    doc.setFontSize(9)
    doc.setTextColor(headMuted.r, headMuted.g, headMuted.b)
    doc.text(`${invoice.invoiceNo || ''}  |  ${dateStr}`, pageWidth - margin, 18, { align: 'right' })
  }

  /*
   * 📄 Phase 5 — the shop's own fields for this bill (PO number, vehicle no).
   *
   * Under the invoice number, where a reader already looks for "which
   * document is this". A PO number is how the buyer's accounts department
   * finds the bill at all, so burying it in the footer would defeat the
   * reason anyone adds one.
   */
  if (invoice.customFields.length) {
    doc.setFontSize(8)
    doc.setTextColor(headMuted.r, headMuted.g, headMuted.b)
    let cfY = 23
    for (const f of invoice.customFields.slice(0, 4)) {
      doc.text(`${f.label}: ${formatCustomValue(f)}`, pageWidth - margin, cfY, { align: 'right' })
      cfY += 4
    }
  }
  /*
   * 📄 Phase 3: the due date, printed as a DATE.
   *
   * High on the page rather than buried at the bottom, and worded as an
   * instruction. Research on invoice wording is consistent that a specific
   * date beats a term like "Net 30", and that putting the ask near the top
   * produces materially more immediate payments.
   */
  if (invoice.dueDateLabel) {
    doc.text(`Please pay by ${invoice.dueDateLabel}`, pageWidth - margin, 23, { align: 'right' })
  }

  /*
   * 🗑️ 2026-08-16 — THE STATUS PILL IS GONE. Rahul: "also partial should be
   * removed."
   *
   * He is right, and for a better reason than crowding. The bill already
   * states the position exactly, in the totals block: "Paid: 500.00 (CASH)"
   * and "Balance Due: 745.82". A coloured word saying PARTIAL adds nothing a
   * customer cannot already read, and on A5 it was landing beside the date —
   * "16 Aug 2026, 09:34 pm  Date:  PARTIAL" — so the one thing it did add
   * was a collision.
   *
   * A tax invoice is a legal record of a supply, not a payment dashboard.
   * The figures carry the payment position; a badge editorialises it.
   */
  doc.setTextColor(text.r, text.g, text.b)
  let y = bandHeight + 8

  // ═══════════════════════════════════════════════════════════════════
  // 2. BILL TO CARD + (optional) PLACE OF SUPPLY CARD
  //    Two-card row when party has a GSTIN; single full-width card otherwise.
  //    The previous "INVOICE DETAILS" right column (Invoice No / Date / Payment) is
  //    GONE — it duplicated the brand band. Payment mode moves into the Place of
  //    Supply card, which is the auditor's design.
  // ═══════════════════════════════════════════════════════════════════
  /*
   * 📄 Phase 7d — THE FULL-WIDTH RULED "BILL TO" STRIP.
   *
   * The gold and Tally references both do this instead of a card: one
   * bordered band across the page, divided into ruled cells — a label cell,
   * the customer, then their GSTIN and state. It fills the width rather than
   * leaving half the page empty beside a card, which is most of why a
   * printed bill book looks deliberate and a floating card looks like
   * software.
   */
  if (layout.party === 'grid-band') {
    const bandH = 16
    doc.setFillColor(accentSoft.r, accentSoft.g, accentSoft.b)
    doc.setDrawColor(accent.r, accent.g, accent.b)
    doc.setLineWidth(lineW)
    doc.rect(margin, y, pageWidth - margin * 2, bandH, 'FD')

    // Two vertical rules: after the label, and before the tax cell.
    const labelW = 24
    const taxX = pageWidth - margin - 58
    doc.line(margin + labelW, y, margin + labelW, y + bandH)
    doc.line(taxX, y, taxX, y + bandH)

    doc.setFont(THEME.font, 'bold')
    doc.setFontSize(metrics.smallPt)
    doc.setTextColor(accent.r, accent.g, accent.b)
    doc.text('Bill To:', margin + 3, y + 6)

    doc.setFont(THEME.font, 'bold')
    doc.setFontSize(metrics.bodyPt)
    doc.setTextColor(text.r, text.g, text.b)
    const who = invoice.party?.name || 'Walk-in Customer'
    doc.text(doc.splitTextToSize(who, taxX - margin - labelW - 8)[0] ?? who, margin + labelW + 3, y + 6)

    doc.setFont(THEME.font, 'normal')
    doc.setFontSize(metrics.smallPt)
    doc.setTextColor(textMuted.r, textMuted.g, textMuted.b)
    const sub = [invoice.party?.address, invoice.party?.phone].filter(Boolean).join(' | ')
    if (sub) doc.text(doc.splitTextToSize(sub, taxX - margin - labelW - 8)[0] ?? '', margin + labelW + 3, y + 11)

    doc.setTextColor(text.r, text.g, text.b)
    doc.text(`GSTIN: ${invoice.party?.gstin || '—'}`, taxX + 3, y + 6)
    if (invoice.placeOfSupply) doc.text(`State: ${invoice.placeOfSupply}`, taxX + 3, y + 11)

    y += bandH + 6
  } else {

  const cardGap = 6
  const leftCardW = hasPartyGstin ? 95 : pageWidth - 2 * margin
  const rightCardW = pageWidth - 2 * margin - leftCardW - cardGap
  const rightCardX = margin + leftCardW + cardGap
  // Estimate left card height from party fields present
  const leftLines: string[] = []
  if (invoice.party?.phone) leftLines.push(invoice.party.phone)
  if (invoice.party?.gstin) leftLines.push('GSTIN: ' + invoice.party.gstin)
  if (invoice.party?.address) {
    // split into 2 lines max at ~leftCardW-8mm
    const addrLines = doc.splitTextToSize(invoice.party.address, leftCardW - 8)
    leftLines.push(...addrLines.slice(0, 2))
  }
  // Card body: 1 (name) + leftLines.length + label row + padding
  const leftCardH = 16 + leftLines.length * 4 + 4
  // Right card body: label + 2 fields + padding
  const rightCardH = hasPartyGstin ? 24 : 0

  // Draw left card background (light card with rounded rect + thin border per spec)
  doc.setFillColor(cardBg.r, cardBg.g, cardBg.b)
  doc.setDrawColor(border.r, border.g, border.b)
  doc.setLineWidth(0.2)
  doc.roundedRect(margin, y, leftCardW, leftCardH, 2, 2, 'FD')

  // BILL TO label (7pt uppercase letter-spaced grey)
  doc.setFont(THEME.font, 'bold')
  doc.setFontSize(7)
  doc.setTextColor(textMuted.r, textMuted.g, textMuted.b)
  doc.text('BILL TO', margin + 3, y + 5)

  // Party name (11pt bold)
  doc.setFont(THEME.font, 'bold')
  doc.setFontSize(11)
  doc.setTextColor(text.r, text.g, text.b)
  const partyName = invoice.party?.name || 'Walk-in Customer'
  const nameLines = doc.splitTextToSize(partyName, leftCardW - 6)
  doc.text(nameLines.slice(0, 2), margin + 3, y + 11)

  // Party details (8pt normal muted)
  doc.setFont(THEME.font, 'normal')
  doc.setFontSize(8)
  doc.setTextColor(textMuted.r, textMuted.g, textMuted.b)
  let partyDetailY = y + 16
  for (const line of leftLines) {
    doc.text(line, margin + 3, partyDetailY)
    partyDetailY += 4
  }

  // Right card: Place of Supply + Payment Mode (ONLY when party has GSTIN)
  if (hasPartyGstin && rightCardW > 30) {
    doc.setFillColor(cardBg.r, cardBg.g, cardBg.b)
    doc.setDrawColor(border.r, border.g, border.b)
    doc.setLineWidth(0.2)
    doc.roundedRect(rightCardX, y, rightCardW, rightCardH, 2, 2, 'FD')

    doc.setFont(THEME.font, 'bold')
    doc.setFontSize(7)
    doc.setTextColor(textMuted.r, textMuted.g, textMuted.b)
    doc.text('SUPPLY & PAYMENT', rightCardX + 3, y + 5)

    doc.setFont(THEME.font, 'normal')
    doc.setFontSize(8)
    doc.setTextColor(text.r, text.g, text.b)
    const placeOfSupply = invoice.party?.state
      ? `${invoice.party.state}${invoice.isInterState ? ' (Inter-state)' : ' (Intra-state)'}`
      : '—'
    doc.text('Place of Supply: ' + placeOfSupply, rightCardX + 3, y + 11)
    doc.text('Payment Mode: ' + invoice.paymentMode.toUpperCase(), rightCardX + 3, y + 16)

    doc.setTextColor(text.r, text.g, text.b)
  }

  y += Math.max(leftCardH, rightCardH) + 6

  }

  // ═══════════════════════════════════════════════════════════════════
  // 3. ITEM TABLE — HSN included, zebra striping, brand-colour header
  // ═══════════════════════════════════════════════════════════════════
  const tableWidth = pageWidth - 2 * margin
  const colStart = margin
  // Column proportions (must sum to tableWidth = 180)
  // # | Item | HSN | Qty | Rate | GST% | Amount
  // 8 | 58  | 20  | 18  | 24   | 18   | 34
  /*
   * 📄 Phase 7 — the shop's OWN columns become real table columns, when
   * they fit.
   *
   * Rahul: "every image should work properly with all the field which user
   * will add." So this is MEASURED, not assumed. A template asks for
   * `columns`; it gets them only while the item name keeps a workable width.
   * Past that the extra fields drop to the sub-line, where they cost no
   * horizontal space at all and stay legible however many there are.
   *
   * A layout that looks right with two extra columns and collides with five
   * is a trap, and the shopkeeper who finds it is mid-sale. Falling back is
   * not a compromise here — it is the feature.
   */
  const wantsColumns = layout.columns === 'trade'
  const extraNames = wantsColumns
    ? Array.from(new Set(invoice.items.flatMap(i => i.customCols.map(c => c.label))))
    : []

  const tableW = (pageWidth - margin * 2) - 2
  /** What the A4 layout was drawn against. Everything scales from this. */
  const REFERENCE_W = 178
  const k = tableW / REFERENCE_W

  /*
   * 📄 Phase 7c — THE FULL GST BREAKUP, twelve columns.
   *
   * What the Jaipur and Ghaziabad references both print, and what a
   * wholesaler's buyer and their CA both expect: the discount, the taxable
   * value and the CGST/SGST/cess split each in their own column rather than
   * summarised. It is the difference between a receipt and an accounting
   * document.
   *
   * Only offered on A4 with a dense style — `layoutFitsPaper` and
   * `styleFitsLayout` refuse the rest rather than printing off the page,
   * which is what the old renderer did for a whole phase before a test
   * caught it.
   */
  const gstFull = layout.columns === 'gst-full'

  /** Enough for "AUG-849" or "08/2027" at the small size. */
  const EXTRA_W = 16 * k
  /** Below this the item name stops being an item name. */
  const MIN_NAME_W = 26 * k

  let cols: { name: string; x: number; w: number; align: string }[]
  let extraCols: { name: string; key: string; x: number; w: number; align: "left" }[] = []
  let itemW: number
  let cx: number

  if (gstFull) {
    // Twelve columns, proportioned from the reference bill.
    const w = {
      num: 7, item: 46, hsn: 14, qty: 10, unit: 11, rate: 17,
      disc: 11, taxable: 20, cgst: 11, sgst: 11, cess: 9, total: 21,
    }
    const sum = Object.values(w).reduce((a, b) => a + b, 0)
    const g = tableW / sum
    let x = colStart
    const push = (name: string, width: number, align: string) => {
      const col = { name, x, w: width * g, align }
      x += width * g
      return col
    }
    cols = [
      push('NO', w.num, 'left'),
      push('DESCRIPTION OF ITEMS', w.item, 'left'),
      push('HSN', w.hsn, 'left'),
      push('QTY', w.qty, 'right'),
      push('UNIT', w.unit, 'left'),
      push('RATE', w.rate, 'right'),
      push('DISC %', w.disc, 'right'),
      push('TAXABLE', w.taxable, 'right'),
      push('CGST %', w.cgst, 'right'),
      push('SGST %', w.sgst, 'right'),
      push('CESS %', w.cess, 'right'),
      push('TOTAL', w.total, 'right'),
    ]
    itemW = w.item * g
    cx = colStart
  } else {
    const hasExtras = extraNames.length > 0
    const W = hasExtras
      ? { num: 6, hsn: 16, qty: 14, rate: 20, gst: 12, amount: 26 }
      : { num: 8, hsn: 20, qty: 18, rate: 24, gst: 18, amount: 30 }
    const tailW = (W.hsn + W.qty + W.rate + W.gst + W.amount) * k
    const forNameAndExtras = tableW - W.num * k - tailW
    const nameW = forNameAndExtras - extraNames.length * EXTRA_W
    const useColumns = hasExtras && nameW >= MIN_NAME_W
    const extras = useColumns ? extraNames : []
    itemW = useColumns ? nameW : forNameAndExtras

    cx = colStart + W.num * k + itemW
    extraCols = extras.map(name => {
      const col = { name: name.toUpperCase().slice(0, 8), key: name, x: cx, w: EXTRA_W, align: 'left' as const }
      cx += EXTRA_W
      return col
    })

    cols = [
      { name: '#', x: colStart + 1 * k, w: W.num * k, align: 'left' },
      { name: 'ITEM', x: colStart + W.num * k, w: itemW, align: 'left' },
      ...extraCols.map(c => ({ name: c.name, x: c.x, w: c.w, align: c.align as string })),
      { name: 'HSN', x: cx, w: W.hsn * k, align: 'left' },
      { name: 'QTY', x: cx + W.hsn * k, w: W.qty * k, align: 'right' },
      { name: 'RATE', x: cx + (W.hsn + W.qty) * k, w: W.rate * k, align: 'right' },
      { name: 'GST%', x: cx + (W.hsn + W.qty + W.rate) * k, w: W.gst * k, align: 'right' },
      { name: 'AMOUNT', x: cx + (W.hsn + W.qty + W.rate + W.gst + W.amount) * k, w: 0, align: 'right' },
    ]
  }
  const colEnd = pageWidth - margin - 1

  const drawTableHeader = (headerY: number) => {
    // Header row: brand colour at 12% opacity (spec) — emulate by drawing the
    // brand rect then overlaying a 88% white rect.
    doc.setFillColor(accent.r, accent.g, accent.b)
    doc.rect(colStart, headerY, tableWidth, 8, 'F')
    doc.setFillColor(255, 255, 255)
    doc.setGState(doc.GState({ opacity: 0.88 }))
    doc.rect(colStart, headerY, tableWidth, 8, 'F')
    doc.setGState(doc.GState({ opacity: 1 }))

    doc.setFont(THEME.font, 'bold')
    doc.setFontSize(8)
    doc.setTextColor(accent.r, accent.g, accent.b)
    cols.forEach(c => {
      if (c.align === 'right') {
        doc.text(c.name, c.x + c.w - 1, headerY + 5.5, { align: 'right' })
      } else {
        doc.text(c.name, c.x, headerY + 5.5)
      }
    })
    doc.setTextColor(text.r, text.g, text.b)
  }

  const headerHeight = metrics.headerHeight
  drawTableHeader(y)
  y += headerHeight

  // Item rows. Type moves with the row height — changing one without the
  // other is how a table stops lining up.
  doc.setFont(THEME.font, 'normal')
  doc.setFontSize(metrics.bodyPt)
  const baseRowHeight = metrics.rowHeight

  /*
   * 📄 Phase 4: a row grows by one line when the shop has asked for the item
   * description or the unit-as-typed, and by nothing at all otherwise.
   *
   * ONE extra line, truncated rather than wrapped. Wrapping would make the
   * row height depend on the text, which the zebra fill, the grid rules and
   * the page-break check all read — three things to keep in step for a field
   * that is a note on a grocery line, not a paragraph. A predictable table is
   * worth more here than an uncapped one.
   *
   * Both fields are already null when the toggle is off (see
   * buildInvoiceDocument), so there is no setting to consult here.
   */
  const subLineHeight = baseRowHeight * 0.55
  const shownAsColumns = new Set(extraCols.map(c => c.key))
  const hasSubLine = (it: (typeof invoice.items)[number]) =>
    !!(it.description || it.altQty
      || it.customCols.some(c => !shownAsColumns.has(c.label)))

  invoice.items.forEach((item, i) => {
    const rowHeight = baseRowHeight + (hasSubLine(item) ? subLineHeight : 0)
    y = newPageIfNeeded(doc, y, rowHeight + 2, () => {
      drawTableHeader(y)
      doc.setFont(THEME.font, 'normal')
      doc.setFontSize(metrics.bodyPt)
      y += headerHeight
    }, pageHeight)

    /*
     * How this row is separated from the next.
     *
     *   zebra — alternate tinted rows, no lines. The original.
     *   rows  — a hairline under each row. Quietest.
     *   grid  — every cell boxed, which is what a CA reading a stack of
     *           bills actually wants: the eye can follow a column down the
     *           page without losing its place.
     */
    if (style.zebra && i % 2 === 1) {
      doc.setFillColor(zebra.r, zebra.g, zebra.b)
      doc.rect(colStart, y, tableWidth, rowHeight, 'F')
    } else if (style.rules === 'hairline') {
      doc.setDrawColor(border.r, border.g, border.b)
      doc.setLineWidth(0.1)
      doc.line(colStart, y + rowHeight, colStart + tableWidth, y + rowHeight)
    } else if (style.rules === 'boxed') {
      doc.setDrawColor(border.r, border.g, border.b)
      doc.setLineWidth(0.1)
      doc.rect(colStart, y, tableWidth, rowHeight)
      // Vertical rules between columns. The first column edge is the table
      // edge already drawn, so start from the second.
      cols.slice(1).forEach(c => doc.line(c.x - 1, y, c.x - 1, y + rowHeight))
    }

    /*
     * 🐛 2026-08-16 — LONG NAMES RAN INTO THE HSN COLUMN.
     *
     * Rahul's bill: "Fortune Sunflower Oil 1L1512", "GSTTEST Item 0pc 0401".
     * The name and the HSN number with no gap between them, because this
     * truncated at a fixed 32 CHARACTERS while the column is measured in
     * MILLIMETRES. 32 characters is wider than the name column on A5, and
     * narrower than it on A4 — so the rule was simultaneously too tight and
     * too loose, and never right.
     *
     * Now measured against the real column width, with a millimetre of air
     * before the next column. This is the same mistake as the footer: a
     * distance guessed in one unit and consumed in another.
     */
    const nameRoom = cols[2].x - cols[1].x - 1.5
    const name = fitToWidth(doc, item.name, nameRoom)
    // `baseline` rather than a fixed 5mm: at compact's 5.4mm row a 5mm drop
    // would put the text on the row's bottom edge.
    const tY = y + metrics.baseline
    doc.setTextColor(text.r, text.g, text.b)
    doc.text(String(i + 1), cols[0].x, tY)
    doc.text(name, cols[1].x, tY)
    /*
     * 📄 Phase 7 — the shop's own columns, drawn in their columns.
     *
     * Matched by LABEL, which is what the snapshot on the line carries. A
     * line that predates the column simply has nothing for it and prints
     * blank, rather than shifting every value one column left — which is how
     * a batch number ends up under the expiry heading.
     */
    for (const ec of extraCols) {
      const v = item.customCols.find(c => c.label === ec.key)
      if (v) {
        doc.setFontSize(metrics.smallPt)
        doc.text(doc.splitTextToSize(formatCustomValue(v), ec.w - 1)[0] ?? '', ec.x, tY)
        doc.setFontSize(metrics.bodyPt)
      }
    }
    if (gstFull) {
      /*
       * The twelve-column row. Every figure READ from the document, never
       * recomputed — the taxable value is the line total less its own tax,
       * which the document already worked out once for every surface.
       */
      const halfGst = item.gstRate / 2
      const taxable = item.rate * item.qtyValue
      const R = (n: number) => n.toFixed(2)
      doc.setFontSize(metrics.smallPt)
      doc.text(item.hsn || '-', cols[2].x, tY)
      doc.text(String(item.qtyValue), cols[3].x + cols[3].w - 1, tY, { align: 'right' })
      doc.text(item.unit || 'pcs', cols[4].x, tY)
      doc.text(R(item.rate), cols[5].x + cols[5].w - 1, tY, { align: 'right' })
      doc.text('0%', cols[6].x + cols[6].w - 1, tY, { align: 'right' })
      doc.text(R(taxable), cols[7].x + cols[7].w - 1, tY, { align: 'right' })
      doc.text(`${halfGst}%`, cols[8].x + cols[8].w - 1, tY, { align: 'right' })
      doc.text(`${halfGst}%`, cols[9].x + cols[9].w - 1, tY, { align: 'right' })
      doc.text('0%', cols[10].x + cols[10].w - 1, tY, { align: 'right' })
      doc.setFontSize(metrics.bodyPt)
      doc.text(formatPDFMoney(item.total), colEnd, tY, { align: 'right' })
    } else {
      doc.setFontSize(metrics.smallPt)
      doc.text(item.hsn || '-', cols[2].x, tY)
      doc.setFontSize(metrics.bodyPt)
      doc.text(`${item.qtyValue} ${item.unit || 'pcs'}`, cols[3].x + cols[3].w - 1, tY, { align: 'right' })
      doc.text(item.rate.toFixed(2), cols[4].x + cols[4].w - 1, tY, { align: 'right' })
      doc.text(item.gstRate + '%', cols[5].x + cols[5].w - 1, tY, { align: 'right' })
      doc.text(formatPDFMoney(item.total), colEnd, tY, { align: 'right' })
    }

    /*
     * The sub-line. Description under the name, unit-as-typed under the
     * quantity — each sits below the column it qualifies, so the eye does not
     * have to work out which number the note belongs to.
     *
     * Muted and a size down: it is a qualifier, not a second item. Drawn from
     * `muted` so it follows the shop's chosen theme like everything else.
     */
    if (hasSubLine(item)) {
      const subY = tY + subLineHeight
      doc.setFontSize(metrics.smallPt)
      doc.setTextColor(textMuted.r, textMuted.g, textMuted.b)
      /*
       * 📄 Phase 5: the shop's own columns join the description on the same
       * sub-line — "Batch: A-118 · Exp: 12 Mar 2027".
       *
       * Beside the name rather than as real table columns, deliberately. Six
       * fixed columns already fill an A4 row; adding three more would shrink
       * the item name, which is the field a customer actually checks. A
       * pharmacy bill needs batch and expiry PRESENT and legible, not aligned.
       */
      // `cols` above is the TABLE columns — different thing, hence the name.
      // Only what did NOT get a column of its own, or it prints twice.
      const shown = new Set(extraCols.map(c => c.key))
      const spare = item.customCols
        .filter(v => !shown.has(v.label))
        .map(v => `${v.label}: ${formatCustomValue(v)}`)
        .join("  ·  ")
      /*
       * 🐛 Caught by the maximal-invoice guard: the shop's own fields come
       * FIRST, the description last.
       *
       * The sub-line is clipped to the item column. With the description
       * first, a long one ("Refrigerated. Store below 25°C…") ate the whole
       * line and the BATCH NUMBER was silently truncated off the bill — the
       * exact failure this phase was asked to rule out, on the default
       * template, with no warning to anybody.
       *
       * A batch number is a legal record; a description is a courtesy. When
       * only one of them fits, it is not a close call.
       */
      const sub = [spare, item.description].filter(Boolean).join("  ·  ")
      if (sub) {
        // Truncated to the name column so it can never run under HSN.
        const room = cols[2].x - cols[1].x - 2
        doc.text(doc.splitTextToSize(sub, room)[0] ?? '', cols[1].x, subY)
      }
      if (item.altQty) {
        doc.text(`(${item.altQty})`, cols[3].x + cols[3].w - 1, subY, { align: 'right' })
      }
      doc.setFontSize(metrics.bodyPt)
      doc.setTextColor(text.r, text.g, text.b)
    }

    y += rowHeight
  })

  /*
   * 📄 Phase 7c — EMPTY RULED ROWS, padding the table to a full block.
   *
   * The classic Indian bill-book look, and the reason a printed pad feels
   * deliberate where software output feels ragged: a five-item bill and a
   * twenty-item bill are the same shape. It also stops a customer adding a
   * line to a bill they were handed, which is why the pads are printed that
   * way in the first place.
   *
   * Padded only while the rows FIT — never onto a second page. Empty ruled
   * rows spilling over a page break would be padding for its own sake, and
   * the shopkeeper pays for that paper.
   */
  if (layout.tableFill === 'pad') {
    /*
     * 🐛 2026-08-16 — A FIVE-ITEM BILL CAME OUT ON TWO PAGES.
     *
     * This reserved `min(90, 30% of the sheet)` for everything below the
     * table — a number I chose while looking at one bill. Royal's footer is
     * about 165mm on A4, so the padding ran the rows down to 208mm, the
     * footer would not fit, and the shopkeeper got a page of empty ruled
     * rows followed by a nearly blank second page carrying the totals.
     *
     * Now it asks how big the footer ACTUALLY is, from the blocks that will
     * actually be drawn. See invoice-footer-room.ts for why that lives in a
     * file of its own rather than as a better constant here.
     */
    const termsLineCount = (() => {
      if (!invoice.shop.terms) return 0
      // splitTextToSize measures at the CURRENT font size, so ask at the size
      // the terms block will use, then put the size back.
      const was = doc.getFontSize()
      doc.setFontSize(metrics.smallPt)
      const n: number = doc.splitTextToSize(invoice.shop.terms, tableWidth * 0.62).length
      doc.setFontSize(was)
      return n
    })()
    const bankLineCount = [
      invoice.shop.bank?.name, invoice.shop.bank?.accountName,
      invoice.shop.bank?.accountNumber, invoice.shop.bank?.ifsc,
    ].filter(Boolean).length

    const reserveForFooter = footerRoomMm({
      totalsRowCount:
        2 // Subtotal and Taxable Value always print
        + (invoice.discount > 0 ? 1 : 0)
        + (invoice.cgst > 0 ? 1 : 0) + (invoice.sgst > 0 ? 1 : 0) + (invoice.igst > 0 ? 1 : 0)
        + (invoice.roundOff && Math.abs(invoice.roundOff) >= 0.005 ? 1 : 0),
      ruledTotals: layout.totals === 'ruled',
      hasDue: invoice.due > 0,
      hasPartyBalance: !!invoice.partyBalanceLabel,
      termsLineCount, bankLineCount, pageHeight,
    })
    const roomLeft = padStopY(pageHeight, reserveForFooter) - y
    const blanks = Math.max(0, Math.floor(roomLeft / baseRowHeight))
    for (let n = 0; n < blanks; n++) {
      if (style.zebra && (invoice.items.length + n) % 2 === 1) {
        doc.setFillColor(zebra.r, zebra.g, zebra.b)
        doc.rect(colStart, y, tableWidth, baseRowHeight, 'F')
      } else if (style.rules === 'boxed') {
        doc.setDrawColor(border.r, border.g, border.b)
        doc.setLineWidth(lineW)
        doc.rect(colStart, y, tableWidth, baseRowHeight)
        cols.slice(1).forEach(c => doc.line(c.x - 1, y, c.x - 1, y + baseRowHeight))
      } else if (style.rules === 'hairline') {
        doc.setDrawColor(border.r, border.g, border.b)
        doc.setLineWidth(lineW)
        doc.line(colStart, y + baseRowHeight, colStart + tableWidth, y + baseRowHeight)
      }
      y += baseRowHeight
    }
  }

  // Table bottom border
  doc.setDrawColor(border.r, border.g, border.b)
  doc.setLineWidth(0.3)
  doc.line(colStart, y, colStart + tableWidth, y)
  y += 6

  // ═══════════════════════════════════════════════════════════════════
  // 4. TOTALS — right-aligned, clean
  // ═══════════════════════════════════════════════════════════════════
  const totalsWidth = 70
  const totalsX = pageWidth - margin - totalsWidth
  const totalsValueX = pageWidth - margin - 1

  doc.setFontSize(9)
  doc.setFont(THEME.font, 'normal')
  doc.setTextColor(text.r, text.g, text.b)

  /*
   * 📄 Phase 7d — TOTALS AS A RULED MINI-TABLE.
   *
   * The gold reference puts every figure in its own bordered cell rather
   * than on a right-aligned line. It is a small change and it moves the bill
   * from "receipt" to "accounts" — the same reason the item table is ruled.
   *
   * The grand total then gets a filled bar of its own below the cells, which
   * is drawn further down by the existing `bar`/`panel` code.
   */
  const ruledTotals = layout.totals === 'ruled'

  const totalsLine = (label: string, value: string, bold?: boolean) => {
    if (ruledTotals) {
      const h = 6
      doc.setDrawColor(accent.r, accent.g, accent.b)
      doc.setLineWidth(lineW)
      doc.rect(totalsX - 3, y - 4, totalsWidth + 3, h)
    }
    if (bold) doc.setFont(THEME.font, 'bold')
    doc.text(label, totalsX, y)
    doc.text(value, totalsValueX, y, { align: 'right' })
    if (bold) doc.setFont(THEME.font, 'normal')
    y += ruledTotals ? 6 : 5
  }

  totalsLine('Subtotal', formatPDFMoney(invoice.subtotal))
  if (invoice.discount > 0) {
    totalsLine('Discount', '- ' + formatPDFMoney(invoice.discount))
  }
  totalsLine('Taxable Value', formatPDFMoney(invoice.subtotal - invoice.discount), true)
  if (invoice.cgst > 0) totalsLine('CGST', formatPDFMoney(invoice.cgst))
  if (invoice.sgst > 0) totalsLine('SGST', formatPDFMoney(invoice.sgst))
  if (invoice.igst > 0) totalsLine('IGST', formatPDFMoney(invoice.igst))
  if (invoice.roundOff && Math.abs(invoice.roundOff) >= 0.005) {
    totalsLine('Round Off', (invoice.roundOff > 0 ? '+ ' : '- ') + formatPDFMoney(Math.abs(invoice.roundOff)))
  }

  /*
   * The grand total. Three presentations, one rule: it is always the largest
   * thing in this block, because §4 says money is the largest thing on screen
   * and a bill is the one document where that is not a style preference.
   *
   *   bar   — filled accent box, white figure. The original.
   *   panel — outlined box, accent figure on paper. Prints cheaply.
   *   plain — no box at all, just large and bold, as in Rahul's
   *           minimalist_slate reference where the total carries no
   *           decoration and is still the first thing the eye lands on.
   */
  y += 1
  const gtHeight = 11
  doc.setFont(THEME.font, 'bold')

  if (layout.totals === 'bar') {
    doc.setFillColor(accent.r, accent.g, accent.b)
    doc.rect(totalsX - 2, y - 4, totalsWidth + 2, gtHeight, 'F')
    doc.setFontSize(12)
    doc.setTextColor(white.r, white.g, white.b)
  } else if (layout.totals === 'panel' || layout.totals === 'ruled') {
    doc.setDrawColor(accent.r, accent.g, accent.b)
    doc.setLineWidth(0.5)
    doc.rect(totalsX - 2, y - 4, totalsWidth + 2, gtHeight)
    doc.setFontSize(12)
    doc.setTextColor(accent.r, accent.g, accent.b)
  } else {
    // plain — nothing drawn behind it, so it may be bigger.
    doc.setFontSize(14)
    doc.setTextColor(text.r, text.g, text.b)
  }

  doc.text('GRAND TOTAL', totalsX, y + 3)
  doc.text(formatPDFMoney(invoice.total), totalsValueX, y + 3, { align: 'right' })
  y += gtHeight + 2

  // Paid + Balance Due
  doc.setFont(THEME.font, 'normal')
  doc.setFontSize(9)
  doc.setTextColor(text.r, text.g, text.b)
  doc.text('Paid: ' + formatPDFMoney(invoice.paid) + ' (' + invoice.paymentMode.toUpperCase() + ')', totalsX, y)
  y += 5
  if (dueAmount > 0) {
    doc.setFont(THEME.font, 'bold')
    doc.setTextColor(THEME.due.r, THEME.due.g, THEME.due.b)
    doc.text('Balance Due: ' + formatPDFMoney(dueAmount), totalsX, y)
    doc.setTextColor(text.r, text.g, text.b)
    y += 5
  }

  /*
   * 📄 Phase 4 — the customer's TOTAL outstanding, when the shop asks for it.
   *
   * Placed directly under Balance Due, and in muted type rather than the red
   * used for this bill's due, because the two are different numbers and a
   * customer reading them stacked in the same colour would take the larger
   * one as what this bill demands. The label carries its own date for the
   * same reason — see partyBalanceLabel in invoice-document.
   *
   * Null unless the toggle is on, so nothing is checked here.
   */
  if (invoice.partyBalanceLabel) {
    doc.setFont(THEME.font, 'normal')
    doc.setFontSize(8)
    doc.setTextColor(textMuted.r, textMuted.g, textMuted.b)
    /*
     * Label left, figure right — the same shape as every line in the totals
     * block above, so the eye reads it as part of that column rather than as
     * a stray sentence.
     *
     * Two draw calls rather than one joined string, deliberately: the figure
     * carries the rupee sign, and jsPDF hex-encodes any string holding a
     * character outside Latin-1. Joined, the label became unreadable to
     * anything inspecting the file — including the guard that proves this
     * line is drawn at all.
     */
    doc.text(invoice.partyBalanceLabel, totalsX, y)
    doc.text(formatPDFMoney(invoice.partyBalance ?? 0), totalsValueX, y, { align: 'right' })
    doc.setTextColor(text.r, text.g, text.b)
    doc.setFontSize(9)
    y += 5
  }

  // ═══════════════════════════════════════════════════════════════════
  // 5. AMOUNT IN WORDS — tinted strip
  // ═══════════════════════════════════════════════════════════════════
  y += 4
  doc.setFillColor(accentSoft.r, accentSoft.g, accentSoft.b)
  doc.rect(margin, y - 3, tableWidth, 7, 'F')
  // DejaVu Sans does not ship an italic face — use normal to avoid jsPDF's
  // "Unable to look up font label for font 'DejaVuSans', 'italic'" warning.
  doc.setFont(THEME.font, 'normal')
  doc.setFontSize(8)
  doc.setTextColor(textMuted.r, textMuted.g, textMuted.b)
  const wordsStr = invoice.totalInWords
  const wordsLabel = 'Amount in words: ' + wordsStr
  const displayWords = wordsLabel.length > 100 ? wordsLabel.slice(0, 97) + '...' : wordsLabel
  doc.text(displayWords, margin + 2, y + 1)
  y += 8

  // ═══════════════════════════════════════════════════════════════════
  // 6. BOTTOM SECTION — UPI QR (left) + Signature (right)
  // ═══════════════════════════════════════════════════════════════════
  /*
   * 📄 Phase 3: terms and bank details, in the space between the totals and
   * the signature. Drawn before `bottomY` is fixed so a long set of terms
   * pushes the signature down rather than printing underneath it.
   */
  /*
   * 🐛 2026-08-16 — THE FOOTER RAN OFF THE BOTTOM OF THE PAGE.
   *
   * Found by the maximal-invoice guard, on FOUR of eight templates: a shop
   * with a long terms paragraph and bank details, on a bill whose items had
   * already filled the sheet, printed its terms at y = -2mm, -5mm, -9mm —
   * below the paper. Gone. No warning, and nothing on screen would have
   * shown it, because the preview draws one page.
   *
   * The item rows have paginated correctly since Phase 2; this block never
   * asked. Rahul's question — "does every design work with all the fields" —
   * is exactly the question that surfaced it.
   */
  const footerNeeded =
    (invoice.shop.terms ? 14 : 0)
    + (invoice.shop.bank?.accountNumber || invoice.shop.bank?.name ? 22 : 0)
  if (footerNeeded) {
    y = newPageIfNeeded(doc, y, footerNeeded, undefined, pageHeight)
  }

  if (invoice.shop.terms) {
    doc.setFont(THEME.font, 'bold')
    doc.setFontSize(metrics.smallPt)
    doc.setTextColor(text.r, text.g, text.b)
    doc.text('Terms & Conditions', margin, y)
    y += 4
    doc.setFont(THEME.font, 'normal')
    doc.setTextColor(textMuted.r, textMuted.g, textMuted.b)
    // Wrapped by jsPDF rather than truncated: terms a shop wrote and cannot
    // see in full on its own invoice are worse than none.
    const lines: string[] = doc.splitTextToSize(invoice.shop.terms, tableWidth * 0.62)
    for (const line of lines.slice(0, 6)) { doc.text(line, margin, y); y += 3.6 }
    y += 2
  }

  const bank = invoice.shop.bank
  const hasBank = !!(bank && (bank.accountNumber || bank.name))
  if (hasBank) {
    doc.setFont(THEME.font, 'bold')
    doc.setFontSize(metrics.smallPt)
    doc.setTextColor(text.r, text.g, text.b)
    doc.text('Bank Details', margin, y)
    y += 4
    doc.setFont(THEME.font, 'normal')
    doc.setTextColor(textMuted.r, textMuted.g, textMuted.b)
    const bankLines = [
      bank!.name && `Bank: ${bank!.name}${bank!.branch ? ', ' + bank!.branch : ''}`,
      bank!.accountName && `A/c name: ${bank!.accountName}`,
      bank!.accountNumber && `A/c no: ${bank!.accountNumber}`,
      bank!.ifsc && `IFSC: ${bank!.ifsc}`,
    ].filter(Boolean) as string[]
    for (const line of bankLines) { doc.text(line, margin, y); y += 3.6 }
    y += 2
  }

  /*
   * 🐛 The same overflow, one block further down.
   *
   * `pageHeight - 70` reserves the bottom 70mm for the QR and signature —
   * which is a sane reservation on A4 and a third of the SHEET on A5. On a
   * compact template, where more rows fit per page, `y` was already past it
   * and the signature block printed below the paper.
   *
   * Asking for the room first is the fix, and it is the same call the item
   * rows have made since Phase 2. The reservation is now proportional to the
   * sheet rather than a number chosen while looking at one size of paper.
   */
  const bottomBlockMm = Math.min(70, pageHeight * 0.24)
  /*
   * Ask for what the block CONSUMES, not for where it is anchored.
   *
   * 🐛 2026-08-16: this asked for the full `bottomBlockMm`, which is the
   * distance the block sits above the bottom edge. A five-item Royal bill
   * with terms and bank details had `y` inside that band, so it took a new
   * page — and printed a page of empty ruled rows followed by a nearly blank
   * second page. See bottomBlockNeedMm.
   */
  const bottomNeed = bottomBlockNeedMm({
    hasQr: !!(invoice.shop.paymentQrUrl || invoice.shop.upiId) && dueAmount > 0,
    wantsSignature: invoice.shop.showSignatureBox !== false || !!invoice.shop.signatureUrl,
    wantsReceiverSignature: !!invoice.shop.showReceiverSignature,
  })
  /*
   * Checked against the SHEET, not through `newPageIfNeeded`.
   *
   * That helper keeps a 25mm strip clear at the bottom, which is right for
   * flowing content and wrong here: this block is deliberately anchored INTO
   * that strip, at `pageHeight - bottomBlockMm`. Asking the helper meant a
   * block that plainly fits — anchored at 227mm on A4 and ending by 293 —
   * was told there was no room, and took a page of its own.
   *
   * 6mm is the frame line, so nothing is drawn over it.
   */
  if (y + 5 + bottomNeed > pageHeight - 6) {
    doc.addPage()
    y = 25
  }
  const bottomY = Math.max(y + 5, pageHeight - bottomBlockMm)

  /*
   * How the customer pays: a QR they SCAN, never a link they follow.
   *
   * 🗑️➕ 2026-08-15. The "view or pay this bill online" link that used to sit
   * near the footer is gone at Rahul's instruction. This block is now the
   * whole payment path, which makes it more important rather than less.
   *
   * The shop's UPLOADED QR wins when there is one. A shop that photographed
   * the code stuck to their counter means that code — it is the one their
   * regulars already recognise, and it settles into whichever account they
   * actually use rather than into whatever VPA this app was told about.
   *
   * The generated code carries the AMOUNT, which an uploaded one cannot; the
   * caption says so, so nobody is left wondering why they had to type it.
   */
  if (invoice.shop.paymentQrUrl && dueAmount > 0) {
    await drawImageQRBlock(doc, margin, bottomY, {
      imageUrl: invoice.shop.paymentQrUrl,
      amount: dueAmount,
      palette: { text, textMuted },
    })
  } else if (invoice.shop.upiId && dueAmount > 0) {
    await drawUPIQRBlock(doc, margin, bottomY, {
      upiId: invoice.shop.upiId,
      shopName: invoice.shop.name || 'My Shop',
      amount: dueAmount,
      note: invoice.invoiceNo || 'Invoice Payment',
      palette: { text, textMuted },
    })
  }

  /*
   * 📄 Phase 3: the signature.
   *
   * Three states, and the shop chooses: their own signature image, an empty
   * ruled box to sign by hand on the printed copy, or neither. A fourth block
   * — the RECEIVER's signature — is off by default and exists because a lot of
   * B2B suppliers need the paper copy as a delivery acknowledgement.
   */
  const sigX = pageWidth - margin - 50
  const wantsSignature = invoice.shop.showSignatureBox !== false || !!invoice.shop.signatureUrl
  if (wantsSignature) {
    doc.setFont(THEME.font, 'normal')
    doc.setFontSize(9)
    doc.setTextColor(textMuted.r, textMuted.g, textMuted.b)
    doc.text('For ' + (invoice.shop.name || 'My Shop'), sigX, bottomY)

    if (invoice.shop.signatureUrl) {
      /*
       * Fetched and embedded, exactly like the logo. Wrapped: a signature that
       * fails to load must leave a signable line, never abort the bill.
       */
      try {
        const res = await fetch(invoice.shop.signatureUrl)
        if (res.ok) {
          const blob = await res.blob()
          const dataUrl = await new Promise<string>((resolve, reject) => {
            const reader = new FileReader()
            reader.onload = () => resolve(reader.result as string)
            reader.onerror = () => reject(new Error('FileReader failed'))
            reader.readAsDataURL(blob)
          })
          const fmt = blob.type.includes('png') ? 'PNG' : blob.type.includes('webp') ? 'WEBP' : 'JPEG'
          doc.addImage(dataUrl, fmt, sigX, bottomY + 1, 40, 10)
        }
      } catch (err) {
        console.warn('[invoice-pdf] signature fetch failed, printing an empty line:', err)
      }
    }

    doc.setDrawColor(border.r, border.g, border.b)
    doc.line(sigX, bottomY + 12, sigX + 40, bottomY + 12)
    doc.text('Authorised Signatory', sigX, bottomY + 16)
  }

  if (invoice.shop.showReceiverSignature) {
    const rx = margin
    /*
     * 🐛 2026-08-16 — this printed 7.6mm BELOW an A5 sheet.
     *
     * It sits 42mm under the QR block when there is one, which fits on A4 and
     * does not on a half sheet. Found by holding A5 to the same
     * maximal-invoice standard as A4 — a shop taking delivery signatures, on
     * A5, with a payment QR, simply had no receiver line on its bill.
     *
     * Clamped to the last band of the page that can still hold it, rather
     * than pushed to a new page: a signature line alone on page three is not
     * a document anyone signs.
     */
    const wanted = bottomY + (invoice.shop.upiId && dueAmount > 0 ? 42 : 0)
    const ry = Math.min(wanted, pageHeight - 20)
    doc.setFont(THEME.font, 'normal')
    doc.setFontSize(9)
    doc.setTextColor(textMuted.r, textMuted.g, textMuted.b)
    doc.setDrawColor(border.r, border.g, border.b)
    doc.line(rx, ry + 12, rx + 40, ry + 12)
    doc.text("Receiver's Signature", rx, ry + 16)
  }

  /*
   * 📄 Phase 3: the thank-you, centred under the signature line.
   *
   * A first-class field rather than a line inside Terms because behavioural
   * work on invoice microcopy associates gratitude wording with materially
   * faster payment — it earns its own place.
   */
  if (invoice.shop.thankYou) {
    doc.setFont(THEME.font, 'normal')
    doc.setFontSize(metrics.smallPt)
    doc.setTextColor(textMuted.r, textMuted.g, textMuted.b)
    doc.text(invoice.shop.thankYou.slice(0, 90), pageWidth / 2, bottomY + 24, { align: 'center' })
  }

  // ═══════════════════════════════════════════════════════════════════
  // 7. FOOTER — thin brand rule, page number, "Made with EkBook"
  // ═══════════════════════════════════════════════════════════════════
  /*
   * 🗑️ 2026-08-15: the "View or pay this bill online" link block is GONE.
   *
   * It printed a real, tappable PDF link annotation. Rahul's call, and the
   * right one: a customer who receives a bill on WhatsApp and finds a link
   * asking them to pay has been trained by every scam in the country to
   * distrust exactly that. The QR block above is the payment path now — the
   * customer scans a code on a bill they already have, and no URL is
   * involved. See the note at the top of send-bill.ts.
   */

  /*
   * e-Invoice block — IRN and the signed QR from the portal.
   *
   * Rule 48(4) requires both on an invoice covered by e-invoicing. Without
   * them the document counts as NON-ISSUANCE: penalties under Section 122, and
   * the buyer's input tax credit on it is at risk. The app stored both on the
   * transaction and printed neither, so every PDF it produced for an
   * e-invoicing shop was legally not an invoice.
   *
   * Drawn ABOVE the footer and near the totals, where a tax officer looks.
   *
   * The QR encodes the SIGNED string exactly as the portal returned it — that
   * string is the government's own attestation, and re-encoding anything else
   * would produce a QR that looks correct and fails verification. Generated
   * locally, never through an image service: it is the shop's invoice data.
   *
   * Skipped entirely for the great majority of shops, who are under the ₹5
   * crore threshold and correctly have no IRN.
   */
  if (invoice.irn) {
    const eY = pageHeight - 60
    try {
      if (invoice.signedQR) {
        const QRCode = (await import('qrcode')).default
        const qrDataUrl = await QRCode.toDataURL(invoice.signedQR, { margin: 0, width: 256 })
        doc.addImage(qrDataUrl, 'PNG', margin, eY, 22, 22)
      }
      doc.setFont(THEME.font, 'bold')
      doc.setFontSize(8)
      doc.setTextColor(textMuted.r, textMuted.g, textMuted.b)
      doc.text('e-Invoice', margin + 26, eY + 5)
      doc.setFont(THEME.font, 'normal')
      doc.setFontSize(6.5)
      // The IRN is 64 characters — split so it does not run off the page.
      const irnStr = String(invoice.irn)
      doc.text('IRN: ' + irnStr.slice(0, 32), margin + 26, eY + 10)
      doc.text(irnStr.slice(32), margin + 26, eY + 14)
    } catch {
      /*
       * A QR that fails to draw must not take the invoice with it. The IRN
       * text alone still identifies the e-invoice, and a bill the shopkeeper
       * can hand over beats an exception at the counter.
       */
    }
  }

  drawFooter(doc, 1, 1, { accent, textMuted, text }, paper)

  return doc.output('blob')
}
