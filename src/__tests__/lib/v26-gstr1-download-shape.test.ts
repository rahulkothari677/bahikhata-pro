/**
 * V26 BUG-054 — Regression test: GSTR-1 JSON download must NOT be wrapped in
 * an outer { gstr1: ... } envelope.
 *
 * The GST portal's JSON schema requires `gstin` and `fp` (along with every
 * other top-level field) to sit at the ROOT of the file, not nested inside
 * a `"gstr1"` wrapper. Before BUG-054, the download did
 * `JSON.stringify({ gstr1: data.gstr1 })` which produced:
 *
 *   { "gstr1": { "gstin": "...", "fp": "...", ... } }
 *
 * Portal validators reject this with "Missing required key(s): gstin, fp" —
 * they're not missing from the data, just nested one level too deep.
 *
 * This test replicates the download handler's stringification logic and
 * asserts the output has `gstin` + `fp` at the root, with NO `gstr1` wrapper
 * key. It also reads the component source to assert the fix is in place
 * (structural guardrail — if a future refactor re-introduces the wrapper,
 * this test fails).
 */

import { describe, test, expect } from '@jest/globals'
import * as fs from 'fs'
import * as path from 'path'
import { buildGstr1, type Gstr1Transaction, type Gstr1Item, type ShopInfo } from '@/lib/gstr1-builder'

// ─── Fixtures (same as gstr1-builder.test.ts) ───────────────────────────

const SHOP: ShopInfo = {
  gstin: '27ABCDE1234F1Z5',
  state: 'Maharashtra',
  stateCode: '27',
}

const SALE_ITEM: Gstr1Item = {
  productId: 'p1', productName: 'Rice 1kg', hsn: '1006',
  quantity: 20, unit: 'kg', unitPrice: 50, gstRate: 18,
  discountAmount: 0, cgst: 90, sgst: 90, igst: 0, csamt: 0,
}

const B2B_SALE: Gstr1Transaction = {
  id: 't1', type: 'sale', invoiceNo: 'INV-001', date: new Date('2026-07-15'),
  totalAmount: 1180, subtotal: 1000, discountAmount: 0,
  cgst: 90, sgst: 90, igst: 0, isInterState: false, isReverseCharge: false,
  partyId: 'party1', partyName: 'Rahul Traders', partyGstin: '27AAAPL1234C1Z5', partyState: 'Maharashtra',
  items: [SALE_ITEM],
}

// ─── Download shape tests ───────────────────────────────────────────────

describe('V26 BUG-054 — GSTR-1 JSON download must not be wrapped in { gstr1: ... }', () => {
  // The API response shape is { period, gstr1, summary, snapshot, shop }.
  // The component extracts data.gstr1 and stringifies it for download.
  // The download must be the gstr1 object DIRECTLY — not wrapped.
  const apiResponseShape = {
    period: { monthYear: '072026', monthLabel: 'July 2026' },
    gstr1: buildGstr1([B2B_SALE], SHOP, '072026', { priorFyTurnover: 500000 }),
    summary: { totalTaxableValue: 1000, totalOutputTax: 180 },
    snapshot: null,
    shop: { gstin: '27ABCDE1234F1Z5', stateCode: '27' },
  }

  test('THE BUG (regression): download must NOT wrap gstr1 in an outer object', () => {
    // OLD (buggy): JSON.stringify({ gstr1: data.gstr1 }, null, 2)
    // NEW (fixed): JSON.stringify(data.gstr1, null, 2)
    const fixedDownload = JSON.stringify(apiResponseShape.gstr1, null, 2)
    const buggyDownload = JSON.stringify({ gstr1: apiResponseShape.gstr1 }, null, 2)

    // The fixed download must have gstin + fp at the ROOT
    const parsed = JSON.parse(fixedDownload)
    expect(parsed).toHaveProperty('gstin')
    expect(parsed).toHaveProperty('fp')
    expect(parsed.gstin).toBe('27ABCDE1234F1Z5')
    expect(parsed.fp).toBe('072026')

    // The fixed download must NOT have a "gstr1" wrapper key
    expect(parsed).not.toHaveProperty('gstr1')

    // The buggy download WOULD have a "gstr1" wrapper (this is what we fixed)
    const buggyParsed = JSON.parse(buggyDownload)
    expect(buggyParsed).toHaveProperty('gstr1')
    expect(buggyParsed.gstr1).toHaveProperty('gstin')
    expect(buggyParsed).not.toHaveProperty('gstin')  // gstin is nested, not at root
  })

  test('downloaded JSON has all required GSTN top-level fields at root', () => {
    const download = JSON.stringify(apiResponseShape.gstr1, null, 2)
    const parsed = JSON.parse(download)

    // GSTN offline-tool schema required top-level fields
    expect(parsed).toHaveProperty('gstin')
    expect(parsed).toHaveProperty('fp')
    expect(parsed).toHaveProperty('gt')
    expect(parsed).toHaveProperty('cur_gt')
    expect(parsed).toHaveProperty('b2b')
    expect(parsed).toHaveProperty('b2cl')
    expect(parsed).toHaveProperty('b2cs')
    expect(parsed).toHaveProperty('cdnr')
    expect(parsed).toHaveProperty('cdnur')
    expect(parsed).toHaveProperty('hsn')
    expect(parsed).toHaveProperty('nil')
    expect(parsed).toHaveProperty('doc_issue')
  })

  test('downloaded JSON starts with { "gstin" (not { "gstr1")', () => {
    // The first key in the stringified JSON (after the opening brace + whitespace)
    // should be "gstin", not "gstr1". This is a quick textual check.
    const download = JSON.stringify(apiResponseShape.gstr1, null, 2)
    expect(download.trimStart()).toMatch(/^\{\s*"gstin"/)
    expect(download.trimStart()).not.toMatch(/^\{\s*"gstr1"/)
  })

  test('component source does NOT wrap gstr1 in download handler', () => {
    // Structural guardrail: read the component source and assert the download
    // handler stringifies data.gstr1 directly (not wrapped in { gstr1: ... }).
    // If a future refactor re-introduces the wrapper, this test fails.
    const src = fs.readFileSync(
      path.join(process.cwd(), 'src/components/reports/Gstr1Report.tsx'),
      'utf8',
    )

    // Find the handleDownloadJSON function body
    const downloadHandlerMatch = src.match(/handleDownloadJSON[\s\S]*?sonnerToast\.success\('GSTR-1 JSON downloaded/)
    expect(downloadHandlerMatch).not.toBeNull()
    const handlerBody = downloadHandlerMatch![0]

    // Strip comments before checking (the explanatory comment mentions the
    // buggy pattern — we only want to check actual code).
    const codeOnly = handlerBody
      .replace(/\/\*[\s\S]*?\*\//g, '')   // block comments
      .replace(/\/\/.*$/gm, '')           // line comments

    // The fixed code: JSON.stringify(data.gstr1, null, 2)
    expect(codeOnly).toMatch(/JSON\.stringify\(data\.gstr1,\s*null,\s*2\)/)

    // The buggy code (must NOT be present in actual code): JSON.stringify({ gstr1: data.gstr1 }, null, 2)
    expect(codeOnly).not.toMatch(/JSON\.stringify\(\s*\{\s*gstr1:\s*data\.gstr1\s*\}/)
  })
})
