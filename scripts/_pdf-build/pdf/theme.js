"use strict";
/**
 * PDF Theme — shared colors, spacing, and font registration for all PDF generators.
 *
 * V26 Phase 8 PDF Redesign: Embeds DejaVu Sans (supports rupee glyph U+20B9)
 * so all PDFs render the rupee sign instead of "Rs.". DejaVu Sans also covers
 * Devanagari (Hindi), Gujarati, Tamil, etc. — so shop names in Indian scripts
 * render correctly instead of showing boxes.
 *
 * Font files are in public/fonts/ and are lazy-fetched only when a PDF is
 * generated (no effect on app load). The registration is cached so subsequent
 * PDFs don't re-fetch.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.THEME = void 0;
exports.registerUnicodeFont = registerUnicodeFont;
exports.formatPDFMoney = formatPDFMoney;
const FONT_REGULAR_URL = '/fonts/DejaVuSans-Regular.ttf';
const FONT_BOLD_URL = '/fonts/DejaVuSans-Bold.ttf';
const FONT_NAME = 'DejaVuSans';
let fontRegistered = false;
/**
 * Register DejaVu Sans (regular + bold) with a jsPDF document.
 * Cached — only fetches the font files once per session.
 */
async function registerUnicodeFont(doc) {
    if (fontRegistered) {
        doc.setFont(FONT_NAME, 'normal');
        return;
    }
    try {
        const [regRes, boldRes] = await Promise.all([
            fetch(FONT_REGULAR_URL),
            fetch(FONT_BOLD_URL),
        ]);
        if (!regRes.ok || !boldRes.ok) {
            console.warn('[pdf] Font fetch failed, falling back to Helvetica');
            return;
        }
        const regBuf = await regRes.arrayBuffer();
        const boldBuf = await boldRes.arrayBuffer();
        const regBase64 = arrayBufferToBase64(regBuf);
        const boldBase64 = arrayBufferToBase64(boldBuf);
        doc.addFileToVFS(`${FONT_NAME}-Regular.ttf`, regBase64);
        doc.addFont(`${FONT_NAME}-Regular.ttf`, FONT_NAME, 'normal');
        doc.addFileToVFS(`${FONT_NAME}-Bold.ttf`, boldBase64);
        doc.addFont(`${FONT_NAME}-Bold.ttf`, FONT_NAME, 'bold');
        fontRegistered = true;
        doc.setFont(FONT_NAME, 'normal');
        doc.setLanguage('en-IN');
    }
    catch (err) {
        console.warn('[pdf] Font registration failed, falling back to Helvetica:', err);
    }
}
function arrayBufferToBase64(buf) {
    const bytes = new Uint8Array(buf);
    let binary = '';
    for (let i = 0; i < bytes.byteLength; i++) {
        binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
}
// ─── Theme constants ──────────────────────────────────────────────────────
exports.THEME = {
    font: FONT_NAME,
    brand: { r: 217, g: 110, b: 27 },
    brandLight: { r: 254, g: 243, b: 230 },
    paid: { r: 5, g: 150, b: 105 },
    partial: { r: 217, g: 119, b: 6 },
    due: { r: 220, g: 38, b: 38 },
    text: { r: 26, g: 26, b: 26 },
    textMuted: { r: 85, g: 85, b: 85 },
    border: { r: 200, g: 200, b: 200 },
    zebra: { r: 251, g: 252, b: 253 },
    cardBg: { r: 248, g: 250, b: 252 },
    white: { r: 255, g: 255, b: 255 },
    margin: 15,
    pageWidth: 210,
    pageHeight: 297,
};
/**
 * Format money with rupee symbol for PDFs.
 */
function formatPDFMoney(amount) {
    return '\u20B9' + amount.toFixed(2);
}
