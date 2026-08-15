/**
 * One document, three renderers, no second opinion about the money.
 *
 * 📄 2026-08-15, Phase 1 of docs/INVOICE-ENGINE-PLAN.md.
 *
 * WHAT THIS PROTECTS. `invoice-document.ts` exists so the arithmetic on a bill
 * happens exactly once and the renderers only lay out what they are handed. The
 * PDF did not use it. It declared its own InvoiceData shape, called
 * `computeInvoiceDue` itself, derived its own PAID/PARTIAL/DUE status, and ran
 * `amountToWords` a second time. It agreed with the WhatsApp picture and the
 * public bill page only because both happened to call the same due helper —
 * nothing enforced it, and the two shapes had already drifted: the PDF printed
 * `paidAmount` (what was paid at the till) beside a due figure that accounted
 * for later settlements, so a part-paid bill could read "Paid 200" and "Balance
 * Due 0" on the same page.
 *
 * WHY THE RULE IS AN EXTRACTED FUNCTION. CLAUDE.md's Cause 7 now has six
 * entries, and the rule earned on 15 Aug is that a guard buried inside a file
 * sweep can only be exercised by committing a real bug. `arithmeticImports` is
 * a plain function: the tests below call it with a known-good input and a
 * known-bad one and watch it come back different.
 *
 * And comments are stripped before anything is asserted, because this file's
 * subject appears in the prose of the file it checks — invoice-pdf.ts explains
 * that it USED to call `computeInvoiceDue`. A raw-text guard would read that
 * sentence and pass forever.
 */

import { readCode, stripComments } from '@/test-support/read-source'

/**
 * The helpers a renderer must not reach for, because `InvoiceDocument` already
 * carries the answer: `due`, `paid`, `status`, `total`, `totalInWords`.
 *
 * Named individually rather than matched by pattern so that adding one is a
 * deliberate act with a reason beside it.
 */
const DOCUMENT_OWNS = [
  'computeInvoiceDue',   // → doc.due, doc.status
  'amountToWords',       // → doc.totalInWords
] as const

/**
 * THE RULE, callable. Returns which forbidden helpers the given source
 * actually imports — empty means the renderer is drawing, not deciding.
 *
 * Matches on the import statement, not on any mention: a renderer is free to
 * discuss these in a comment, and the caller has already stripped comments
 * anyway. Both `import { x } from` and `import x from` forms are covered.
 */
export function arithmeticImports(source: string): string[] {
  const code = stripComments(source)
  const importLines = code
    .split(/\r?\n/)
    .filter(l => /^\s*import\b/.test(l) || /^\s*(const|let)\s+\{[^}]*\}\s*=\s*(await\s+)?(import|require)\(/.test(l))
    .join('\n')
  return DOCUMENT_OWNS.filter(name =>
    new RegExp(`\\b${name}\\b`).test(importLines),
  )
}

describe('arithmeticImports — the rule itself', () => {
  it('finds nothing in a renderer that only draws', () => {
    const clean = `
      import { paletteFor } from './pdf/palette'
      import type { InvoiceDocument } from './invoice-document'
      export function render(doc: InvoiceDocument) { return doc.due }
    `
    expect(arithmeticImports(clean)).toEqual([])
  })

  it('CATCHES a renderer that recomputes the due amount', () => {
    // The known-bad input. This is the bug, exactly as it was before the fix.
    const bad = `
      import { computeInvoiceDue } from './invoice-due'
      import { amountToWords } from './amount-to-words'
      export function render(txn: any) { return computeInvoiceDue(txn) }
    `
    expect(arithmeticImports(bad)).toEqual(['computeInvoiceDue', 'amountToWords'])
  })

  it('is not fooled by a comment that merely mentions them', () => {
    // The 15 Aug defect: invoice-pdf.ts explains it USED to call these.
    const prose = `
      /* This block used to call computeInvoiceDue and amountToWords itself. */
      import { paletteFor } from './pdf/palette'
    `
    expect(arithmeticImports(prose)).toEqual([])
  })

  it('catches a dynamic import too', () => {
    const lazy = `const { amountToWords } = await import('./amount-to-words')`
    expect(arithmeticImports(lazy)).toEqual(['amountToWords'])
  })
})

describe('the renderers, as shipped', () => {
  it('invoice-pdf.ts decides nothing about the money', () => {
    expect(arithmeticImports(readCode('src/lib/invoice-pdf.ts'))).toEqual([])
  })

  it('invoice-share-image.ts decides nothing about the money', () => {
    expect(arithmeticImports(readCode('src/lib/invoice-share-image.ts'))).toEqual([])
  })

  it('every renderer takes an InvoiceDocument', () => {
    const pdf = readCode('src/lib/invoice-pdf.ts')
    expect(pdf).toContain('InvoiceDocument')
    // And no longer declares a rival shape for the same thing.
    expect(pdf).not.toMatch(/interface\s+InvoiceData\b/)
    expect(pdf).not.toMatch(/interface\s+ShopSetting\b/)
  })

  it('the PDF is given the shop\'s chosen theme', () => {
    /*
     * The user-visible half of this phase. "Invoice design" told the shopkeeper
     * it applied to "the bill picture, the bill link and the PDF"; the PDF
     * ignored it and printed saffron whatever was chosen.
     */
    const pdf = readCode('src/lib/invoice-pdf.ts')
    expect(pdf).toContain('paletteFor(opts.themeId)')

    // And the sender actually passes it, on the PDF path as well as the image.
    const send = readCode('src/lib/send-bill.ts')
    expect(send).toMatch(/generateInvoicePDF\(\s*doc,\s*\{[^}]*themeId/)
  })

  it('send-bill hands the PDF the document it already built', () => {
    // It used to build `doc`, ignore it, and pass the raw source with two
    // `as never` casts — silencing the type system exactly where it was
    // objecting that the PDF got something different from every other surface.
    const send = readCode('src/lib/send-bill.ts')
    expect(send).not.toContain('as never')
  })
})
