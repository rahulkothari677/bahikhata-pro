/**
 * A design a shopkeeper cannot choose does not exist.
 *
 * 📄 Phase 7d of docs/INVOICE-ENGINE-PLAN.md.
 *
 * ── WHY ───────────────────────────────────────────────────────────────
 *
 * Rahul, 16 Aug: *"i don't see where you have added the royal gold design?"*
 *
 * He was right, and the chain was broken in FIVE places. Ten layouts, six
 * styles, fifteen palettes and ten named designs existed in code. On screen
 * there were two controls. The save route rejected the other two settings.
 * The download path passed the layout and dropped the dressing. So did the
 * WhatsApp path. So did the preview.
 *
 * Every one of my existing guards passed throughout. They check that the
 * REGISTRY is coherent — that every layout has a preset, that no two presets
 * collide, that every preset is legal. Not one of them asks whether a
 * shopkeeper can reach any of it. I tested the data and called it the app.
 *
 * That is "built but unreachable", which CLAUDE.md records this codebase
 * having shipped three times before. This is the fourth, and the first where
 * the unreachable thing was the whole point of the phase.
 *
 * ── WHAT THESE CHECK ──────────────────────────────────────────────────
 *
 * The path from the picker to the paper, one link at a time. They read the
 * real source files, because the defect was never in a function — every
 * function worked. It was in what nobody called.
 */

import { readCode } from '@/test-support/read-source'
import { INVOICE_PRESETS } from '@/lib/invoice-presets'
import { INVOICE_STYLES } from '@/lib/invoice-styles'

describe('a shopkeeper can reach every design that was built', () => {
  it('the settings screen offers the named designs, not just the bones', () => {
    /*
     * The specific miss. Ten designs existed and the screen listed layouts,
     * so "Royal Gold" — the name in the plan, the reference image and the
     * commit message — appeared nowhere in the product.
     */
    const src = readCode('src/components/settings/Settings.tsx')
    expect({ offersNamedDesigns: src.includes('INVOICE_PRESETS.map') })
      .toEqual({ offersNamedDesigns: true })
  })

  it('the settings screen offers the styling, not only the layout', () => {
    // Ornate is what puts the corner ornaments on Royal's frame. Without a
    // control for it, the framed layouts were plain rectangles for everyone.
    const src = readCode('src/components/settings/Settings.tsx')
    expect({ offersStyles: src.includes('INVOICE_STYLES.map') })
      .toEqual({ offersStyles: true })
  })

  it('the save route accepts the style and the design name', () => {
    /*
     * It accepted theme, layout and paper size only. A picker alone would
     * have been a control that silently saved nothing — which is a worse
     * failure than a missing control, because the shopkeeper believes it.
     */
    const src = readCode('src/app/api/settings/route.ts')
    for (const key of ['invoiceStyle', 'invoicePreset']) {
      expect({ key, accepted: src.includes(`body.${key} !== undefined`) })
        .toEqual({ key, accepted: true })
    }
  })

  it('the save route expands a design name into the three real settings', () => {
    // A preset is a shortcut, never a fourth thing the renderer reads. If the
    // browser expanded it, a second opinion about what "Royal Gold" means
    // would live in the client and drift from the table the renderer uses.
    const src = readCode('src/app/api/settings/route.ts')
    for (const written of ['sanitized.invoiceTemplate = preset.layoutId',
      'sanitized.invoiceStyle = preset.styleId',
      'sanitized.invoiceTheme = preset.themeId']) {
      expect({ written, present: src.includes(written) }).toEqual({ written, present: true })
    }
  })

  it('every path that draws a bill passes the styling', () => {
    /*
     * 🐛 THE ONE THAT MATTERED MOST. Three renderers, and all three took the
     * layout and dropped the dressing — so even after a shop chose Royal
     * Gold, the file its customer received was drawn in the default style.
     * The ornaments could not have appeared on anybody's bill.
     *
     * Checked as source text on purpose: each of these is a CALL SITE, and a
     * call site that forgets an argument is exactly what no unit test of the
     * renderer can see. The renderer was never wrong.
     */
    const paths: Array<[string, string]> = [
      ['the download', 'src/components/ledger/TransactionDetail.tsx'],
      ['WhatsApp', 'src/lib/send-bill.ts'],
      ['the preview', 'src/components/settings/InvoiceSettingsPage.tsx'],
    ]
    for (const [what, file] of paths) {
      const src = readCode(file)
      expect({ what, passesStyle: /styleId[:=]/.test(src) }).toEqual({ what, passesStyle: true })
    }
  })

  it('the download path resolves the pair rather than reading both raw', () => {
    /*
     * `resolveInvoiceDesign` is the only function that knows an ornament
     * needs a frame to sit on. Before this it was called by nothing but its
     * own test — dead code in production, while the rule it exists to enforce
     * went unenforced on every bill.
     */
    const src = readCode('src/components/ledger/TransactionDetail.tsx')
    expect({ resolves: src.includes('resolveInvoiceDesign') }).toEqual({ resolves: true })
  })

  it('every named design and every style is offered, not a chosen few', () => {
    /*
     * Guards the CLASS, not the instance: a picker showing six of the ten
     * would pass every check above. Both lists are mapped whole, so adding a
     * design cannot forget to list it.
     */
    const src = readCode('src/components/settings/Settings.tsx')
    expect({
      designs: INVOICE_PRESETS.length > 0 && src.includes('INVOICE_PRESETS.map'),
      styles: INVOICE_STYLES.length > 0 && src.includes('INVOICE_STYLES.map'),
      slicedDesigns: /INVOICE_PRESETS\s*\.\s*slice/.test(src),
      slicedStyles: /INVOICE_STYLES\s*\.\s*slice/.test(src),
    }).toEqual({ designs: true, styles: true, slicedDesigns: false, slicedStyles: false })
  })
})
