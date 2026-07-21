"use strict";
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
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.generateInvoicePDF = generateInvoicePDF;
const theme_1 = require("./pdf/theme");
const primitives_1 = require("./pdf/primitives");
const amount_to_words_1 = require("./amount-to-words");
function formatDate(date) {
    const d = typeof date === 'string' ? new Date(date) : date;
    if (isNaN(d.getTime()))
        return String(date);
    return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}
async function generateInvoicePDF(txn, setting) {
    var _a, _b, _c, _d, _e, _f;
    const jsPDFMod = await Promise.resolve().then(() => __importStar(require('jspdf')));
    const doc = new jsPDFMod.jsPDF({ unit: 'mm', format: 'a4' });
    await (0, theme_1.registerUnicodeFont)(doc);
    const { margin, pageWidth, pageHeight, brand, brandLight, text, textMuted, border, zebra, cardBg, white, paid, partial, due } = theme_1.THEME;
    const dateStr = formatDate(txn.date);
    const dueAmount = txn.totalAmount - txn.paidAmount;
    const status = dueAmount <= 0 ? 'paid' : txn.paidAmount > 0 ? 'partial' : 'due';
    const statusLabels = { paid: 'PAID', partial: 'PARTIAL', due: 'DUE' };
    const statusColors = { paid, partial, due };
    const hasPartyGstin = !!(((_a = txn.party) === null || _a === void 0 ? void 0 : _a.gstin) && txn.party.gstin.trim());
    // ═══════════════════════════════════════════════════════════════════
    // 1. BRAND BAND — 32 mm full-width, shop info left, INVOICE + meta + status right
    // ═══════════════════════════════════════════════════════════════════
    const bandHeight = 32;
    doc.setFillColor(brand.r, brand.g, brand.b);
    doc.rect(0, 0, pageWidth, bandHeight, 'F');
    // Left: shop name (white, bold, 16pt) — 20pt per spec is too tall for typical Indian
    // shop names (often 20+ chars); 16pt keeps the band at one line.
    doc.setFont(theme_1.THEME.font, 'bold');
    doc.setFontSize(16);
    doc.setTextColor(white.r, white.g, white.b);
    doc.text(setting.shopName || 'My Shop', margin, 13);
    // Left: shop details (white, 8pt) — phone | GSTIN | address (one or two lines)
    doc.setFont(theme_1.THEME.font, 'normal');
    doc.setFontSize(8);
    let detailY = 18;
    const shopDetails = [];
    if (setting.phone)
        shopDetails.push(setting.phone);
    if (setting.gstin)
        shopDetails.push('GSTIN: ' + setting.gstin);
    if (shopDetails.length > 0) {
        doc.text(shopDetails.join('  |  '), margin, detailY);
        detailY += 4;
    }
    if (setting.address) {
        const truncated = setting.address.length > 70 ? setting.address.slice(0, 67) + '...' : setting.address;
        doc.text(truncated, margin, detailY);
    }
    // Right: INVOICE word (16 pt), invoice no + date beneath.
    doc.setFont(theme_1.THEME.font, 'bold');
    doc.setFontSize(16);
    doc.setTextColor(white.r, white.g, white.b);
    doc.text('INVOICE', pageWidth - margin, 12, { align: 'right' });
    doc.setFont(theme_1.THEME.font, 'normal');
    doc.setFontSize(9);
    doc.text(`${txn.invoiceNo || ''}  |  ${dateStr}`, pageWidth - margin, 18, { align: 'right' });
    // Status pill — inside the band, below the invoice meta, right-aligned.
    const statusColor = statusColors[status];
    const statusLabel = statusLabels[status];
    const pillW = 24;
    const pillH = 7;
    const pillX = pageWidth - margin - pillW;
    const pillY = 21;
    doc.setFillColor(statusColor.r, statusColor.g, statusColor.b);
    doc.roundedRect(pillX, pillY, pillW, pillH, 1.5, 1.5, 'F');
    doc.setFont(theme_1.THEME.font, 'bold');
    doc.setFontSize(8);
    doc.setTextColor(white.r, white.g, white.b);
    doc.text(statusLabel, pillX + pillW / 2, pillY + 4.8, { align: 'center' });
    doc.setTextColor(text.r, text.g, text.b);
    let y = bandHeight + 8;
    // ═══════════════════════════════════════════════════════════════════
    // 2. BILL TO CARD + (optional) PLACE OF SUPPLY CARD
    //    Two-card row when party has a GSTIN; single full-width card otherwise.
    //    The previous "INVOICE DETAILS" right column (Invoice No / Date / Payment) is
    //    GONE — it duplicated the brand band. Payment mode moves into the Place of
    //    Supply card, which is the auditor's design.
    // ═══════════════════════════════════════════════════════════════════
    const cardGap = 6;
    const leftCardW = hasPartyGstin ? 95 : pageWidth - 2 * margin;
    const rightCardW = pageWidth - 2 * margin - leftCardW - cardGap;
    const rightCardX = margin + leftCardW + cardGap;
    // Estimate left card height from party fields present
    const leftLines = [];
    if ((_b = txn.party) === null || _b === void 0 ? void 0 : _b.phone)
        leftLines.push(txn.party.phone);
    if ((_c = txn.party) === null || _c === void 0 ? void 0 : _c.gstin)
        leftLines.push('GSTIN: ' + txn.party.gstin);
    if ((_d = txn.party) === null || _d === void 0 ? void 0 : _d.address) {
        // split into 2 lines max at ~leftCardW-8mm
        const addrLines = doc.splitTextToSize(txn.party.address, leftCardW - 8);
        leftLines.push(...addrLines.slice(0, 2));
    }
    // Card body: 1 (name) + leftLines.length + label row + padding
    const leftCardH = 16 + leftLines.length * 4 + 4;
    // Right card body: label + 2 fields + padding
    const rightCardH = hasPartyGstin ? 24 : 0;
    // Draw left card background (light card with rounded rect + thin border per spec)
    doc.setFillColor(cardBg.r, cardBg.g, cardBg.b);
    doc.setDrawColor(border.r, border.g, border.b);
    doc.setLineWidth(0.2);
    doc.roundedRect(margin, y, leftCardW, leftCardH, 2, 2, 'FD');
    // BILL TO label (7pt uppercase letter-spaced grey)
    doc.setFont(theme_1.THEME.font, 'bold');
    doc.setFontSize(7);
    doc.setTextColor(textMuted.r, textMuted.g, textMuted.b);
    doc.text('BILL TO', margin + 3, y + 5);
    // Party name (11pt bold)
    doc.setFont(theme_1.THEME.font, 'bold');
    doc.setFontSize(11);
    doc.setTextColor(text.r, text.g, text.b);
    const partyName = ((_e = txn.party) === null || _e === void 0 ? void 0 : _e.name) || 'Walk-in Customer';
    const nameLines = doc.splitTextToSize(partyName, leftCardW - 6);
    doc.text(nameLines.slice(0, 2), margin + 3, y + 11);
    // Party details (8pt normal muted)
    doc.setFont(theme_1.THEME.font, 'normal');
    doc.setFontSize(8);
    doc.setTextColor(textMuted.r, textMuted.g, textMuted.b);
    let partyDetailY = y + 16;
    for (const line of leftLines) {
        doc.text(line, margin + 3, partyDetailY);
        partyDetailY += 4;
    }
    // Right card: Place of Supply + Payment Mode (ONLY when party has GSTIN)
    if (hasPartyGstin && rightCardW > 30) {
        doc.setFillColor(cardBg.r, cardBg.g, cardBg.b);
        doc.setDrawColor(border.r, border.g, border.b);
        doc.setLineWidth(0.2);
        doc.roundedRect(rightCardX, y, rightCardW, rightCardH, 2, 2, 'FD');
        doc.setFont(theme_1.THEME.font, 'bold');
        doc.setFontSize(7);
        doc.setTextColor(textMuted.r, textMuted.g, textMuted.b);
        doc.text('SUPPLY & PAYMENT', rightCardX + 3, y + 5);
        doc.setFont(theme_1.THEME.font, 'normal');
        doc.setFontSize(8);
        doc.setTextColor(text.r, text.g, text.b);
        const placeOfSupply = ((_f = txn.party) === null || _f === void 0 ? void 0 : _f.state)
            ? `${txn.party.state}${txn.isInterState ? ' (Inter-state)' : ' (Intra-state)'}`
            : '—';
        doc.text('Place of Supply: ' + placeOfSupply, rightCardX + 3, y + 11);
        doc.text('Payment Mode: ' + txn.paymentMode.toUpperCase(), rightCardX + 3, y + 16);
        doc.setTextColor(text.r, text.g, text.b);
    }
    y += Math.max(leftCardH, rightCardH) + 6;
    // ═══════════════════════════════════════════════════════════════════
    // 3. ITEM TABLE — HSN included, zebra striping, brand-colour header
    // ═══════════════════════════════════════════════════════════════════
    const tableWidth = pageWidth - 2 * margin;
    const colStart = margin;
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
    ];
    const colEnd = pageWidth - margin - 1;
    const drawTableHeader = (headerY) => {
        // Header row: brand colour at 12% opacity (spec) — emulate by drawing the
        // brand rect then overlaying a 88% white rect.
        doc.setFillColor(brand.r, brand.g, brand.b);
        doc.rect(colStart, headerY, tableWidth, 8, 'F');
        doc.setFillColor(255, 255, 255);
        doc.setGState(doc.GState({ opacity: 0.88 }));
        doc.rect(colStart, headerY, tableWidth, 8, 'F');
        doc.setGState(doc.GState({ opacity: 1 }));
        doc.setFont(theme_1.THEME.font, 'bold');
        doc.setFontSize(8);
        doc.setTextColor(brand.r, brand.g, brand.b);
        cols.forEach(c => {
            if (c.align === 'right') {
                doc.text(c.name, c.x + c.w - 1, headerY + 5.5, { align: 'right' });
            }
            else {
                doc.text(c.name, c.x, headerY + 5.5);
            }
        });
        doc.setTextColor(text.r, text.g, text.b);
    };
    const headerHeight = 8;
    drawTableHeader(y);
    y += headerHeight;
    // Item rows
    doc.setFont(theme_1.THEME.font, 'normal');
    doc.setFontSize(9);
    const rowHeight = 7;
    txn.items.forEach((item, i) => {
        y = (0, primitives_1.newPageIfNeeded)(doc, y, rowHeight + 2, () => {
            drawTableHeader(y);
            doc.setFont(theme_1.THEME.font, 'normal');
            doc.setFontSize(9);
            y += headerHeight;
        });
        // Zebra stripe
        if (i % 2 === 1) {
            doc.setFillColor(zebra.r, zebra.g, zebra.b);
            doc.rect(colStart, y, tableWidth, rowHeight, 'F');
        }
        const name = item.productName.length > 32 ? item.productName.slice(0, 29) + '...' : item.productName;
        doc.setTextColor(text.r, text.g, text.b);
        doc.text(String(i + 1), cols[0].x, y + 5);
        doc.text(name, cols[1].x, y + 5);
        doc.setFontSize(7);
        doc.text(item.hsn || '-', cols[2].x, y + 5);
        doc.setFontSize(9);
        doc.text(`${item.quantity} ${item.unit || 'pcs'}`, cols[3].x + cols[3].w - 1, y + 5, { align: 'right' });
        doc.text(item.unitPrice.toFixed(2), cols[4].x + cols[4].w - 1, y + 5, { align: 'right' });
        doc.text(item.gstRate + '%', cols[5].x + cols[5].w - 1, y + 5, { align: 'right' });
        doc.text((0, theme_1.formatPDFMoney)(item.total), colEnd, y + 5, { align: 'right' });
        y += rowHeight;
    });
    // Table bottom border
    doc.setDrawColor(border.r, border.g, border.b);
    doc.setLineWidth(0.3);
    doc.line(colStart, y, colStart + tableWidth, y);
    y += 6;
    // ═══════════════════════════════════════════════════════════════════
    // 4. TOTALS — right-aligned, clean
    // ═══════════════════════════════════════════════════════════════════
    const totalsWidth = 70;
    const totalsX = pageWidth - margin - totalsWidth;
    const totalsValueX = pageWidth - margin - 1;
    doc.setFontSize(9);
    doc.setFont(theme_1.THEME.font, 'normal');
    doc.setTextColor(text.r, text.g, text.b);
    const totalsLine = (label, value, bold) => {
        if (bold)
            doc.setFont(theme_1.THEME.font, 'bold');
        doc.text(label, totalsX, y);
        doc.text(value, totalsValueX, y, { align: 'right' });
        if (bold)
            doc.setFont(theme_1.THEME.font, 'normal');
        y += 5;
    };
    totalsLine('Subtotal', (0, theme_1.formatPDFMoney)(txn.subtotal));
    if (txn.discountAmount > 0) {
        totalsLine('Discount', '- ' + (0, theme_1.formatPDFMoney)(txn.discountAmount));
    }
    totalsLine('Taxable Value', (0, theme_1.formatPDFMoney)(txn.subtotal - txn.discountAmount), true);
    if (txn.cgst > 0)
        totalsLine('CGST', (0, theme_1.formatPDFMoney)(txn.cgst));
    if (txn.sgst > 0)
        totalsLine('SGST', (0, theme_1.formatPDFMoney)(txn.sgst));
    if (txn.igst > 0)
        totalsLine('IGST', (0, theme_1.formatPDFMoney)(txn.igst));
    if (txn.roundOff && Math.abs(txn.roundOff) >= 0.005) {
        totalsLine('Round Off', (txn.roundOff > 0 ? '+ ' : '- ') + (0, theme_1.formatPDFMoney)(Math.abs(txn.roundOff)));
    }
    // Grand total — filled brand box (13pt white bold per spec; using 12pt for fit)
    y += 1;
    const gtHeight = 11;
    doc.setFillColor(brand.r, brand.g, brand.b);
    doc.rect(totalsX - 2, y - 4, totalsWidth + 2, gtHeight, 'F');
    doc.setFont(theme_1.THEME.font, 'bold');
    doc.setFontSize(12);
    doc.setTextColor(white.r, white.g, white.b);
    doc.text('GRAND TOTAL', totalsX, y + 3);
    doc.text((0, theme_1.formatPDFMoney)(txn.totalAmount), totalsValueX, y + 3, { align: 'right' });
    y += gtHeight + 2;
    // Paid + Balance Due
    doc.setFont(theme_1.THEME.font, 'normal');
    doc.setFontSize(9);
    doc.setTextColor(text.r, text.g, text.b);
    doc.text('Paid: ' + (0, theme_1.formatPDFMoney)(txn.paidAmount) + ' (' + txn.paymentMode.toUpperCase() + ')', totalsX, y);
    y += 5;
    if (dueAmount > 0) {
        doc.setFont(theme_1.THEME.font, 'bold');
        doc.setTextColor(theme_1.THEME.due.r, theme_1.THEME.due.g, theme_1.THEME.due.b);
        doc.text('Balance Due: ' + (0, theme_1.formatPDFMoney)(dueAmount), totalsX, y);
        doc.setTextColor(text.r, text.g, text.b);
        y += 5;
    }
    // ═══════════════════════════════════════════════════════════════════
    // 5. AMOUNT IN WORDS — tinted strip
    // ═══════════════════════════════════════════════════════════════════
    y += 4;
    doc.setFillColor(brandLight.r, brandLight.g, brandLight.b);
    doc.rect(margin, y - 3, tableWidth, 7, 'F');
    // DejaVu Sans does not ship an italic face — use normal to avoid jsPDF's
    // "Unable to look up font label for font 'DejaVuSans', 'italic'" warning.
    doc.setFont(theme_1.THEME.font, 'normal');
    doc.setFontSize(8);
    doc.setTextColor(textMuted.r, textMuted.g, textMuted.b);
    const wordsStr = (0, amount_to_words_1.amountToWords)(txn.totalAmount);
    const wordsLabel = 'Amount in words: ' + wordsStr;
    const displayWords = wordsLabel.length > 100 ? wordsLabel.slice(0, 97) + '...' : wordsLabel;
    doc.text(displayWords, margin + 2, y + 1);
    y += 8;
    // ═══════════════════════════════════════════════════════════════════
    // 6. BOTTOM SECTION — UPI QR (left) + Signature (right)
    // ═══════════════════════════════════════════════════════════════════
    const bottomY = Math.max(y + 5, pageHeight - 70);
    // UPI QR (left side, only when upiId exists and balance > 0)
    if (setting.upiId && dueAmount > 0) {
        await (0, primitives_1.drawUPIQRBlock)(doc, margin, bottomY, {
            upiId: setting.upiId,
            shopName: setting.shopName || 'My Shop',
            amount: dueAmount,
            note: txn.invoiceNo || 'Invoice Payment',
        });
    }
    // Signature (right side)
    const sigX = pageWidth - margin - 50;
    doc.setFont(theme_1.THEME.font, 'normal');
    doc.setFontSize(9);
    doc.setTextColor(textMuted.r, textMuted.g, textMuted.b);
    doc.text('For ' + (setting.shopName || 'My Shop'), sigX, bottomY);
    doc.setDrawColor(border.r, border.g, border.b);
    doc.line(sigX, bottomY + 12, sigX + 40, bottomY + 12);
    doc.text('Authorised Signatory', sigX, bottomY + 16);
    // ═══════════════════════════════════════════════════════════════════
    // 7. FOOTER — thin brand rule, page number, "Made with EkBook"
    // ═══════════════════════════════════════════════════════════════════
    (0, primitives_1.drawFooter)(doc, 1, 1);
    return doc.output('blob');
}
