/**
 * 🔒 AUDIT G4 — the B2CL/B2CS boundary must be identical on every export path.
 *
 * THE BUG: two implementations of the same rule.
 *
 *   gstr1-builder.ts  (used by /api/gstr-1)
 *       buildB2CL: totalAmount >  B2CL_INVOICE_VALUE_THRESHOLD
 *       buildB2CS: totalAmount <= B2CL_INVOICE_VALUE_THRESHOLD
 *
 *   gstr-export/route.ts
 *       b2cl:      total >= 100000        <-- hardcoded, and >= not >
 *
 * An inter-state B2C invoice of EXACTLY ₹1,00,000 went to B2CS via one export
 * and B2CL via the other. The same month, exported two ways, produced two
 * different returns — and nothing compared them.
 *
 * `>` is correct: B2CL covers invoice value EXCEEDING ₹1 lakh.
 *
 * These tests pin (a) the boundary behaviour, and (b) that gstr-export imports
 * the shared constant rather than repeating the number. (b) matters because the
 * threshold is not stable — it moved from ₹2.5L to ₹1L in Aug 2024, and a
 * future change must not update only one path.
 */

import fs from 'fs'
import path from 'path'
import { buildB2CL, buildB2CS, B2CL_INVOICE_VALUE_THRESHOLD } from '@/lib/gstr1-builder'

const shop = { gstin: '27AAAAA0000A1Z5', state: 'Maharashtra', stateCode: '27' } as any

function interStateB2C(totalAmount: number, id = 't1') {
  return {
    id,
    type: 'sale',
    date: new Date('2026-06-15'),
    invoiceNo: 'INV-' + id,
    totalAmount,
    isInterState: true,
    partyGstin: null,          // B2C = unregistered
    partyState: 'Gujarat',
    items: [{
      productName: 'X', hsn: '1006', quantity: 1,
      unitPrice: totalAmount, unit: 'pcs', gstRate: 18,
      discountAmount: 0, cgst: 0, sgst: 0, igst: 0, csamt: 0,
    }],
  } as any
}

describe('G4 — B2CL boundary is EXCEEDING the threshold, not meeting it', () => {
  const T = B2CL_INVOICE_VALUE_THRESHOLD

  test('exactly at the threshold goes to B2CS, not B2CL', () => {
    const txns = [interStateB2C(T)]
    expect(buildB2CL(txns, shop)).toHaveLength(0)
    expect(buildB2CS(txns, shop).length).toBeGreaterThan(0)
  })

  test('one paisa above the threshold goes to B2CL', () => {
    const txns = [interStateB2C(T + 0.01)]
    expect(buildB2CL(txns, shop).length).toBeGreaterThan(0)
  })

  test('one paisa below the threshold goes to B2CS', () => {
    const txns = [interStateB2C(T - 0.01)]
    expect(buildB2CL(txns, shop)).toHaveLength(0)
    expect(buildB2CS(txns, shop).length).toBeGreaterThan(0)
  })

  test('every invoice lands in exactly one section — no gap, no double-count', () => {
    // The two predicates must partition the set. A gap loses an invoice from
    // the return entirely; an overlap reports it twice.
    for (const amount of [1, 99999.99, T - 0.01, T, T + 0.01, 100000.5, 250000]) {
      const txns = [interStateB2C(amount)]
      const inB2cl = buildB2CL(txns, shop).length > 0
      const inB2cs = buildB2CS(txns, shop).length > 0
      expect(inB2cl !== inB2cs).toBe(true)
    }
  })
})

describe('G4 — gstr-export uses the shared constant, not a repeated literal', () => {
  const routePath = path.join(process.cwd(), 'src/app/api/gstr-export/route.ts')
  const src = fs.readFileSync(routePath, 'utf8')

  // Strip comments: the fix's own explanatory note quotes the old literal.
  const code = src
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/\/\/.*$/gm, ' ')

  test('imports B2CL_INVOICE_VALUE_THRESHOLD', () => {
    expect(code).toMatch(/import\s*\{[^}]*B2CL_INVOICE_VALUE_THRESHOLD[^}]*\}\s*from/)
  })

  test('does not hardcode the threshold value in the b2cl/b2cs split', () => {
    // Regression guard: reverting to a literal is exactly how the two paths
    // drifted apart in the first place.
    expect(code).not.toMatch(/total\s*>=?\s*100000/)
  })

  test('uses > (exceeding), matching buildB2CL', () => {
    expect(code).toMatch(/total\s*>\s*B2CL_INVOICE_VALUE_THRESHOLD/)
    expect(code).not.toMatch(/total\s*>=\s*B2CL_INVOICE_VALUE_THRESHOLD/)
  })
})
