/**
 * Phase 4: the visibility toggles are real, reach the paper, and cannot hide
 * anything the law requires.
 *
 * 📄 docs/INVOICE-ENGINE-PLAN.md Phase 4.
 *
 * THE FAILURES THIS GUARDS, in order of how badly they would hurt:
 *
 *  1. A toggle for data that does not exist. Three of myBillBook's seven had
 *     no column behind them in this schema; shipping switches for those would
 *     have been the placebo App Lock again. Only the four with real data are
 *     in the registry, and the schema guard below keeps it that way.
 *  2. A toggle that hides a Rule 46 particular. That is not a customised
 *     invoice, it is an invalid one, and the shopkeeper finds out from a
 *     notice. This is the §0 test in this file.
 *  3. A toggle one renderer honours and another ignores — exactly what
 *     happened with invoiceTheme. Prevented structurally: the document applies
 *     every toggle, and a guard proves no renderer knows a toggle exists.
 *
 * Every rule here is a FUNCTION called with a good and a bad input, rather
 * than a regex sweep that can only be exercised by committing a real bug.
 * That is what CLAUDE.md's Cause 7 earned on 15 Aug, after a guard passed 9 of
 * 9 against code with its subject deleted.
 */

// jsdom has neither, and jspdf's PNG decoder needs both.
import { TextEncoder as NodeTextEncoder, TextDecoder as NodeTextDecoder } from 'util'
;(globalThis as unknown as Record<string, unknown>).TextEncoder ||= NodeTextEncoder
;(globalThis as unknown as Record<string, unknown>).TextDecoder ||= NodeTextDecoder

import { readFileSync } from 'fs'
import { join } from 'path'
import { readCode } from '@/test-support/read-source'
import {
  isVisible,
  VISIBILITY_TOGGLES,
  MANDATORY_INVOICE_FIELDS,
  type VisibilityKey,
} from '@/lib/invoice-visibility'
import {
  buildInvoiceDocument,
  alternateQtyLabel,
  invoiceShopFromSetting,
  type InvoiceSource,
  type InvoiceShop,
} from '@/lib/invoice-document'
import { generateInvoicePDF } from '@/lib/invoice-pdf'

describe('isVisible — the default lives in exactly one place', () => {
  it('honours an explicit answer, either way', () => {
    expect(isVisible('showPartyBalance', { showPartyBalance: true })).toBe(true)
    expect(isVisible('showSignatureBox', { showSignatureBox: false })).toBe(false)
  })

  it('falls back to the registry default when the shop has never chosen', () => {
    // Every new toggle is off, so an existing shop's bill does not change.
    expect(isVisible('showPartyBalance', {})).toBe(false)
    expect(isVisible('showPartyBalance', null)).toBe(false)
    expect(isVisible('showItemDescription', undefined)).toBe(false)
    // Phase 3 shipped the signature line ON. Changing that silently would
    // alter every existing shop's invoice.
    expect(isVisible('showSignatureBox', {})).toBe(true)
  })
})

describe('alternateQtyLabel — only when it says something new', () => {
  it('prints what was typed when it differs from what was stored', () => {
    expect(alternateQtyLabel(0.5, 'ltr', 500, 'ml')).toBe('500 ml')
  })

  it('prints nothing when the two agree', () => {
    // Otherwise the bill reads "2 kg (2 kg)", which looks like a defect.
    expect(alternateQtyLabel(2, 'kg', 2, 'kg')).toBeNull()
    expect(alternateQtyLabel(2, 'KG', 2, ' kg ')).toBeNull()
  })

  it('prints nothing when nothing was captured', () => {
    expect(alternateQtyLabel(2, 'kg', null, null)).toBeNull()
    expect(alternateQtyLabel(2, 'kg', 2, undefined)).toBeNull()
  })
})

// ─────────────────────────────────────────────────────────────────────────
// The registry against the schema, and against the law.
// ─────────────────────────────────────────────────────────────────────────

/**
 * The column names declared inside `model Setting`.
 *
 * Split on `/\r?\n/` and with comments stripped FIRST — this checkout is
 * Windows and CI is Linux, and a guard that reads a comment as a column would
 * pass on a registry key that has no column at all. Both failures are in
 * CLAUDE.md already.
 */
export function settingColumns(schema: string): Set<string> {
  const lines = schema.split(/\r?\n/)
  const start = lines.findIndex(l => /^\s*model\s+Setting\s*\{/.test(l))
  if (start === -1) throw new Error('model Setting not found — the guard is reading the wrong file')

  const out = new Set<string>()
  for (let i = start + 1; i < lines.length; i++) {
    const line = lines[i].replace(/\/\/.*$/, '')
    if (/^\s*\}/.test(line)) break
    const m = line.match(/^\s*(\w+)\s+\S/)
    if (m) out.add(m[1])
  }
  return out
}

describe('the registry and the database agree', () => {
  const schema = readFileSync(join(process.cwd(), 'prisma/schema.prisma'), 'utf8')

  it('reads real columns and not comments', () => {
    // The rule, exercised both ways on input it fully controls.
    const good = 'model Setting {\r\n  showPartyBalance Boolean @default(false)\r\n}\r\n'
    expect(settingColumns(good).has('showPartyBalance')).toBe(true)

    const commentOnly = 'model Setting {\r\n  // showPartyBalance Boolean\r\n  id String\r\n}\r\n'
    expect(settingColumns(commentOnly).has('showPartyBalance')).toBe(false)
  })

  it('every toggle has a column to store the answer in', () => {
    const columns = settingColumns(schema)
    for (const t of VISIBILITY_TOGGLES) {
      // Reported as an object so a failure names the offending key rather
      // than printing "expected true, got false".
      expect({ key: t.key, hasColumn: columns.has(t.key) }).toEqual({ key: t.key, hasColumn: true })
    }
  })
})

describe('§0 — a shopkeeper cannot switch off the law', () => {
  /*
   * Rule 46 lists what a tax invoice must carry. Every competitor treats
   * "customise your invoice" as a free-for-all; refusing to is the difference
   * between a compliance engine and a register, applied to a settings screen.
   */
  const offered = new Set<string>(VISIBILITY_TOGGLES.map(t => t.key))

  it('offers no toggle for a mandatory particular', () => {
    for (const field of MANDATORY_INVOICE_FIELDS) {
      const asToggle = `show${field.charAt(0).toUpperCase()}${field.slice(1)}`
      expect({ field, offered: offered.has(asToggle) }).toEqual({ field, offered: false })
    }
  })

  it('would catch one if it were added', () => {
    // The check above only means something if it can fail. Same rule, run
    // against a registry that DOES offer to hide the GSTIN.
    const bad = new Set(['showShopGstin'])
    const caught = MANDATORY_INVOICE_FIELDS.filter(f =>
      bad.has(`show${f.charAt(0).toUpperCase()}${f.slice(1)}`),
    )
    expect(caught).toEqual(['shopGstin'])
  })
})

describe('no renderer knows a toggle exists', () => {
  /*
   * The architectural guarantee, and the reason invoiceTheme's bug cannot
   * repeat: buildInvoiceDocument resolves every toggle to a value or to null,
   * so a renderer has nothing to branch on and nothing to forget.
   *
   * If this test fails, someone has moved a decision back out into a renderer
   * — and the other three will drift from it within a release.
   */
  /*
   * Three renderers, not four: the public bill page was deleted on 15 Aug
   * with the shareable link (see send-bill.ts). The rule is unchanged — every
   * surface that draws a bill must be listed here.
   */
  const RENDERERS = [
    'src/lib/invoice-pdf.ts',
    'src/lib/invoice-share-image.ts',
    'src/components/settings/InvoicePreview.tsx',
  ]

  const DATA_KEYS: VisibilityKey[] = [
    'showPartyBalance',
    'showItemDescription',
    'showAlternateUnit',
    'showInvoiceTime',
  ]

  it.each(RENDERERS)('%s reads no toggle', file => {
    // Comments stripped, so prose describing a toggle does not fail the test —
    // and, more importantly, so prose cannot SATISFY one either.
    const src = readCode(file)
    for (const key of DATA_KEYS) {
      expect({ file, key, present: src.includes(key) }).toEqual({ file, key, present: false })
    }
    expect(src).not.toContain('invoice-visibility')
  })
})

// ─────────────────────────────────────────────────────────────────────────
// The whole point: does any of it reach the paper?
// ─────────────────────────────────────────────────────────────────────────

describe('the toggles reach the printed bill', () => {
  const SRC: InvoiceSource = {
    invoiceNo: 'RG/26-27/9',
    date: '2026-08-15T14:30:00',
    party: { name: 'Gupta Provision' },
    items: [{
      productName: 'Sunflower Oil', quantity: 3, unitPrice: 180, gstRate: 5,
      total: 567, unit: 'ltr', hsn: '1512',
      description: 'Refined pouch, cold pressed',
      enteredQuantity: 3000, enteredUnit: 'ml',
    }],
    subtotal: 540, discountAmount: 0, cgst: 13.5, sgst: 13.5, igst: 0,
    totalAmount: 567, paidAmount: 0, paymentMode: 'cash',
    partyBalance: 12400,
  }

  const SHOP: InvoiceShop = { name: 'Rahul Grocery', state: 'Bihar' }

  const render = async (show: Partial<Record<VisibilityKey, boolean>>): Promise<string> => {
    const blob = await generateInvoicePDF(
      buildInvoiceDocument(SRC, { ...SHOP, show }),
      { themeId: 'classic' },
    )
    return new Promise<string>((resolve, reject) => {
      const r = new FileReader()
      r.onload = () => resolve(String(r.result))
      r.onerror = () => reject(new Error('could not read the PDF'))
      r.readAsBinaryString(blob)
    })
  }

  it('prints the description only when it is switched on', async () => {
    expect((await render({ showItemDescription: true })).includes('cold pressed')).toBe(true)
    // The ABSENCE half. A test that only checks the field is PRESENT passes
    // just as happily on a renderer that ignores the switch entirely — which
    // is precisely how a hardcoded palette survived its first guard.
    expect((await render({})).includes('cold pressed')).toBe(false)
  }, 60000)

  it('prints the unit as typed only when it is switched on', async () => {
    expect((await render({ showAlternateUnit: true })).includes('3000 ml')).toBe(true)
    expect((await render({})).includes('3000 ml')).toBe(false)
  }, 60000)

  it('prints the outstanding balance only when it is switched on', async () => {
    expect((await render({ showPartyBalance: true })).includes('Outstanding')).toBe(true)
    expect((await render({})).includes('Outstanding')).toBe(false)
  }, 60000)

  it('never prints an outstanding balance that is zero or a credit', async () => {
    // "Outstanding ₹0" is noise; a negative reads as a demand for money the
    // customer is actually owed.
    const nothingOwed = buildInvoiceDocument(
      { ...SRC, partyBalance: 0 }, { ...SHOP, show: { showPartyBalance: true } },
    )
    expect(nothingOwed.partyBalanceLabel).toBeNull()

    const inCredit = buildInvoiceDocument(
      { ...SRC, partyBalance: -500 }, { ...SHOP, show: { showPartyBalance: true } },
    )
    expect(inCredit.partyBalanceLabel).toBeNull()
  })

  it('prints the time only when it is switched on', () => {
    const on = buildInvoiceDocument(SRC, { ...SHOP, show: { showInvoiceTime: true } })
    expect(on.timeLabel).toMatch(/02:30|2:30/)
    expect(buildInvoiceDocument(SRC, SHOP).timeLabel).toBeNull()
  })
})

describe('one mapper builds the shop everywhere', () => {
  /*
   * The download, the WhatsApp picture, the live preview and the shared link
   * each used to build this object by hand. The link's copy was already a
   * release behind — it dropped the terms, the bank block and the signature
   * that Phase 3 added, so a customer opening the link got a different bill
   * from one sent the same invoice as a PDF.
   */
  it('carries the Phase 3 content and the Phase 4 switches', () => {
    const shop = invoiceShopFromSetting({
      shopName: 'Rahul Grocery',
      invoiceTerms: 'No returns',
      bankIfsc: 'SBIN0001234',
      signatureUrl: 'https://example.test/sig.png',
      showPartyBalance: true,
    })
    expect(shop.name).toBe('Rahul Grocery')
    expect(shop.terms).toBe('No returns')
    expect(shop.bank?.ifsc).toBe('SBIN0001234')
    expect(shop.signatureUrl).toBe('https://example.test/sig.png')
    expect(shop.show?.showPartyBalance).toBe(true)
  })

  it('survives a shop that has no settings row at all', () => {
    expect(invoiceShopFromSetting(null).name).toBe('My Shop')
  })

  it('is used by every screen that builds a bill', () => {
    for (const file of [
      'src/components/ledger/TransactionDetail.tsx',
      'src/components/settings/InvoiceSettingsPage.tsx',
    ]) {
      expect({ file, uses: readCode(file).includes('invoiceShopFromSetting') })
        .toEqual({ file, uses: true })
    }
  })
})
