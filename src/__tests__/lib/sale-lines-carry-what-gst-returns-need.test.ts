/**
 * A saved sale line carries everything a GST return reads off it.
 *
 * WHY THIS IS BEHAVIOURAL AND NOT A SOURCE SCAN (2026-08-07).
 *
 * TransactionItem.hsn was read by GSTR-1 Table 12, by the HSN summary and by
 * the e-invoice IRN builder, and written by nothing but a backup restore. Every
 * invoice the app ever produced carried a blank HSN, so Table 12 came back with
 * zero rows against ₹9,938.90 of reported sales — a return that cannot be filed
 * and an e-invoice the NIC portal would reject.
 *
 * I first tried to guard it by scanning source for a write to each column a
 * return selects. That guard PASSED with the bug reintroduced, so I deleted it.
 * The reason is worth recording, because it is a trap:
 *
 *   `hsn:` is written in several places — Product.hsn in the products route,
 *   and TransactionItem.hsn in the backup restore. A scan that matches on
 *   column NAME sees those, concludes "hsn is written", and never notices that
 *   the SALE PATH does not write it. Name-matching across a codebase cannot
 *   tell one model's column from another's.
 *
 * A guard that cannot fail on the bug it was written for is worse than no
 * guard: it manufactures confidence. So this one runs computeLineItems — the
 * function both create and edit share — and looks at what actually comes out.
 * Remove the snapshot and this goes red immediately.
 *
 * That is the third time this shape has appeared (isReverseCharge, cost price,
 * hsn). The lesson I keep re-learning: assert on behaviour, not on the presence
 * of text that looks like the fix.
 */
import { computeLineItems } from '@/lib/line-items'

const PRODUCT = {
  id: 'p1',
  name: 'Aashirvaad Atta 5kg',
  hsn: '1101',
  unit: 'pcs',
  purchasePrice: 244,
  salePrice: 280,
  gstRate: 5,
  priceIncludesGst: false,
}

function saleOf(product: any, overrides: any = {}) {
  return computeLineItems({
    items: [{
      productId: product.id,
      productName: product.name,
      quantity: 1,
      unitPrice: product.salePrice,
      gstRate: product.gstRate,
      unit: product.unit,
      ...overrides,
    }],
    productMap: new Map([[product.id, product]]),
    isInterState: false,
    orderDiscount: 0,
    type: 'sale',
  })
}

describe('HSN reaches the saved line', () => {
  it('snapshots the product HSN onto the sale line', () => {
    // GSTR-1 Table 12 groups by exactly this field. Blank here means an empty
    // Table 12 beside a non-zero turnover, which is unfileable.
    const r = saleOf(PRODUCT)
    expect(r.txItems[0].hsn).toBe('1101')
  })

  it('is a snapshot, so editing the product later cannot rewrite a filed return', () => {
    const r = saleOf(PRODUCT)
    // Simulate the shopkeeper correcting the product's HSN after the sale.
    const edited = { ...PRODUCT, hsn: '9999' }
    const later = saleOf(edited)

    // The already-computed line keeps what it was sold under; only the new sale
    // gets the new code. Same reasoning as purchasePriceAtSale — a filed return
    // is a historical fact, not a live join.
    expect(r.txItems[0].hsn).toBe('1101')
    expect(later.txItems[0].hsn).toBe('9999')
  })

  it('leaves HSN null when the product has none, rather than inventing one', () => {
    // Legal: HSN is mandatory on B2B invoices under Notification 78/2020 (4
    // digits below ₹5 crore turnover, 6 above) but optional for small B2C
    // supplies. Blocking the sale would be stricter than the law; guessing a
    // code would be worse than blank, because a wrong HSN is a wrong return.
    const r = saleOf({ ...PRODUCT, hsn: null })
    expect(r.txItems[0].hsn).toBeNull()
  })

  it('leaves HSN null for an unlinked line typed at the counter', () => {
    // No product to snapshot from. Must not throw, must not guess.
    const r = computeLineItems({
      items: [{ productName: 'Loose item', quantity: 1, unitPrice: 50, gstRate: 5, unit: 'pcs' }],
      productMap: new Map(),
      isInterState: false,
      orderDiscount: 0,
      type: 'sale',
    })
    expect(r.txItems[0].hsn).toBeNull()
  })
})

describe('the other snapshots a return or report depends on', () => {
  it('keeps cost price, unit and rate on the line too', () => {
    /*
     * These share HSN's failure mode — each is read long after the sale, and
     * each would silently degrade if it were a live join to the product rather
     * than a snapshot. Pinned together so the next person adding a column to
     * this line sees the pattern being followed.
     */
    const r = saleOf(PRODUCT)
    const line = r.txItems[0]
    expect(line.purchasePriceAtSale).toBe(244)  // COGS, drives every profit report
    expect(line.unit).toBe('pcs')               // "500 of Tomato" — grams or kilos?
    expect(line.gstRate).toBe(5)                // Table 12 groups by HSN AND rate
  })
})
