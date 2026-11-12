/**
 * 🔒 GUARD (#110, 1 Nov 2026): reverse charge and credit notes on another
 * period's bill cannot open a gap between GSTR-1 and GSTR-3B in EkBook.
 *
 * The CA review expected them as "normal differences" the comparison should
 * explain. Checked against the code: the two sides compared are both gross of
 * credit notes, and neither carries reverse-charge tax. These tests pin the
 * facts that make that true. If one changes, a correct return would show a
 * false mismatch — and this fails first.
 */
import { readCode } from '@/test-support/read-source'
import { reconcileReturns } from '@/lib/gst-reconciliation'

const tx = readCode('src/app/api/transactions/route.ts')
const g1 = readCode('src/app/api/gstr-1/route.ts')
const g3 = readCode('src/app/api/gstr-3b/route.ts')
const recon = readCode('src/app/api/gst-reconciliation/route.ts')

test('a sale can never be reverse charge', () => {
  expect(tx).toContain("isReverseCharge: type === 'purchase' ? !!isReverseCharge : false")
})

test('3B output tax compared is sales (not RCM) plus advances — no credit notes', () => {
  expect(g3).toMatch(/where: \{ userId, type: 'sale', deletedAt: null, isReverseCharge: false,/)
  expect(g3).toMatch(/const outwardCgst = roundMoney\(\(outwardSalesAgg\._sum\.cgst \|\| 0\) \+ advanceAdded\.cgst - advanceReleased\.cgst\)/)
  expect(g3).toContain('const totalOutputTax = roundMoney(outwardCgst + outwardSgst + outwardIgst)')
})

test('GSTR-1 summary compared is sales only — no credit notes', () => {
  expect(g1).toContain("const sales = builderTxns.filter(t => t.type === 'sale')")
  expect(g1).toContain('totalOutputTax: roundMoney(sales.reduce((s, t) => s + t.cgst + t.sgst + t.igst, 0)),')
})

test('the comparison reads exactly those two figures', () => {
  // 9b-3: GSTR-1 through gstr1Declared — the summary, or once filed the snapshot,
  // which stores the SAME sales-only totals (`...totals`), so the basis is unchanged.
  expect(recon).toContain('const declared = gstr1Declared(g1)')
  expect(recon).toContain('gstr1InvoiceTax: declared.tax,')
  expect(g1).toContain('filedTotalOutputTax: existingSnapshot.totalOutputTax,')
  expect(g1.match(/\.\.\.totals,/g)?.length).toBe(2)
  expect(recon).toContain('gstr3bOutputTax: g3.totalOutputTax || 0')
})

test('worked: same sales on both sides, a credit note anywhere → still matched', () => {
  // ₹10,000 sales at 5% = ₹500 on both sides; a ₹100 credit note on a last-month
  // bill changes neither compared figure, so nothing is left unexplained.
  const r = reconcileReturns({
    gstr1InvoiceTax: 500, gstr1InvoiceTaxable: 10000, gstr3bOutputTax: 500, gstr3bTaxable: 10000,
    advanceTaxReceived: 0, advanceTaxableReceived: 0, advanceTaxReleased: 0, advanceTaxableReleased: 0, nilExemptNonGst: 0,
  })
  expect(r.matched).toBe(true)
  expect(r.reconcilingItems).toEqual([])
})
