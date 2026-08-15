/**
 * Invoices & Bills stays a hub of small pages, not one long scroll.
 *
 * 📄 2026-08-15. Rahul: "adding everything in the same section can be
 * frustrating … if the user just want to change one thing then he has to
 * scroll everything."
 *
 * The failure mode this guards is drift, not a bug: the easiest place to put
 * the next invoice setting is the bottom of a page that already exists, and
 * Phase 3 adds five of them (terms, signature, bank details, numbering,
 * thank-you). Six months of that and the hub is one scroll again.
 *
 * So: every category named in the hub must have a real page behind it, every
 * page must be reachable, and the descriptions must live behind the info button
 * rather than on the page.
 */

import { readCode, readRaw } from '@/test-support/read-source'
import { INVOICE_SECTIONS } from '@/components/settings/InvoiceSettingsPage'

const hub = readCode('src/components/settings/InvoiceSettingsPage.tsx')
const settings = readCode('src/components/settings/Settings.tsx')
const account = readCode('src/components/layout/AccountScreen.tsx')

describe('the hub', () => {
  it('offers more than one category', () => {
    // A "hub" with one page is a page.
    expect(INVOICE_SECTIONS.length).toBeGreaterThan(2)
  })

  it('gives every category a page that renders real controls', () => {
    /*
     * The thing that would otherwise rot silently: a row in the hub whose
     * section key nothing renders shows an empty page, which looks identical to
     * a page that is still loading.
     */
    for (const s of INVOICE_SECTIONS) {
      expect({ id: s.id, hasCards: settings.includes(`show('${s.id}')`) })
        .toEqual({ id: s.id, hasCards: true })
      expect({ id: s.id, routed: account.includes(`'${s.id}'`) })
        .toEqual({ id: s.id, routed: true })
    }
  })

  it('gives every category an explanation', () => {
    for (const s of INVOICE_SECTIONS) {
      expect({ id: s.id, explained: s.hint.length > 20 }).toEqual({ id: s.id, explained: true })
    }
  })

  it('shows the preview on the hub AND on each page', () => {
    // myBillBook's one genuinely good idea: you never choose blind.
    expect(hub).toContain('InvoicePreview')
    // Rendered above `children`, which is where a sub-page's controls go.
    expect(hub).toContain('children')
  })

  it('points the preview at the part being edited', () => {
    // Every category names a block of the bill to highlight.
    for (const s of INVOICE_SECTIONS) {
      expect({ id: s.id, focus: typeof s.focus === 'string' }).toEqual({ id: s.id, focus: true })
    }
  })
})

describe('the preview', () => {
  const preview = readCode('src/components/settings/InvoicePreview.tsx')

  it('draws the page full size and scales it, rather than hand-picking tiny type', () => {
    /*
     * The first version chose font sizes by eye — text-[5px], text-[5.5px] —
     * which the microtypography guard caught. It was right twice: those are
     * off-scale values, and hand-tuning them made the preview's proportions my
     * guesses instead of the document's. Drawing A4 at 794px and scaling means
     * every proportion is the real one.
     */
    expect(preview).toContain('PAGE_W')
    expect(preview).toContain('transform: `scale(')
    expect(preview).not.toMatch(/text-\[\d+px\]/)
  })

  it('reads the document and computes nothing', () => {
    // Same rule as the other three renderers.
    expect(preview).not.toContain('computeInvoiceDue')
    expect(preview).not.toContain('amountToWords')
    expect(preview).toContain('InvoiceDocument')
  })

  it('says when it is showing a sample rather than the shop\'s own bill', () => {
    // Inventing numbers and presenting them as the shop's would be worse than
    // showing nothing.
    expect(preview).toContain('isSample')
    expect(readRaw('src/components/settings/InvoicePreview.tsx')).toContain('A sample bill')
  })
})

describe('descriptions live behind the info button', () => {
  it('the layout and colour pickers use InfoHint', () => {
    // Rahul: "always add with info button so the design look clean".
    expect(settings).toContain('InfoHint')
    // And the tile still shows the NAME — never hide what a thing is called.
    expect(settings).toContain('{t.name}')
  })

  it('the info button is big enough to tap', () => {
    /*
     * §4 asks for 48dp targets, and the Ask work found a 43px control that had
     * slipped a pixel under. A 16px icon is exactly where that happens, so the
     * button is 44px with a negative margin.
     */
    const hint = readCode('src/components/common/InfoHint.tsx')
    expect(hint).toMatch(/w-11 h-11/)
  })

  it('tapping the info button does not also choose the option', () => {
    // The hint sits inside a row that is itself a button.
    const hint = readCode('src/components/common/InfoHint.tsx')
    expect(hint).toContain('stopPropagation')
  })
})
