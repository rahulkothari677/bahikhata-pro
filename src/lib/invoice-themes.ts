/**
 * Invoice themes — one look, applied to every surface a bill reaches.
 *
 * 📄 Phase 5 of docs/DOCUMENT-ENGINE-PLAN.md. Rahul asked for multiple invoice
 * designs, as myBillBook (8) and Vyapar (12) have.
 *
 * WHY THIS IS A REGISTRY AND NOT TWELVE LAYOUT FILES. A bill now reaches three
 * surfaces — a WhatsApp picture drawn on canvas, a public web page, and a PDF —
 * and a shop that picks "Emerald" must get Emerald on all three, or its invoice
 * and its payment page look like two different businesses. Twelve hand-built
 * layouts times three renderers is thirty-six things to keep in step; a theme
 * that each renderer INTERPRETS is twelve entries and three interpreters.
 *
 * It is also why a theme is colour, weight and shape rather than a layout. The
 * layout of a tax invoice is largely fixed by Rule 46 — the same sixteen fields
 * in an order accountants expect. What actually distinguishes myBillBook's
 * eight is palette and emphasis, and pretending otherwise would mean twelve
 * subtly different documents to keep legally correct.
 *
 * Same shape as `card-templates.ts`, for the same reason: adding one is adding
 * an entry here, not writing code.
 */

export type InvoiceThemeId =
  | 'classic'
  | 'midnight'
  | 'emerald'
  | 'royal'
  | 'saffron'
  | 'crimson'
  | 'slate'
  | 'teal'

export interface InvoiceTheme {
  /** Stable id, stored in Setting.invoiceTheme. Never change or reuse. */
  id: InvoiceThemeId
  name: string
  /** One line, shown under the name in the picker. Says who it suits. */
  description: string

  /** The band behind the shop name, and the fill behind the grand total. */
  headerBg: string
  /** Text on `headerBg`. */
  headerText: string
  /** Muted text on `headerBg` — phone, GSTIN, address. */
  headerMuted: string

  /** The one highlight colour: rules, the amount-due figure, the Pay button. */
  accent: string
  /** A pale wash of `accent`, for the amount-due panel and table stripes. */
  accentSoft: string

  /** Body text on white. */
  text: string
  /** Labels and secondary lines on white. */
  muted: string
  /** Hairlines and table rules. */
  line: string

  /**
   * True when `headerBg` is dark.
   *
   * The renderers need to know rather than guess: the same theme drives a
   * canvas, a web page and a PDF, and each would otherwise compute contrast its
   * own way and eventually disagree.
   */
  darkHeader: boolean
}

export const INVOICE_THEMES: InvoiceTheme[] = [
  {
    id: 'classic',
    name: 'Classic',
    description: 'Charcoal and red. The default — plain, serious, reads anywhere.',
    headerBg: '#0F172A',
    headerText: '#FFFFFF',
    headerMuted: 'rgba(255,255,255,0.78)',
    accent: '#C2410C',
    accentSoft: '#FEF2F2',
    text: '#111827',
    muted: '#6B7280',
    line: '#E5E7EB',
    darkHeader: true,
  },
  {
    id: 'midnight',
    name: 'Midnight',
    description: 'Near-black with a cool blue. Consultants, services, wholesale.',
    headerBg: '#111827',
    headerText: '#FFFFFF',
    headerMuted: 'rgba(255,255,255,0.72)',
    accent: '#2563EB',
    accentSoft: '#EFF6FF',
    text: '#0F172A',
    muted: '#64748B',
    line: '#E2E8F0',
    darkHeader: true,
  },
  {
    id: 'emerald',
    name: 'Emerald',
    description: 'Deep green. Grocery, agriculture, pharmacy.',
    headerBg: '#064E3B',
    headerText: '#FFFFFF',
    headerMuted: 'rgba(255,255,255,0.76)',
    accent: '#047857',
    accentSoft: '#ECFDF5',
    text: '#11241D',
    muted: '#5B7268',
    line: '#DCE9E3',
    darkHeader: true,
  },
  {
    id: 'royal',
    name: 'Royal',
    description: 'Indigo and gold. Jewellers, textiles, boutiques.',
    headerBg: '#312E81',
    headerText: '#FFFFFF',
    headerMuted: 'rgba(255,255,255,0.76)',
    accent: '#B08D3F',
    accentSoft: '#FBF7EC',
    text: '#1E1B33',
    muted: '#6B6890',
    line: '#E4E2F0',
    darkHeader: true,
  },
  {
    id: 'saffron',
    name: 'Saffron',
    description: 'Warm orange on cream. Sweet shops, caterers, festive trade.',
    headerBg: '#9A3412',
    headerText: '#FFFFFF',
    headerMuted: 'rgba(255,255,255,0.80)',
    accent: '#C2410C',
    accentSoft: '#FFF7ED',
    text: '#1F1611',
    muted: '#7A6455',
    line: '#EFE3D8',
    darkHeader: true,
  },
  {
    id: 'crimson',
    name: 'Crimson',
    description: 'Strong red. Hardware, automotive, machinery.',
    headerBg: '#7F1D1D',
    headerText: '#FFFFFF',
    headerMuted: 'rgba(255,255,255,0.78)',
    accent: '#B91C1C',
    accentSoft: '#FEF2F2',
    text: '#1C1414',
    muted: '#7A6161',
    line: '#EEDFDF',
    darkHeader: true,
  },
  {
    id: 'slate',
    name: 'Slate',
    description: 'Light grey header, black type. The quietest of the set.',
    // The one LIGHT header, deliberately. Every other theme is a dark band, and
    // a shop that wants a plain document rather than a branded one has nothing
    // to choose otherwise.
    headerBg: '#F1F5F9',
    headerText: '#0F172A',
    headerMuted: 'rgba(15,23,42,0.60)',
    accent: '#334155',
    accentSoft: '#F8FAFC',
    text: '#0F172A',
    muted: '#64748B',
    line: '#E2E8F0',
    darkHeader: false,
  },
  {
    id: 'teal',
    name: 'Teal',
    description: 'Blue-green. Clinics, salons, professional services.',
    headerBg: '#115E59',
    headerText: '#FFFFFF',
    headerMuted: 'rgba(255,255,255,0.76)',
    accent: '#0F766E',
    accentSoft: '#F0FDFA',
    text: '#102A28',
    muted: '#5D7B78',
    line: '#DCEAE8',
    darkHeader: true,
  },
]

export const DEFAULT_INVOICE_THEME_ID: InvoiceThemeId = 'classic'

/**
 * A theme by id, never null.
 *
 * An unknown id — an older client, a hand-edited row, a theme we later remove —
 * falls back to the default rather than leaving a renderer with nothing to draw
 * with. A bill must always print.
 */
export function getInvoiceTheme(id: string | null | undefined): InvoiceTheme {
  if (id) {
    const found = INVOICE_THEMES.find(t => t.id === id)
    if (found) return found
  }
  return INVOICE_THEMES.find(t => t.id === DEFAULT_INVOICE_THEME_ID) ?? INVOICE_THEMES[0]
}

/** `#RRGGBB` → `{r,g,b}`, for the PDF, which takes components rather than CSS. */
export function themeRgb(hex: string): { r: number; g: number; b: number } {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim())
  if (!m) return { r: 0, g: 0, b: 0 }
  const n = parseInt(m[1], 16)
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 }
}
