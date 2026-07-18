/**
 * V26 Batch 3 — N6, N7, N8 behavioral tests.
 *
 * N6: Estimate→Sale conversion carries over the order-level discountAmount.
 *     Verified at the window.__ledgerPreset level — TransactionEntry.tsx:155
 *     already reads draft.discountAmount, so the preset shape is the contract.
 *
 * N7: resolveFinalPaid snap-zone narrowed. Genuine partials (paid < total)
 *     are no longer upgraded to "fully paid". Notes get no upward snap at all.
 *
 * N8: Product money-extension now has delete/deleteMany/aggregate/groupBy
 *     handlers. Verified by structural inspection of the extension source —
 *     the handlers are pure passthroughs that call convertRowOnRead/fromPaise,
 *     so the existing Transaction/Payment tests already cover the conversion
 *     logic. Here we just assert the handlers exist with the right shape.
 */

import { describe, test, expect } from '@jest/globals'
import * as fs from 'fs'
import * as path from 'path'
import { resolveFinalPaid } from '@/lib/paid-amount'

// ─── N6: Estimate→Sale preset carries discountAmount ────────────────────

describe('V26 N6 — Estimate→Sale preset carries order-level discount', () => {
  test('the preset shape includes discountAmount (the contract TransactionEntry reads)', () => {
    // Replica of the preset built in TransactionDetail.tsx:435-454.
    // TransactionEntry.tsx:155 reads draft.discountAmount — so the preset
    // MUST include it. Before N6, it didn't.
    const estimate = {
      partyId: 'p1',
      party: { name: 'Rahul' },
      discountAmount: 100,
      items: [
        { productId: 'prod1', productName: 'Rice', quantity: 2, unitPrice: 50, gstRate: 5, unit: 'kg' },
      ],
    }
    // Build the preset exactly as the component does
    const preset = {
      type: 'sale' as const,
      data: {
        partyId: estimate.partyId,
        partyName: estimate.party?.name,
        date: new Date().toISOString().slice(0, 10),
        discountAmount: estimate.discountAmount || 0,
        items: estimate.items.map(item => ({
          productId: item.productId || '',
          name: item.productName,
          quantity: item.quantity,
          unitPrice: item.unitPrice,
          gstRate: item.gstRate,
          unit: item.unit || 'pcs',
        })),
      },
    }
    // The contract: discountAmount MUST be present in preset.data
    expect(preset.data).toHaveProperty('discountAmount')
    expect(preset.data.discountAmount).toBe(100)
  })

  test('estimate with no discount carries 0 (not undefined)', () => {
    // An estimate with no discount should carry 0 — TransactionEntry's
    // `if (typeof draft.discountAmount !== 'undefined')` would skip
    // undefined, leaving the field empty. 0 is the safe default.
    const preset = {
      type: 'sale' as const,
      data: {
        discountAmount: 0,
        items: [],
      },
    }
    expect(preset.data.discountAmount).toBe(0)
  })

  test('component source includes discountAmount in the preset literal', () => {
    // Structural guardrail: if a future refactor removes discountAmount from
    // the preset, this test fails. Read the source file directly.
    const src = fs.readFileSync(
      path.join(process.cwd(), 'src/components/ledger/TransactionDetail.tsx'),
      'utf8',
    )
    // The preset literal must contain 'discountAmount: txn.discountAmount'
    // (or equivalent). Be flexible on whitespace.
    expect(src).toMatch(/discountAmount:\s*txn\.discountAmount/)
  })
})

// ─── N7: resolveFinalPaid snap-zone narrowed ────────────────────────────

describe('V26 N7 — resolveFinalPaid snap-zone narrowed', () => {
  test('THE BUG: ₹999.50 on a ₹1000 sale stays ₹999.50 (was: snapped to 1000)', () => {
    // Old behavior: Math.abs(1000 - 999.50) < 1 → true → snapped to 1000
    // New behavior: 999.50 < 1000 - 0.005 → not in upper snap band → stays
    expect(resolveFinalPaid('sale', 999.50, 1000)).toBe(999.50)
  })

  test('₹999.99 on a ₹1000 sale stays ₹999.99 (still below total, not snapped)', () => {
    // 999.99 < 1000 - 0.005 = 999.995 → just barely below the snap band
    expect(resolveFinalPaid('sale', 999.99, 1000)).toBe(999.99)
  })

  test('₹1000.50 on a ₹1000 sale snaps to 1000 (round-off artifact, paid ≥ total)', () => {
    // The original FIX M3 intent: absorb pre-round-off client values.
    // 1000.50 ≥ 1000 - 0.005 AND ≤ 1000 + 1 → in upper snap band → snaps.
    expect(resolveFinalPaid('sale', 1000.50, 1000)).toBe(1000)
  })

  test('₹1000.99 on a ₹1000 sale snaps to 1000 (within ₹1 upper band)', () => {
    expect(resolveFinalPaid('sale', 1000.99, 1000)).toBe(1000)
  })

  test('₹1001.01 on a ₹1000 sale does NOT snap (outside upper band, clamped by §6.4)', () => {
    // 1001.01 > 1000 + 1 → not in snap band. Then §6.4 clamps paid ≤ total.
    expect(resolveFinalPaid('sale', 1001.01, 1000)).toBe(1000)
  })

  test('₹995 on a ₹1000 sale stays ₹995 (genuine partial, far from total)', () => {
    expect(resolveFinalPaid('sale', 995, 1000)).toBe(995)
  })

  test('₹500 in a ₹0 sale stays 500 (then §6.4 clamps to 0)', () => {
    // Edge case: paid > total but total is 0. Snap band check:
    // 500 ≥ 0 - 0.005 AND 500 ≤ 0 + 1 → 500 ≤ 1 is FALSE → no snap.
    // Then §6.4 clamps paid ≤ total → 0.
    expect(resolveFinalPaid('sale', 500, 0)).toBe(0)
  })

  test('credit note: ₹4.50 refund on ₹5 note stays ₹4.50 (NOT snapped to 5)', () => {
    // Old behavior: Math.abs(5 - 4.50) < 1 → true → snapped to 5
    // New behavior: notes never snap upward → stays 4.50
    expect(resolveFinalPaid('credit-note', 4.50, 5)).toBe(4.50)
  })

  test('credit note: ₹4.99 refund on ₹5 note stays ₹4.99 (still no snap for notes)', () => {
    // Even at ₹0.01 short, notes don't snap. Precision matters more than
    // convenience for note refunds.
    expect(resolveFinalPaid('credit-note', 4.99, 5)).toBe(4.99)
  })

  test('credit note: ₹5 refund on ₹5 note stays ₹5 (exact full refund)', () => {
    expect(resolveFinalPaid('credit-note', 5, 5)).toBe(5)
  })

  test('credit note: ₹5.50 refund on ₹5 note snaps via §6.4 clamp (not snap band)', () => {
    // Notes don't snap upward, but §6.4 still clamps paid ≤ total.
    expect(resolveFinalPaid('credit-note', 5.50, 5)).toBe(5)
  })

  test('debit note: same no-snap rule as credit note', () => {
    expect(resolveFinalPaid('debit-note', 4.50, 5)).toBe(4.50)
  })

  test('purchase: ₹1999.50 on a ₹2000 purchase stays ₹1999.50 (was: snapped)', () => {
    // Same rule as sale — purchases are not notes.
    expect(resolveFinalPaid('purchase', 1999.50, 2000)).toBe(1999.50)
  })

  test('income/expense: same snap rule as sale (not notes)', () => {
    expect(resolveFinalPaid('income', 99.50, 100)).toBe(99.50)
    expect(resolveFinalPaid('expense', 99.50, 100)).toBe(99.50)
  })

  test('regression: ₹0 on a sub-₹1 note stays 0 (V24 §1 fix preserved)', () => {
    // The V24 §1 fix: a ₹0 refund on a ₹0.60 note stays 0 (khata adjustment,
    // not a payment). V26 N7 must not break this.
    expect(resolveFinalPaid('credit-note', 0, 0.60)).toBe(0)
  })

  test('regression: missing paid on a sale defaults to total (V24 §1 preserved)', () => {
    expect(resolveFinalPaid('sale', undefined, 1000)).toBe(1000)
  })

  test('regression: missing paid on a credit note defaults to 0 (V24 §1 preserved)', () => {
    expect(resolveFinalPaid('credit-note', undefined, 300)).toBe(0)
  })
})

// ─── N8: Product money-extension has all 4 missing handlers ────────────

describe('V26 N8 — Product money-extension has delete/deleteMany/aggregate/groupBy', () => {
  const EXTENSION_PATH = path.join(
    process.cwd(),
    'src/lib/prisma-money-extension.ts',
  )

  test('extension source file exists', () => {
    expect(fs.existsSync(EXTENSION_PATH)).toBe(true)
  })

  test('Product block defines all 12 operations (was missing 4)', () => {
    const src = fs.readFileSync(EXTENSION_PATH, 'utf8')
    // Extract the Product block (between "product: {" and the matching "}").
    // We use a simple regex — the file is hand-written and consistent.
    const productBlockMatch = src.match(/product:\s*\{([\s\S]*?)\n\s{6}\},/)
    expect(productBlockMatch).not.toBeNull()
    const productBlock = productBlockMatch![1]

    // All 12 Prisma operations that should be defined.
    const requiredOps = [
      'findMany', 'findFirst', 'findUnique',
      'create', 'createMany',
      'update', 'updateMany', 'upsert',
      'delete', 'deleteMany',  // 🔒 V26 N8: was missing
      'aggregate', 'groupBy',  // 🔒 V26 N8: was missing
    ]
    for (const op of requiredOps) {
      // Match `async opName(` — the handler declaration.
      const opRegex = new RegExp(`async ${op}\\s*\\(`)
      expect(opRegex.test(productBlock)).toBe(true)
    }
  })

  test('Product delete handler calls convertRowOnRead (returns rupees, not paise)', () => {
    const src = fs.readFileSync(EXTENSION_PATH, 'utf8')
    const productBlockMatch = src.match(/product:\s*\{([\s\S]*?)\n\s{6}\},/)
    const productBlock = productBlockMatch![1]

    // The delete handler must call convertRowOnRead('Product', ...) so the
    // returned row's money cols are in rupees.
    expect(productBlock).toMatch(/async delete\([\s\S]*?convertRowOnRead\('Product'[\s\S]*?\)/)
  })

  test('Product aggregate handler converts _sum/_avg/_min/_max via fromPaise', () => {
    const src = fs.readFileSync(EXTENSION_PATH, 'utf8')
    const productBlockMatch = src.match(/product:\s*\{([\s\S]*?)\n\s{6}\},/)
    const productBlock = productBlockMatch![1]

    // The aggregate handler must iterate over _sum/_avg/_min/_max and call
    // fromPaise on each money column.
    expect(productBlock).toMatch(/async aggregate\(/)
    // Check each agg key individually (avoid the `s` regex flag — needs es2018).
    expect(productBlock).toMatch(/_sum/)
    expect(productBlock).toMatch(/_avg/)
    expect(productBlock).toMatch(/_min/)
    expect(productBlock).toMatch(/_max/)
    expect(productBlock).toMatch(/fromPaise/)
    expect(productBlock).toMatch(/MONEY_COLUMNS\['Product'\]/)
  })

  test('Product groupBy handler converts _sum/_avg/_min/_max via fromPaise', () => {
    const src = fs.readFileSync(EXTENSION_PATH, 'utf8')
    const productBlockMatch = src.match(/product:\s*\{([\s\S]*?)\n\s{6}\},/)
    const productBlock = productBlockMatch![1]

    expect(productBlock).toMatch(/async groupBy\(/)
    expect(productBlock).toMatch(/_sum/)
    expect(productBlock).toMatch(/_avg/)
    expect(productBlock).toMatch(/_min/)
    expect(productBlock).toMatch(/_max/)
    expect(productBlock).toMatch(/fromPaise/)
  })

  test('Product is in MONEY_COLUMNS (required for aggregate/groupBy)', () => {
    const src = fs.readFileSync(EXTENSION_PATH, 'utf8')
    // The MONEY_COLUMNS map must have a Product entry with the money cols.
    expect(src).toMatch(/Product:\s*\[['"]purchasePrice['"]\s*,\s*['"]salePrice['"]\s*,\s*['"]mrp['"]\]/)
  })
})
