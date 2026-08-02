/**
 * 🔒 AUDIT G5 — the IRN payload must satisfy NIC's own arithmetic.
 *
 * THE BUG: the order-level discount was counted TWICE.
 *
 * This app distributes the order discount across line items, so each item
 * carries its share in `Discount` and has it removed from `AssAmt`. `AssVal`
 * is the sum of those AssAmt values — already net of the discount.
 * `ValDtls.Discount` then reported the same discount again.
 *
 * NIC validates:
 *     TotInvVal = AssVal + taxes + OthChrg − Discount + RndOffAmt
 *
 * so the portal expected `subtotal − 2×discount + …` while we sent
 * `subtotal − discount + …`. Every B2B invoice with ANY discount would have
 * been rejected at IRN generation — a hard block on invoicing that customer.
 *
 * These tests assert the IDENTITY rather than the field value, so they keep
 * working if the payload is restructured.
 */

import { buildIrnRequest } from '@/lib/e-invoice'
import { computeLineItems } from '@/lib/line-items'
import { roundMoney } from '@/lib/money'

const shop = {
  gstin: '27AAAAA0000A1Z5',
  shopName: 'Test Shop',
  ownerName: 'Owner',
  address: '12 Main Road, Mumbai 400001',
  state: 'Maharashtra',
  stateCode: '27',
} as any

/**
 * Build a transaction the same way the app does, so the header totals and the
 * per-item values are genuinely consistent rather than hand-invented.
 */
function buildTxn(opts: {
  items: Array<{ quantity: number; unitPrice: number; gstRate: number }>
  orderDiscount: number
  isInterState?: boolean
}) {
  const computed = computeLineItems({
    items: opts.items.map((it, i) => ({
      productId: null,
      productName: `Item ${i + 1}`,
      quantity: it.quantity,
      unitPrice: it.unitPrice,
      gstRate: it.gstRate,
      unit: 'pcs',
    })),
    productMap: new Map(),
    isInterState: !!opts.isInterState,
    orderDiscount: opts.orderDiscount,
    type: 'sale',
  })

  return {
    id: 'txn1',
    type: 'sale',
    invoiceNo: 'INV-0001',
    date: new Date('2026-06-15'),
    subtotal: computed.subtotal,
    discountAmount: opts.orderDiscount,
    cgst: computed.cgst,
    sgst: computed.sgst,
    igst: computed.igst,
    totalAmount: computed.totalBeforeRoundOff,
    isInterState: !!opts.isInterState,
    partyGstin: '24BBBBB0000B1Z5',
    partyName: 'Buyer Ltd',
    partyState: 'Gujarat',
    partyAddress: '9 Market Street, Surat 395003',
    partyPhone: '9999999999',
    partyEmail: 'buyer@example.com',
    items: computed.txItems.map(i => ({
      productName: i.productName,
      hsn: '1006',
      quantity: i.quantity,
      unit: i.unit,
      unitPrice: i.unitPrice,
      gstRate: i.gstRate,
      discountAmount: i.discountAmount,
      cgst: i.cgst,
      sgst: i.sgst,
      igst: i.igst,
      csamt: 0,
    })),
  } as any
}

/** NIC's own total check. */
function nicTotal(v: any) {
  return roundMoney(
    v.AssVal + v.CgstVal + v.SgstVal + v.IgstVal + v.CesVal + v.OthChrg - v.Discount + v.RndOffAmt,
  )
}

describe('G5 — IRN ValDtls satisfies NIC arithmetic', () => {
  const cases = [
    { name: 'no discount', orderDiscount: 0 },
    { name: 'small discount', orderDiscount: 50 },
    { name: 'large discount', orderDiscount: 500 },
    { name: 'fractional discount', orderDiscount: 33.33 },
  ]

  test.each(cases)('$name — TotInvVal matches NIC\'s computed total', ({ orderDiscount }) => {
    const txn = buildTxn({
      items: [
        { quantity: 2, unitPrice: 500, gstRate: 18 },
        { quantity: 3, unitPrice: 250, gstRate: 18 },
      ],
      orderDiscount,
    })

    const req = buildIrnRequest(txn, shop)!
    expect(req).not.toBeNull()

    // The invariant. Pre-fix this failed for every non-zero discount, by
    // exactly the discount amount.
    expect(nicTotal(req.ValDtls)).toBeCloseTo(roundMoney(req.ValDtls.TotInvVal), 2)
  })

  test('AssVal equals the sum of item AssAmt (NIC cross-checks this)', () => {
    const txn = buildTxn({
      items: [
        { quantity: 2, unitPrice: 500, gstRate: 18 },
        { quantity: 3, unitPrice: 250, gstRate: 12 },
        { quantity: 1.5, unitPrice: 99.99, gstRate: 5 },
      ],
      orderDiscount: 77.77,
    })

    const req = buildIrnRequest(txn, shop)!
    const sumItemAss = roundMoney(req.ItemList.reduce((s: number, i: any) => s + i.AssAmt, 0))

    expect(sumItemAss).toBeCloseTo(roundMoney(req.ValDtls.AssVal), 2)
  })

  test('the discount is reported at item level, so it is not lost', () => {
    // Zeroing ValDtls.Discount must not mean the discount vanishes from the
    // payload — NIC still needs to see it, just once, on the items.
    const txn = buildTxn({
      items: [{ quantity: 2, unitPrice: 500, gstRate: 18 }],
      orderDiscount: 100,
    })

    const req = buildIrnRequest(txn, shop)!
    const sumItemDiscount = roundMoney(req.ItemList.reduce((s: number, i: any) => s + i.Discount, 0))

    expect(sumItemDiscount).toBeCloseTo(100, 2)
    expect(req.ValDtls.Discount).toBe(0)
  })

  test('per item: AssAmt === TotAmt − Discount, and TotItemVal === AssAmt + taxes', () => {
    const txn = buildTxn({
      items: [
        { quantity: 2, unitPrice: 500, gstRate: 18 },
        { quantity: 3, unitPrice: 250, gstRate: 12 },
      ],
      orderDiscount: 60,
    })

    const req = buildIrnRequest(txn, shop)!
    for (const i of req.ItemList as any[]) {
      expect(i.AssAmt).toBeCloseTo(roundMoney(i.TotAmt - i.Discount), 2)
      expect(i.TotItemVal).toBeCloseTo(
        roundMoney(i.AssAmt + i.CgstAmt + i.SgstAmt + i.IgstAmt + i.CesAmt), 2,
      )
    }
  })

  test('holds for an inter-state invoice (IGST instead of CGST/SGST)', () => {
    const txn = buildTxn({
      items: [{ quantity: 4, unitPrice: 750, gstRate: 18 }],
      orderDiscount: 250,
      isInterState: true,
    })

    const req = buildIrnRequest(txn, shop)!
    expect(req.ValDtls.IgstVal).toBeGreaterThan(0)
    expect(req.ValDtls.CgstVal).toBe(0)
    expect(nicTotal(req.ValDtls)).toBeCloseTo(roundMoney(req.ValDtls.TotInvVal), 2)
  })
})
