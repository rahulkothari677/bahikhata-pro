/**
 * Layout, style and palette are three separate things.
 *
 * 📄 Phase 7c of docs/INVOICE-ENGINE-PLAN.md.
 *
 * Rahul: *"the design and layout is different."* He was right, and mixing them
 * is why thirteen "designs" looked like one bill thirteen times. What I had
 * called a template carried style choices, pretended to carry layout choices,
 * and the layout was hardcoded and identical for all of them — so the one
 * thing that makes a bill look unlike another was the one thing no design
 * could change.
 *
 * These tests hold the separation in place. If a layout ever grows a colour,
 * or a style ever grows a block, the vocabularies have started to merge again
 * and the next thirteen designs will look like one.
 */

import { readCode } from '@/test-support/read-source'
import {
  INVOICE_LAYOUTS, getInvoiceLayout, layoutFitsPaper, DEFAULT_LAYOUT_ID,
} from '@/lib/invoice-layouts'
import {
  INVOICE_STYLES, getInvoiceStyle, styleFitsLayout, DENSITY_METRICS, DEFAULT_STYLE_ID,
} from '@/lib/invoice-styles'
import { INVOICE_PRESETS, getInvoicePreset, presetIsLegal, resolveInvoiceDesign } from '@/lib/invoice-presets'
import { INVOICE_THEMES } from '@/lib/invoice-themes'

describe('the three vocabularies stay separate', () => {
  it('a LAYOUT carries no colour and no line weight', () => {
    /*
     * The moment a layout knows a colour, changing the palette starts moving
     * blocks — and every design has to be re-checked against every colour.
     */
    const src = readCode('src/lib/invoice-layouts.ts')
    expect(src).not.toMatch(/#[0-9a-fA-F]{6}/)
    expect(src).not.toContain('lineWidth')
  })

  it('a STYLE carries no blocks and no colour', () => {
    /*
     * Checked on the OBJECTS, not the file text. `styleFitsLayout` reads a
     * layout to decide whether a pair is legal, which is the two vocabularies
     * talking rather than merging — a text scan called that a leak and was
     * wrong. The real claim is that no style DEFINES a block.
     */
    expect(readCode('src/lib/invoice-styles.ts')).not.toMatch(/#[0-9a-fA-F]{6}/)
    const blockKeys = ['frame', 'header', 'metaStrip', 'party', 'columns', 'tableFill', 'totals']
    for (const style of INVOICE_STYLES) {
      const leaked = Object.keys(style).filter(k => blockKeys.includes(k))
      expect({ style: style.id, leaked }).toEqual({ style: style.id, leaked: [] })
    }
  })

  it('a LAYOUT defines no style keys', () => {
    const styleKeys = ['rules', 'zebra', 'density', 'lineWidth', 'titleFace', 'ornament']
    for (const layout of INVOICE_LAYOUTS) {
      const leaked = Object.keys(layout).filter(k => styleKeys.includes(k))
      expect({ layout: layout.id, leaked }).toEqual({ layout: layout.id, leaked: [] })
    }
  })

  it('a PALETTE carries no layout and no style', () => {
    const src = readCode('src/lib/invoice-themes.ts')
    for (const k of ['density', 'ornament', 'metaStrip', 'tableFill']) {
      expect({ key: k, leaked: src.includes(k) }).toEqual({ key: k, leaked: false })
    }
  })
})

describe('ten layouts, six styles, fifteen palettes', () => {
  it('has enough of each to be worth separating', () => {
    expect(INVOICE_LAYOUTS.length).toBe(10)
    expect(INVOICE_STYLES.length).toBe(6)
    // Rahul: "you have added very less colour". Eight was not a colour system.
    expect(INVOICE_THEMES.length).toBeGreaterThanOrEqual(15)
  })

  it('every layout id is unique, and so is every style and preset id', () => {
    for (const [what, ids] of [
      ['layout', INVOICE_LAYOUTS.map(l => l.id)],
      ['style', INVOICE_STYLES.map(s => s.id)],
      ['preset', INVOICE_PRESETS.map(p => p.id)],
      ['theme', INVOICE_THEMES.map(t => t.id)],
    ] as const) {
      expect({ what, unique: new Set(ids).size === ids.length }).toEqual({ what, unique: true })
    }
  })

  it('no two layouts are the same skeleton', () => {
    // Two entries with identical bones are one design listed twice — the
    // duplicate that already cost this phase a template.
    const bones = INVOICE_LAYOUTS.map(l =>
      [l.frame, l.header, l.metaStrip, l.party, l.columns, l.tableFill, l.totals].join('/'))
    expect(new Set(bones).size).toBe(INVOICE_LAYOUTS.length)
  })

  it('falls back rather than throwing on an unknown id', () => {
    // A stale row or a rolled-back deploy must still print a bill.
    expect(getInvoiceLayout('does-not-exist').id).toBe(DEFAULT_LAYOUT_ID)
    expect(getInvoiceStyle(null).id).toBe(DEFAULT_STYLE_ID)
    expect(getInvoicePreset('nope')).toBeNull()
  })
})

describe('illegal combinations are refused, not drawn', () => {
  it('an ornament needs a frame to sit on', () => {
    // Runnable both ways, on inputs the test controls.
    expect(styleFitsLayout({ ornament: true, density: 'compact' }, { frame: 'none', columns: 'simple' }))
      .toBe(false)
    expect(styleFitsLayout({ ornament: true, density: 'compact' }, { frame: 'double', columns: 'simple' }))
      .toBe(true)
  })

  it('eleven GST columns do not fit an airy style', () => {
    expect(styleFitsLayout({ ornament: false, density: 'airy' }, { frame: 'none', columns: 'gst-full' }))
      .toBe(false)
    expect(styleFitsLayout({ ornament: false, density: 'compact' }, { frame: 'none', columns: 'gst-full' }))
      .toBe(true)
  })

  it('eleven GST columns do not fit A5', () => {
    const royal = INVOICE_LAYOUTS.find(l => l.id === 'royal')!
    expect(layoutFitsPaper(royal, 'a4')).toBe(true)
    expect(layoutFitsPaper(royal, 'a5')).toBe(false)
  })

  it('a customised shop that reaches an illegal pair still gets a bill', () => {
    /*
     * Reachable by hand: pick the ornate style, then switch to a layout with
     * no frame. Refusing to print would be absurd; brackets in mid-air would
     * look broken. The style falls back and the bill still looks deliberate.
     */
    const { layout, style } = resolveInvoiceDesign({
      invoiceTemplate: 'corporate', invoiceStyle: 'ornate',
    })
    expect(layout.id).toBe('corporate')
    expect(styleFitsLayout(style, layout)).toBe(true)
  })
})

describe('every preset is a bill that can actually be drawn', () => {
  it.each(INVOICE_PRESETS.map(p => [p.id, p.name] as const))('%s (%s)', presetId => {
    const preset = getInvoicePreset(presetId)!
    expect({ presetId, legal: presetIsLegal(preset) }).toEqual({ presetId, legal: true })
  })

  it('every preset points at a palette that exists', () => {
    for (const p of INVOICE_PRESETS) {
      expect({ preset: p.id, theme: p.themeId, exists: INVOICE_THEMES.some(t => t.id === p.themeId) })
        .toEqual({ preset: p.id, theme: p.themeId, exists: true })
    }
  })

  it('there is a preset for each layout, so none is unreachable', () => {
    /*
     * A layout with no preset is only findable by customising — which is the
     * "built but unreachable" defect this codebase has shipped three times.
     */
    for (const l of INVOICE_LAYOUTS) {
      expect({ layout: l.id, hasPreset: INVOICE_PRESETS.some(p => p.layoutId === l.id) })
        .toEqual({ layout: l.id, hasPreset: true })
    }
  })

  it('a preset is a shortcut, never a fourth thing the renderer reads', () => {
    // If the renderer ever reads a preset, there are four vocabularies and the
    // fourth will drift from the other three.
    expect(readCode('src/lib/invoice-pdf.ts')).not.toContain('invoicePreset')
  })
})

describe('density metrics', () => {
  it('gives every density a full set', () => {
    for (const [density, m] of Object.entries(DENSITY_METRICS)) {
      expect({ density, complete: Object.values(m).every(v => typeof v === 'number' && v > 0) })
        .toEqual({ density, complete: true })
    }
  })

  it('compact is smaller than regular, which is smaller than airy', () => {
    // A "compact" that is not compact is a label that lies to the shopkeeper.
    expect(DENSITY_METRICS.compact.rowHeight).toBeLessThan(DENSITY_METRICS.regular.rowHeight)
    expect(DENSITY_METRICS.regular.rowHeight).toBeLessThan(DENSITY_METRICS.airy.rowHeight)
  })

  it('never drops body text below 8pt', () => {
    /*
     * Rahul: "words items and everything should look clear in preview as well
     * as the image the user will send." 8pt is the floor at which a printed
     * bill stays readable, and the WhatsApp picture is read on a phone at a
     * fraction of that size.
     */
    for (const [density, m] of Object.entries(DENSITY_METRICS)) {
      expect({ density, bodyPt: m.bodyPt >= 8 }).toEqual({ density, bodyPt: true })
    }
  })
})
