/**
 * Phase 7g-2 — what a bill with no party is called, and the purchase's own needs
 * (#202, #189, #322, #323, #324).
 *
 *  - #202: a purchase with no supplier read "Walk-in Customer" on the bill
 *    screen, the printed bill, the PDF, Home's recent list, search and Ask.
 *    One rule now (lib/walk-in-party.ts): sale side "Walk-in Customer",
 *    supplier side "Cash purchase"; an expense its payee or category.
 *  - #322: the party card on a credit note or estimate was titled "Supplier".
 *  - #323: the edit dialog treated an estimate or credit note as a purchase —
 *    picking an item filled the PURCHASE rate and offered suppliers.
 *  - #324: the printed sale bill (handed to the customer) showed "Profit: ₹…".
 *  - 7g / #189: a purchase asks for the supplier's bill number AND date first;
 *    one date field per screen.
 */
import { noPartyName, billPartyName, isSupplierSide, CASH_PURCHASE_NAME, WALK_IN_PARTY_NAME } from '@/lib/walk-in-party'
import { buildInvoiceDocument, type InvoiceSource } from '@/lib/invoice-document'
import { readCode, balancedBlock } from '@/test-support/read-source'
import { readdirSync, readFileSync, statSync } from 'fs'
import { join, relative } from 'path'

describe('one name for a bill with no party (#202)', () => {
  test('supplier side is a cash purchase; sale side the walk-in customer', () => {
    expect(noPartyName('purchase')).toBe(CASH_PURCHASE_NAME)
    expect(noPartyName('debit-note')).toBe(CASH_PURCHASE_NAME)
    for (const t of ['sale', 'estimate', 'credit-note', undefined, null]) expect(noPartyName(t)).toBe(WALK_IN_PARTY_NAME)
    expect(noPartyName('expense')).toBe('Expense')
    expect(noPartyName('income')).toBe('Income')
  })
  test('a listed name: the party, else the payee, else an entry\'s category, else the rule', () => {
    expect(billPartyName({ type: 'purchase', party: { name: 'Shree Ram Traders' } })).toBe('Shree Ram Traders')
    expect(billPartyName({ type: 'purchase', party: null })).toBe('Cash purchase')
    expect(billPartyName({ type: 'expense', payeeName: 'Ramesh (electrician)', category: 'Repairs' })).toBe('Ramesh (electrician)')
    expect(billPartyName({ type: 'expense', category: 'Rent' })).toBe('Rent')
    expect(billPartyName({ type: 'sale', category: 'ignored on a sale' })).toBe('Walk-in Customer')
  })
  test('supplier side is purchase and debit note only', () => {
    expect(['sale', 'purchase', 'credit-note', 'debit-note', 'estimate', 'income', 'expense'].filter(isSupplierSide)).toEqual(['purchase', 'debit-note'])
  })
  test('the shared bill document carries the heading and the name for the PDF', () => {
    const src: InvoiceSource = {
      invoiceNo: 'PUR-0001', date: '2026-10-02', party: null, items: [],
      subtotal: 230, discountAmount: 0, cgst: 5.75, sgst: 5.75, igst: 0, totalAmount: 241.5, paidAmount: 241.5, paymentMode: 'cash',
    }
    const purchase = buildInvoiceDocument({ ...src, type: 'purchase' }, { name: 'Sharma Kirana' })
    expect([purchase.partyHeading, purchase.noPartyName]).toEqual(['Supplier', 'Cash purchase'])
    const sale = buildInvoiceDocument({ ...src, type: 'sale' }, { name: 'Sharma Kirana' })
    expect([sale.partyHeading, sale.noPartyName]).toEqual(['Bill To', 'Walk-in Customer'])
  })
})

/**
 * Hand-written "no party" names — `party?.name || 'Walk-in…'` and the like —
 * outside the rule. Returns each match.
 */
function walkInFallbacks(code: string): string[] {
  return code.match(/(?:party\??\.name|partyName)\s*(?:\|\||\?\?)\s*(?:\([^)]*)?'Walk-in[^']*'/g) || []
}

/** Files allowed one, and why. */
const ALLOWED: Record<string, string> = {
  'lib/walk-in-party.ts': 'the rule itself',
  // Bills list: sale branch only; the purchase branch says t('bills.cash_purchase') (bills-screen.test.ts locks it).
  'components/ledger/Ledger.tsx': 'sale branch of an isSale ternary',
  // The GSTR-1 CSV lists outward supplies only — every row is a sale.
  'app/api/gstr-export/route.ts': 'sales register',
  // Logged #325: a Tally cash-purchase voucher's party ledger needs checking against Tally's format first.
  'lib/tally-export.ts': '#325',
}

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) {
      if (name !== '__tests__' && name !== 'test-support') sourceFiles(p, out)
    } else if (/\.(ts|tsx)$/.test(name)) out.push(p)
  }
  return out
}

describe('no screen names a party-less bill by hand (#202)', () => {
  test('the check finds the old shapes', () => {
    expect(walkInFallbacks("const who = invoice.party?.name || 'Walk-in Customer'")).toHaveLength(1)
    expect(walkInFallbacks("`${t.party?.name || 'Walk-in'} • x`")).toHaveLength(1)
    expect(walkInFallbacks("partyName: t.party?.name || t.payeeName || 'Walk-in customer',")).toHaveLength(0) // payee in between: see next
    expect(walkInFallbacks("{txn.partyName || 'Walk-in Customer'}")).toHaveLength(1)
    expect(walkInFallbacks("t.party?.name || (isSale ? 'Walk-in' : 'Cash purchase')")).toHaveLength(1)
    expect(walkInFallbacks('txn.party?.name || noPartyName(txn.type)')).toHaveLength(0)
  })
  test('only the allowed files have one', () => {
    const src = join(process.cwd(), 'src')
    const found: string[] = []
    for (const f of sourceFiles(src)) {
      const rel = relative(src, f).split('\\').join('/')
      const raw = readFileSync(f, 'utf8')
      const hits = walkInFallbacks(raw).concat(raw.match(/payeeName\s*\|\|\s*'Walk-in[^']*'/g) || [])
      if (hits.length && !ALLOWED[rel]) found.push(`${rel}: ${hits.join(' ; ')}`)
    }
    expect(found).toEqual([])
  })
})

const detail = readCode('components/ledger/TransactionDetail.tsx')

describe('the bill screen and its print', () => {
  test('#322: the party card heading follows the party\'s side', () => {
    const screen = balancedBlock(detail, 'export function TransactionDetail() {')
    expect(screen).toContain("{isSupplierSide(txn.type) ? 'Supplier' : 'Customer'}")
    expect(screen).not.toContain("isSale ? 'Customer' : 'Supplier'")
  })
  test('#323: the edit dialog counts an estimate and a credit note as the sale side', () => {
    // Sliced to the next function: balancedBlock would stop at the props type in its signature.
    const at = detail.indexOf('function EditTransactionDialog(')
    const end = detail.indexOf('function PrintInvoice(', at)
    expect(at).toBeGreaterThan(-1)
    expect(end).toBeGreaterThan(at)
    const body = detail.slice(at, end)
    expect(body).toContain('const isSale = !!transaction && !isIncomeOrExpense && !isSupplierSide(transaction.type)')
    expect(body).not.toMatch(/const isSale = transaction\?\.type === 'sale'/)
  })
  test('#324: the printed bill carries no profit', () => {
    const p0 = detail.indexOf('function PrintInvoiceContent(')
    const p1 = detail.indexOf('function formatAuditValue(', p0)
    expect(p0).toBeGreaterThan(-1)
    expect(p1).toBeGreaterThan(p0)
    const print = detail.slice(p0, p1)
    expect(print).toContain('Supply Details')
    expect(print).not.toMatch(/grossProfit|Profit:/)
  })
})

describe('a purchase asks for the supplier\'s bill number and date first (7g, #189)', () => {
  const entry = readCode('components/ledger/TransactionEntry.tsx')
  const PURCHASE_BLOCK = '{!isSale && (\n                <div className="mt-3 pt-3 border-t border-border grid'
  const DETAILS_BLOCK = '{isSale && (\n                <div className="grid grid-cols-2 gap-3">'

  function block(code: string, marker: string): string {
    const m = code.includes(marker) ? marker : marker.replace(/\n/g, '\r\n')
    expect(code.includes(m)).toBe(true)
    return balancedBlock(code, m)
  }

  test('the date sits in the supplier\'s-bill block, beside the number', () => {
    const top = block(entry, PURCHASE_BLOCK)
    expect(top).toContain('id="field-supplier-bill-no"')
    expect(top).toContain('id="field-date"')
    expect(top).toContain('Bill date')
  })
  test('one date field per screen: Details shows it on a sale only', () => {
    expect(entry.split('id="field-date"').length - 1).toBe(2)
    expect(block(entry, DETAILS_BLOCK)).toContain('id="field-date"')
  })
  test('#189: "needed to claim GST" sits under the field, not beside the label', () => {
    const top = block(entry, PURCHASE_BLOCK)
    const label = top.indexOf('Supplier&apos;s bill no.</Label>')
    const input = top.indexOf('id="field-supplier-bill-no"')
    const tag = top.indexOf('Needed to claim GST')
    expect(label).toBeGreaterThan(-1)
    expect(tag).toBeGreaterThan(input)
  })
})
