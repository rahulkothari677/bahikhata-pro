/**
 * V26 Batch 8 — Regression tests for BUG-056 (doc_issue CUID fallback) and
 * M11 SQL COALESCE fix (NULL paidAmount handling).
 *
 * BUG-056: buildDOC was using `t.invoiceNo || t.id` as the document number.
 * When invoiceNo is missing, `t.id` is a CUID (~25 chars). The GST portal
 * requires `from`/`to` to be ≤ 16 characters. Fix: only use NUMBERED
 * invoices for from/to; unnumbered are still counted in totnum.
 *
 * M11 SQL fix: getReceivablePayable's raw SQL used
 * `("totalAmount" - "paidAmount")` — if paidAmount is NULL, the expression
 * is NULL, and SUM skips the row. Prisma's aggregate treats NULL as 0
 * (via `_sum.paidAmount || 0`). Fix: use `COALESCE("paidAmount", 0)`.
 */

import { describe, test, expect } from '@jest/globals'
import * as fs from 'fs'
import * as path from 'path'
import { buildDOC, type Gstr1Transaction, type Gstr1Item } from '@/lib/gstr1-builder'

// ─── Fixtures ───────────────────────────────────────────────────────────

const SALE_ITEM: Gstr1Item = {
  productId: 'p1', productName: 'Rice 1kg', hsn: '1006',
  quantity: 10, unit: 'kg', unitPrice: 100, gstRate: 18,
  discountAmount: 0, cgst: 90, sgst: 90, igst: 0, csamt: 0,
}

function makeSale(id: string, invoiceNo: string | null): Gstr1Transaction {
  return {
    id, type: 'sale', invoiceNo, date: new Date('2026-07-15'),
    totalAmount: 1180, subtotal: 1000, discountAmount: 0,
    cgst: 90, sgst: 90, igst: 0, isInterState: false, isReverseCharge: false,
    partyId: 'party1', partyName: 'Customer', partyGstin: '27AAAPL1234C1Z5', partyState: 'Maharashtra',
    items: [SALE_ITEM],
  }
}

// ─── BUG-056: doc_issue must not use CUID as invoice number ────────────

describe('V26 BUG-056 — doc_issue must not use CUID as invoice number fallback', () => {
  test('all sales numbered → from/to use invoice numbers', () => {
    const sales = [
      makeSale('t1', 'INV-0001'),
      makeSale('t2', 'INV-0002'),
      makeSale('t3', 'INV-0003'),
    ]
    const result = buildDOC(sales)
    const doc = result.doc_det.find(d => d.doc_num === 1)
    expect(doc).toBeDefined()
    expect(doc!.docs[0].from).toBe('INV-0001')
    expect(doc!.docs[0].to).toBe('INV-0003')
    expect(doc!.docs[0].totnum).toBe(3)
  })

  test('THE BUG: unnumbered sale does NOT produce CUID in from/to', () => {
    // Sale t2 has no invoiceNo — its CUID is 'cmr6104vi0001la04oo97jpln' (25 chars).
    // Before fix: from='INV-0001', to='cmr6104vi0001la04oo97jpln' (CUID — portal rejects).
    // After fix: from='INV-0001', to='INV-0003' (only numbered invoices in range).
    const sales = [
      makeSale('t1', 'INV-0001'),
      makeSale('cmr6104vi0001la04oo97jpln', null),  // unnumbered — CUID would be 25 chars
      makeSale('t3', 'INV-0003'),
    ]
    const result = buildDOC(sales)
    const doc = result.doc_det.find(d => d.doc_num === 1)
    expect(doc).toBeDefined()
    expect(doc!.docs[0].from).toBe('INV-0001')
    expect(doc!.docs[0].to).toBe('INV-0003')  // NOT the CUID
    expect(doc!.docs[0].totnum).toBe(3)  // count includes unnumbered
  })

  test('all sales unnumbered → from/to are empty, totnum is correct', () => {
    const sales = [
      makeSale('cuid1', null),
      makeSale('cuid2', null),
    ]
    const result = buildDOC(sales)
    const doc = result.doc_det.find(d => d.doc_num === 1)
    expect(doc).toBeDefined()
    expect(doc!.docs[0].from).toBe('')
    expect(doc!.docs[0].to).toBe('')
    expect(doc!.docs[0].totnum).toBe(2)
  })

  test('from/to values are ≤ 16 characters (GST portal limit)', () => {
    const sales = [
      makeSale('t1', 'INV-0001'),
      makeSale('t2', 'INV-0002'),
      makeSale('cmr6104vi0001la04oo97jpln', null),  // CUID — would exceed 16 chars
    ]
    const result = buildDOC(sales)
    const doc = result.doc_det.find(d => d.doc_num === 1)
    expect(doc).toBeDefined()
    expect(doc!.docs[0].from.length).toBeLessThanOrEqual(16)
    expect(doc!.docs[0].to.length).toBeLessThanOrEqual(16)
  })

  test('credit notes: same fix — no CUID fallback for from/to', () => {
    const cn1: Gstr1Transaction = {
      ...makeSale('t1', 'CN-0001'),
      type: 'credit-note', id: 't1',
    }
    const cn2: Gstr1Transaction = {
      ...makeSale('cmr6104vi0001la04oo97jpln', null),
      type: 'credit-note', id: 'cmr6104vi0001la04oo97jpln',
    }
    const result = buildDOC([cn1, cn2])
    const doc = result.doc_det.find(d => d.doc_num === 2)
    expect(doc).toBeDefined()
    expect(doc!.docs[0].from).toBe('CN-0001')
    expect(doc!.docs[0].to).toBe('CN-0001')  // NOT the CUID
    expect(doc!.docs[0].totnum).toBe(2)
  })

  test('component source does not use t.id as invoiceNo fallback', () => {
    // Structural guardrail: read the source and assert the fix is in place.
    // If a future refactor re-introduces `t.invoiceNo || t.id`, this fails.
    const src = fs.readFileSync(
      path.join(process.cwd(), 'src/lib/gstr1-builder.ts'),
      'utf8',
    )

    // The buildDOC function body
    const buildDocMatch = src.match(/export function buildDOC[\s\S]*?return \{ doc_det \}/)
    expect(buildDocMatch).not.toBeNull()
    const body = buildDocMatch![0]

    // Strip comments
    const codeOnly = body
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\/\/.*$/gm, '')

    // The buggy pattern (must NOT be present): t.invoiceNo || t.id
    expect(codeOnly).not.toMatch(/\.invoiceNo\s*\|\|\s*\.id/)

    // The fixed pattern: filter to numbered invoices
    expect(codeOnly).toMatch(/\.invoiceNo\s*&&\s*.*\.trim\(\)\.length/)
  })
})

// ─── M11 SQL COALESCE fix ─────────────────────────────────────────────

describe('V26 M11 — getReceivablePayable SQL uses COALESCE for NULL paidAmount', () => {
  // Read the source file once at module level.
  const PARTY_BALANCE_SRC = fs.readFileSync(
    path.join(process.cwd(), 'src/lib/party-balance.ts'),
    'utf8',
  )

  test('SQL source uses COALESCE("paidAmount", 0) in all 4 transaction SUM cases', () => {
    // Strip comments first (the explanatory comment also mentions COALESCE)
    const codeOnly = PARTY_BALANCE_SRC
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\/\/.*$/gm, '')
      .replace(/--.*$/gm, '')

    // Count occurrences of COALESCE("paidAmount", 0) — should be 4
    // (sale, purchase, credit-note, debit-note)
    const coalesceMatches = codeOnly.match(/COALESCE\(\s*"paidAmount"\s*,\s*0\s*\)/g)
    expect(coalesceMatches).not.toBeNull()
    expect(coalesceMatches!.length).toBe(4)
  })

  test('SQL source uses COALESCE("amount", 0) in both Payment SUM cases', () => {
    const codeOnly = PARTY_BALANCE_SRC
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\/\/.*$/gm, '')
      .replace(/--.*$/gm, '')

    // Count occurrences of COALESCE("amount", 0) — should be 2 (received, paid)
    const coalesceAmountMatches = codeOnly.match(/COALESCE\(\s*"amount"\s*,\s*0\s*\)/g)
    expect(coalesceAmountMatches).not.toBeNull()
    expect(coalesceAmountMatches!.length).toBe(2)
  })

  test('SQL source does NOT use bare totalAmount-minus-paidAmount without COALESCE', () => {
    // Strip JS comments AND SQL comments (the source contains both)
    const codeOnly = PARTY_BALANCE_SRC
      .replace(/\/\*[\s\S]*?\*\//g, '')   // JS block comments
      .replace(/\/\/.*$/gm, '')           // JS line comments
      .replace(/--.*$/gm, '')             // SQL line comments (inside template literals)

    // The buggy pattern: "totalAmount" minus "paidAmount" without COALESCE
    expect(codeOnly).not.toMatch(/"totalAmount"\s*-\s*"paidAmount"/)
  })
})
