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
import { paletteFor } from './pdf/palette'
import { getInvoiceTemplate, metricsFor } from './invoice-templates'
import { getPaperSize } from './invoice-paper'
import { formatCustomValue } from './custom-fields'
import type { InvoiceDocument } from './invoice-document'
import { drawFooter, drawUPIQRBlock, drawImageQRBlock, newPageIfNeeded } from './pdf/primitives'


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
  const template = getInvoiceTemplate(opts.templateId)
  const metrics = metricsFor(template)
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
  const statusLabels = { paid: 'PAID', partial: 'PARTIAL', due: 'DUE' }
  const statusColors = { paid, partial, due }
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
  const filledHeader = template.header === 'band'
  const headText = filledHeader ? onBand : text
  const headMuted = filledHeader ? onBandMuted : textMuted

  if (filledHeader) {
    doc.setFillColor(band.r, band.g, band.b)
    doc.rect(0, 0, pageWidth, bandHeight, 'F')
  } else if (template.header === 'rule') {
    // A thick accent rule under the identity block, no fill.
    doc.setDrawColor(accent.r, accent.g, accent.b)
    doc.setLineWidth(1.2)
    doc.line(margin, bandHeight - 4, pageWidth - margin, bandHeight - 4)
  } else {
    // 'frame' — a hairline box around the whole page, the bill-book look.
    doc.setDrawColor(accent.r, accent.g, accent.b)
    doc.setLineWidth(0.6)
    doc.rect(margin - 5, 6, pageWidth - (margin - 5) * 2, pageHeight - 12)
    doc.setLineWidth(0.3)
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
  if (template.titleFace === 'serif') doc.setFont('times', 'bold')
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
  doc.setFontSize(16)
  doc.setTextColor(headText.r, headText.g, headText.b)
  doc.text('INVOICE', pageWidth - margin, 12, { align: 'right' })
  doc.setFont(THEME.font, 'normal')
  doc.setFontSize(9)
  doc.setTextColor(headMuted.r, headMuted.g, headMuted.b)
  doc.text(`${invoice.invoiceNo || ''}  |  ${dateStr}`, pageWidth - margin, 18, { align: 'right' })

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

  // Status pill — inside the band, below the invoice meta, right-aligned.
  const statusColor = statusColors[status]
  const statusLabel = statusLabels[status]
  const pillW = 24
  const pillH = 7
  const pillX = pageWidth - margin - pillW
  const pillY = 21
  doc.setFillColor(statusColor.r, statusColor.g, statusColor.b)
  doc.roundedRect(pillX, pillY, pillW, pillH, 1.5, 1.5, 'F')
  doc.setFont(THEME.font, 'bold')
  doc.setFontSize(8)
  doc.setTextColor(white.r, white.g, white.b)
  doc.text(statusLabel, pillX + pillW / 2, pillY + 4.8, { align: 'center' })

  doc.setTextColor(text.r, text.g, text.b)
  let y = bandHeight + 8

  // ═══════════════════════════════════════════════════════════════════
  // 2. BILL TO CARD + (optional) PLACE OF SUPPLY CARD
  //    Two-card row when party has a GSTIN; single full-width card otherwise.
  //    The previous "INVOICE DETAILS" right column (Invoice No / Date / Payment) is
  //    GONE — it duplicated the brand band. Payment mode moves into the Place of
  //    Supply card, which is the auditor's design.
  // ═══════════════════════════════════════════════════════════════════
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

  // ═══════════════════════════════════════════════════════════════════
  // 3. ITEM TABLE — HSN included, zebra striping, brand-colour header
  // ═══════════════════════════════════════════════════════════════════
  const tableWidth = pageWidth - 2 * margin
  const colStart = margin
  // Column proportions (must sum to tableWidth = 180)
  // # | Item | HSN | Qty | Rate | GST% | Amount
  // 8 | 58  | 20  | 18  | 24   | 18   | 34
  const cols = [
    { name: '#', x: colStart + 1, w: 8, align: 'left' },
    { name: 'ITEM', x: colStart + 10, w: 58, align: 'left' },
    { name: 'HSN', x: colStart + 68, w: 20, align: 'left' },
    { name: 'QTY', x: colStart + 88, w: 18, align: 'right' },
    { name: 'RATE', x: colStart + 106, w: 24, align: 'right' },
    { name: 'GST%', x: colStart + 130, w: 18, align: 'right' },
    { name: 'AMOUNT', x: colStart + 168, w: 0, align: 'right' },
  ]
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
  const hasSubLine = (it: (typeof invoice.items)[number]) =>
    !!(it.description || it.altQty || it.customCols.length)

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
    if (template.table === 'zebra' && i % 2 === 1) {
      doc.setFillColor(zebra.r, zebra.g, zebra.b)
      doc.rect(colStart, y, tableWidth, rowHeight, 'F')
    } else if (template.table === 'rows') {
      doc.setDrawColor(border.r, border.g, border.b)
      doc.setLineWidth(0.1)
      doc.line(colStart, y + rowHeight, colStart + tableWidth, y + rowHeight)
    } else if (template.table === 'grid') {
      doc.setDrawColor(border.r, border.g, border.b)
      doc.setLineWidth(0.1)
      doc.rect(colStart, y, tableWidth, rowHeight)
      // Vertical rules between columns. The first column edge is the table
      // edge already drawn, so start from the second.
      cols.slice(1).forEach(c => doc.line(c.x - 1, y, c.x - 1, y + rowHeight))
    }

    const name = item.name.length > 32 ? item.name.slice(0, 29) + '...' : item.name
    // `baseline` rather than a fixed 5mm: at compact's 5.4mm row a 5mm drop
    // would put the text on the row's bottom edge.
    const tY = y + metrics.baseline
    doc.setTextColor(text.r, text.g, text.b)
    doc.text(String(i + 1), cols[0].x, tY)
    doc.text(name, cols[1].x, tY)
    doc.setFontSize(metrics.smallPt)
    doc.text(item.hsn || '-', cols[2].x, tY)
    doc.setFontSize(metrics.bodyPt)
    doc.text(`${item.qtyValue} ${item.unit || 'pcs'}`, cols[3].x + cols[3].w - 1, tY, { align: 'right' })
    doc.text(item.rate.toFixed(2), cols[4].x + cols[4].w - 1, tY, { align: 'right' })
    doc.text(item.gstRate + '%', cols[5].x + cols[5].w - 1, tY, { align: 'right' })
    doc.text(formatPDFMoney(item.total), colEnd, tY, { align: 'right' })

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
      const extraCols = item.customCols.map(v => `${v.label}: ${formatCustomValue(v)}`).join("  ·  ")
      const sub = [item.description, extraCols].filter(Boolean).join("  ·  ")
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

  const totalsLine = (label: string, value: string, bold?: boolean) => {
    if (bold) doc.setFont(THEME.font, 'bold')
    doc.text(label, totalsX, y)
    doc.text(value, totalsValueX, y, { align: 'right' })
    if (bold) doc.setFont(THEME.font, 'normal')
    y += 5
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

  if (template.totals === 'bar') {
    doc.setFillColor(accent.r, accent.g, accent.b)
    doc.rect(totalsX - 2, y - 4, totalsWidth + 2, gtHeight, 'F')
    doc.setFontSize(12)
    doc.setTextColor(white.r, white.g, white.b)
  } else if (template.totals === 'panel') {
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

  const bottomY = Math.max(y + 5, pageHeight - 70)

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
    const ry = bottomY + (invoice.shop.upiId && dueAmount > 0 ? 42 : 0)
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
