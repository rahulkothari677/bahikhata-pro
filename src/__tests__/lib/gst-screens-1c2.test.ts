/**
 * Phase 1c-2 (2 Oct 2026) — a shop that is not registered never SEES GST;
 * every printed bill says what it legally is.
 *
 * Before: every printed sale said "TAX INVOICE" — a composition shop's bill
 * (which must be a Bill of Supply with the prescribed declaration), a
 * not-registered shop's bill (which may be no GST document at all), a credit
 * note and an estimate. And GSTR-1 / 3B / 9 sat in the menus of shops that
 * file none of them.
 */
import fs from 'fs'
import path from 'path'
import { documentTitle, saleDocumentTitle, billCarriesGstColumns, type GstStatus } from '@/lib/shop-tax'
import { BILL_OF_SUPPLY_DECLARATION } from '@/lib/composition-scheme'
import { invoiceShopFromSetting, buildInvoiceDocument } from '@/lib/invoice-document'
import { NAV_REGISTRY, filterByPermissions, showsForGstStatus } from '@/lib/nav-registry'

const ALL: GstStatus[] = ['unregistered', 'regular', 'composition']

describe('document titles', () => {
  test('a sale is a TAX INVOICE, a BILL OF SUPPLY or a plain BILL by status', () => {
    expect(saleDocumentTitle('regular')).toEqual({ title: 'TAX INVOICE', declaration: null })
    expect(saleDocumentTitle('composition')).toEqual({ title: 'BILL OF SUPPLY', declaration: BILL_OF_SUPPLY_DECLARATION })
    expect(saleDocumentTitle('unregistered')).toEqual({ title: 'BILL', declaration: null })
  })
  test('notes, estimates and purchases are never tax invoices, for any status', () => {
    for (const st of ALL) {
      expect(documentTitle('credit-note', st).title).toBe('CREDIT NOTE')
      expect(documentTitle('debit-note', st).title).toBe('DEBIT NOTE')
      expect(documentTitle('estimate', st).title).toBe('ESTIMATE')
      expect(documentTitle('purchase', st).title).toBe('PURCHASE BILL')
    }
  })
  test('the composition declaration is the prescribed wording', () => {
    expect(BILL_OF_SUPPLY_DECLARATION).toBe('Composition taxable person, not eligible to collect tax on supplies')
  })
})

describe('printed bill built from the shop\'s settings', () => {
  const base = { shopName: 'Agarwal General Store', gstin: '08AAPPR4321Q1ZY' }
  const src = (type: string) => ({
    type, invoiceNo: 'INV-1', date: new Date('2026-10-02T05:00:00Z'), items: [],
    subtotal: 100, discountAmount: 0, cgst: 0, sgst: 0, igst: 0, totalAmount: 100, paidAmount: 100,
  }) as any

  test('regular shop: TAX INVOICE with its GSTIN', () => {
    const shop = invoiceShopFromSetting({ ...base, gstRegistered: true })
    const doc = buildInvoiceDocument(src('sale'), shop)
    expect(doc.title).toBe('TAX INVOICE')
    expect(doc.declaration).toBeNull()
    expect(doc.shop.gstin).toBe(base.gstin)
  })
  test('composition shop: BILL OF SUPPLY with the declaration', () => {
    const shop = invoiceShopFromSetting({ ...base, gstRegistered: true, compositionCategory: 'trader' })
    const doc = buildInvoiceDocument(src('sale'), shop)
    expect(doc.title).toBe('BILL OF SUPPLY')
    expect(doc.declaration).toBe(BILL_OF_SUPPLY_DECLARATION)
  })
  test('not-registered shop: a plain BILL, and a stale GSTIN is not printed', () => {
    const shop = invoiceShopFromSetting({ ...base, gstRegistered: false })
    const doc = buildInvoiceDocument(src('sale'), shop)
    expect(doc.title).toBe('BILL')
    expect(doc.shop.gstin).toBeNull()
  })
  test('a credit note prints as a CREDIT NOTE, not a tax invoice', () => {
    const shop = invoiceShopFromSetting({ ...base, gstRegistered: true })
    expect(buildInvoiceDocument(src('credit-note'), shop).title).toBe('CREDIT NOTE')
  })
  test('a shop built by hand (no status) keeps the old regular title', () => {
    expect(buildInvoiceDocument(src('sale'), { name: 'X' }).title).toBe('TAX INVOICE')
  })
})

describe('menus show only this shop\'s GST returns', () => {
  const opts = (gstStatus?: GstStatus) => ({
    canAccess: () => true, isFlagEnabled: () => true, isOwner: true, isFounder: true, gstStatus,
  })
  const ids = (st?: GstStatus) => new Set(filterByPermissions(NAV_REGISTRY, opts(st)).map(d => d.id))
  const REGULAR_RETURNS = ['gstr-1', 'gstr-3b', 'gstr-2b', 'gst-summary', 'hsn-summary', 'gstr-9']

  test('not registered: no GST return at all', () => {
    const s = ids('unregistered')
    for (const id of [...REGULAR_RETURNS, 'composition-returns']) expect(s.has(id)).toBe(false)
  })
  test('regular: its returns, not CMP-08', () => {
    const s = ids('regular')
    for (const id of REGULAR_RETURNS) expect(s.has(id)).toBe(true)
    expect(s.has('composition-returns')).toBe(false)
  })
  test('composition: CMP-08 / GSTR-4, not GSTR-1 / 3B', () => {
    const s = ids('composition')
    expect(s.has('composition-returns')).toBe(true)
    for (const id of REGULAR_RETURNS) expect(s.has(id)).toBe(false)
  })
  test('status not loaded yet: show everything rather than flash a registered shop\'s returns away', () => {
    const s = ids(undefined)
    for (const id of [...REGULAR_RETURNS, 'composition-returns']) expect(s.has(id)).toBe(true)
  })
  test('entries with no GST requirement show for every status', () => {
    for (const st of ALL) expect(showsForGstStatus({}, st)).toBe(true)
  })
})

/**
 * THE CLASS: a renderer that types its own bill title will drift from the law
 * again (four did). Titles come from lib/shop-tax.ts documentTitle(); only the
 * places named here may spell one out.
 */
const TITLE_LITERAL = /(['"`>])(TAX INVOICE|Tax Invoice|INVOICE)(['"`<])/
const ALLOWED: Record<string, { count: number; why: string }> = {
  'src/lib/shop-tax.ts': { count: 1, why: 'The rule itself.' },
  'src/lib/invoice-pdf.ts': { count: 1, why: 'Compares against the rule\'s TAX INVOICE to add "ORIGINAL FOR RECIPIENT" (Rule 48).' },
  'src/lib/composition-scheme.ts': { count: 1, why: 'saleDocumentKind() — the older on-screen Bill of Supply notice; never printed.' },
}

function codeLines(source: string): string[] {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, b => b.replace(/[^\n]/g, ''))
    .replace(/(^|[ \t])\/\/[^\n]*/gm, (_m, lead) => lead)
    .split(/\r?\n/)
}

function sourceFiles(dir: string): string[] {
  const out: string[] = []
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      if (entry.name === '__tests__' || entry.name === 'node_modules') continue
      out.push(...sourceFiles(full))
    } else if (/\.(ts|tsx)$/.test(entry.name)) out.push(full)
  }
  return out
}

describe('guard — no hand-typed bill titles', () => {
  test('catches the old shapes', () => {
    expect(codeLines(`<h2>{isSale ? 'Tax Invoice' : 'Purchase Bill'}</h2>`).some(l => TITLE_LITERAL.test(l))).toBe(true)
    expect(codeLines(`<p className="x">INVOICE</p>`).some(l => TITLE_LITERAL.test(l))).toBe(true)
    expect(codeLines(`title: src.type === 'purchase' ? 'PURCHASE BILL' : 'TAX INVOICE',`).some(l => TITLE_LITERAL.test(l))).toBe(true)
  })
  test('ignores comments and the real title', () => {
    expect(codeLines(`// was 'TAX INVOICE' for everything\n<p>{doc.title}</p>`).some(l => TITLE_LITERAL.test(l))).toBe(false)
  })
  test('sweep: only the named places spell out a title', () => {
    const root = path.join(__dirname, '..', '..')
    const counts: Record<string, number> = {}
    for (const file of sourceFiles(root)) {
      const rel = path.relative(path.join(root, '..'), file).replace(/\\/g, '/')
      const n = codeLines(fs.readFileSync(file, 'utf8')).filter(l => TITLE_LITERAL.test(l)).length
      if (n) counts[rel] = n
    }
    const unexpected = Object.keys(counts).filter(k => !ALLOWED[k])
    expect(unexpected).toEqual([])
    for (const [rel, { count }] of Object.entries(ALLOWED)) expect(counts[rel] ?? 0).toBe(count)
  })
})
