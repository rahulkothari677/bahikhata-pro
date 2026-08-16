import { INVOICE_LAYOUTS, getInvoiceLayout, layoutFitsPaper, type InvoiceLayout } from './invoice-layouts'
import { INVOICE_STYLES, getInvoiceStyle, styleFitsLayout, type InvoiceStyle } from './invoice-styles'

/**
 * PRESETS — one tap for a finished bill, with the pieces still separate
 * underneath.
 *
 * 📄 Phase 7c of docs/INVOICE-ENGINE-PLAN.md.
 *
 * Rahul chose option (c): named presets up front, and a customise path beneath
 * for anyone who wants to change just the colour. That is what myBillBook does
 * — named themes plus colour swatches — and it is right, because the two users
 * are different people. A kirana shopkeeper taps "Classic Indigo" at setup and
 * never opens the screen again. A jeweller wants gold on cream rather than
 * gold on white, and should not have to accept a whole different bill to get
 * it.
 *
 * ── A PRESET IS A SHORTCUT, NOT A FOURTH THING ────────────────────────
 *
 * It writes three settings — layout, style, palette — and nothing more. The
 * renderer never reads a preset. That matters: if presets were their own
 * concept the renderer would have to know about four vocabularies instead of
 * three, and the fourth would drift from the others within a release. This
 * codebase has produced four bugs of exactly that shape.
 *
 * `Setting.invoicePreset` is stored ONLY so the picker can show which one is
 * selected, and it is cleared the moment a shopkeeper changes any single piece
 * — because at that point the honest answer to "which preset am I on" is "none
 * of them, this is yours".
 */

export interface InvoicePreset {
  /** Stable id, stored in Setting.invoicePreset. Never change or reuse. */
  id: string
  /** What the shopkeeper reads in the picker. */
  name: string
  /** One line under the name. Says which trade it was drawn for. */
  description: string
  layoutId: string
  styleId: string
  /** An InvoiceTheme id — see invoice-themes.ts. */
  themeId: string
}

/**
 * The ten, each taken from one of Rahul's reference bills.
 *
 * Named for what they look like rather than for the trade, because a
 * hardware shop may well want the pharmacy's layout and should not have to
 * feel odd choosing it. myBillBook names themes "Uttarakhand 2", which tells
 * a shopkeeper nothing; that is a UX decision they lost.
 */
export const INVOICE_PRESETS: readonly InvoicePreset[] = [
  {
    id: 'classic-indigo',
    name: 'Classic Indigo',
    description: 'A colour band and striped rows. Suits any shop.',
    layoutId: 'classic', styleId: 'striped', themeId: 'ocean',
  },
  {
    id: 'royal-gold',
    name: 'Royal Gold',
    description: 'Framed page, corner ornaments, full tax breakup.',
    // The Jaipur saree reference. Uses every capability at once.
    layoutId: 'royal', styleId: 'ornate', themeId: 'royal',
  },
  {
    id: 'tally-maroon',
    name: 'Tally Maroon',
    description: 'Every cell ruled, accounting-grade. For wholesale.',
    layoutId: 'tally', styleId: 'boxed', themeId: 'maroon',
  },
  {
    id: 'pharmacy-green',
    name: 'Pharmacy Green',
    description: 'Batch and expiry as columns, patient card.',
    layoutId: 'dispensary', styleId: 'ruled', themeId: 'forest',
  },
  {
    id: 'transport-rust',
    name: 'Transport Rust',
    description: 'Vehicle and docket strip, sender and receiver.',
    layoutId: 'consignment', styleId: 'ruled', themeId: 'rust',
  },
  {
    id: 'corporate-slate',
    name: 'Corporate Slate',
    description: 'No band, large name, plenty of air. For services.',
    layoutId: 'corporate', styleId: 'airy', themeId: 'slate',
  },
  {
    id: 'formal-purple',
    name: 'Formal Purple',
    description: 'The band says TAX INVOICE, your shop below it.',
    layoutId: 'titled', styleId: 'striped', themeId: 'plum',
  },
  {
    id: 'counter-memo',
    name: 'Counter Memo',
    description: 'Half a page, least ink. For a quick slip.',
    layoutId: 'memo', styleId: 'plain', themeId: 'graphite',
  },
  {
    id: 'billbook-blue',
    name: 'Bill Book Blue',
    description: 'Ruled throughout and padded, like a printed pad.',
    layoutId: 'register', styleId: 'boxed', themeId: 'prussian',
  },
  {
    id: 'boutique-teal',
    name: 'Boutique Teal',
    description: 'Framed, spacious, restrained. Quiet luxury.',
    layoutId: 'boutique', styleId: 'airy', themeId: 'teal',
  },
] as const

export function getInvoicePreset(id: string | null | undefined): InvoicePreset | null {
  return INVOICE_PRESETS.find(p => p.id === id) ?? null
}

/**
 * Resolve what to actually draw with.
 *
 * The three pieces are read independently, so a shopkeeper who changed only
 * the colour keeps their layout. Falls back to the defaults rather than
 * throwing: an unrecognised id is a stale row or a rolled-back deploy, and a
 * bill that will not print is a worse answer than a bill in the default look.
 */
export function resolveInvoiceDesign(setting: {
  invoiceTemplate?: string | null
  invoiceStyle?: string | null
} | null | undefined): { layout: InvoiceLayout; style: InvoiceStyle } {
  const layout = getInvoiceLayout(setting?.invoiceTemplate)
  const style = getInvoiceStyle(setting?.invoiceStyle)

  /*
   * An illegal pair is silently corrected rather than drawn.
   *
   * A shopkeeper can reach one by customising — picking the ornate style, then
   * switching to a layout with no frame to hang the ornaments on. Refusing to
   * print would be absurd; drawing brackets in mid-air would look broken. So
   * the style falls back to its nearest legal sibling and the bill still comes
   * out looking deliberate.
   */
  if (!styleFitsLayout(style, layout)) {
    const fallback = INVOICE_STYLES.find(s => styleFitsLayout(s, layout))
    return { layout, style: fallback ?? getInvoiceStyle(null) }
  }
  return { layout, style }
}

/**
 * Every preset is a legal combination.
 *
 * Exported so a test can run it rather than only a human reading the table —
 * a preset that resolves to something the renderer refuses would be a picker
 * entry that quietly gives you a different bill from the one pictured.
 */
export function presetIsLegal(preset: InvoicePreset): boolean {
  const layout = INVOICE_LAYOUTS.find(l => l.id === preset.layoutId)
  const style = INVOICE_STYLES.find(s => s.id === preset.styleId)
  if (!layout || !style) return false
  return styleFitsLayout(style, layout) && layoutFitsPaper(layout, 'a4')
}
