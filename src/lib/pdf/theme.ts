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

const FONT_REGULAR_URL = '/fonts/DejaVuSans-Regular.ttf'
const FONT_BOLD_URL = '/fonts/DejaVuSans-Bold.ttf'
const FONT_NAME = 'DejaVuSans'

/**
 * 🔒 RUPEE-GLYPH FIX (2026-07-22, Rahul-reported: "₹ isn't visible in the PDF").
 *
 * This used to be `let fontRegistered = false`, flipped to true after the first
 * successful registration, with an early `return` on every later call. But
 * `addFileToVFS`/`addFont` register the font on the jsPDF DOCUMENT INSTANCE —
 * they are not global. So the SECOND and every subsequent PDF in a session hit
 * the early return, called `doc.setFont('DejaVuSans')` on a document that had
 * never been given the font, and jsPDF logged
 *
 *     Unable to look up font label for font 'DejaVuSans', 'normal'
 *
 * (dozens of these in Rahul's console) before silently falling back to
 * Helvetica — which has no U+20B9, so every ₹ rendered as a missing glyph.
 *
 * Now: cache the DOWNLOADED BYTES (the expensive part, ~1.4MB) and re-register
 * them on every document (cheap, and required for correctness).
 */
let fontDataPromise: Promise<{ regular: string; bold: string } | null> | null = null

async function loadFontData(): Promise<{ regular: string; bold: string } | null> {
  if (!fontDataPromise) {
    fontDataPromise = (async () => {
      const [regRes, boldRes] = await Promise.all([
        fetch(FONT_REGULAR_URL),
        fetch(FONT_BOLD_URL),
      ])
      if (!regRes.ok || !boldRes.ok) return null
      const [regBuf, boldBuf] = await Promise.all([regRes.arrayBuffer(), boldRes.arrayBuffer()])
      return {
        regular: arrayBufferToBase64(regBuf),
        bold: arrayBufferToBase64(boldBuf),
      }
    })().catch(() => null)
    // A failed fetch must not poison the cache — the next PDF should retry
    // rather than being permanently stuck on Helvetica.
    fontDataPromise = fontDataPromise.then((v) => {
      if (v === null) fontDataPromise = null
      return v
    })
  }
  return fontDataPromise
}

/**
 * Register DejaVu Sans (regular + bold) with a jsPDF document.
 * Cached — only fetches the font files once per session.
 */
export async function registerUnicodeFont(doc: any): Promise<void> {
  try {
    const data = await loadFontData()
    if (!data) {
      console.warn('[pdf] Font fetch failed, falling back to Helvetica')
      return
    }

    // Registered on EVERY document — see the note on fontDataPromise above.
    doc.addFileToVFS(`${FONT_NAME}-Regular.ttf`, data.regular)
    doc.addFont(`${FONT_NAME}-Regular.ttf`, FONT_NAME, 'normal')
    doc.addFileToVFS(`${FONT_NAME}-Bold.ttf`, data.bold)
    doc.addFont(`${FONT_NAME}-Bold.ttf`, FONT_NAME, 'bold')

    doc.setFont(FONT_NAME, 'normal')
    doc.setLanguage('en-IN')
  } catch (err) {
    console.warn('[pdf] Font registration failed, falling back to Helvetica:', err)
  }
}

/**
 * True when `doc` actually has the Unicode font available. Callers use this to
 * decide between "₹" and the "Rs." fallback — printing ₹ with Helvetica
 * produces a missing-glyph box, which is worse than the ASCII spelling.
 */
export function hasUnicodeFont(doc: any): boolean {
  try {
    return Boolean(doc?.getFontList?.()?.[FONT_NAME])
  } catch {
    return false
  }
}

function arrayBufferToBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf)
  let binary = ''
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i])
  }
  return btoa(binary)
}

// ─── Theme constants ──────────────────────────────────────────────────────

export const THEME = {
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
}

/**
 * Format money with rupee symbol for PDFs.
 */
export function formatPDFMoney(amount: number): string {
  return RUPEE_SIGN + formatIndianDigits(amount)
}

/**
 * Indian digit grouping: 1551.5 \u2192 "1,551.50", 1234567 \u2192 "12,34,567.00".
 * The PDFs previously printed a bare `toFixed(2)`, so a lakh-rupee invoice read
 * "155150.00" \u2014 legible to a computer, not to a shopkeeper checking a bill.
 * Intl is not used here: jsPDF text needs a plain ASCII-grouped string, and
 * Intl's output varies with the runtime locale.
 */
export function formatIndianDigits(amount: number): string {
  const negative = amount < 0
  const fixed = Math.abs(amount).toFixed(2)
  const [whole, decimals] = fixed.split('.')
  // Last three digits stay together; everything before is grouped in twos.
  const last3 = whole.slice(-3)
  const rest = whole.slice(0, -3)
  const grouped = rest
    ? rest.replace(/\B(?=(\d{2})+(?!\d))/g, ',') + ',' + last3
    : last3
  return `${negative ? '-' : ''}${grouped}.${decimals}`
}

export const RUPEE_SIGN = '\u20B9'
