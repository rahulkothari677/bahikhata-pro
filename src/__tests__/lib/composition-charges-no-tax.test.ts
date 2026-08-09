/**
 * A composition dealer's sale carries no GST, whatever the request says.
 *
 * WHY (2026-08-09). The Bill of Supply declares that no tax was charged. If a
 * rate still reached the line, the document would assert one thing while the
 * figures said another — illegal, and it overcharges the customer at the same
 * time.
 *
 * Enforced where the rate is DECIDED, not hidden in the UI. A cached screen, a
 * sale queued offline before the shop switched schemes, or a direct API call
 * all bypass the interface; none of them bypass this.
 */
import { computeLineItems } from '@/lib/line-items'

const line = { productId: null, productName: 'Item', quantity: 1, unitPrice: 1000, gstRate: 18, unit: 'pcs' } as any

describe('composition sales carry no tax', () => {
  it('forces 18% to zero', () => {
    const r = computeLineItems({
      items: [line], productMap: new Map(), isInterState: false,
      orderDiscount: 0, type: 'sale', isComposition: true,
    })
    expect(r.txItems[0].gstRate).toBe(0)
    expect(r.txItems[0].cgst).toBe(0)
    expect(r.txItems[0].sgst).toBe(0)
    expect(r.txItems[0].igst).toBe(0)
  })

  it('leaves the price the customer pays untouched', () => {
    // The dealer absorbs the tax; they do not discount the goods.
    const r = computeLineItems({
      items: [line], productMap: new Map(), isInterState: false,
      orderDiscount: 0, type: 'sale', isComposition: true,
    })
    expect(r.txItems[0].total).toBe(1000)
  })

  it('charges no IGST on an inter-state line either', () => {
    const r = computeLineItems({
      items: [line], productMap: new Map(), isInterState: true,
      orderDiscount: 0, type: 'sale', isComposition: true,
    })
    expect(r.txItems[0].igst).toBe(0)
  })

  it('still charges tax for a regular shop', () => {
    const r = computeLineItems({
      items: [line], productMap: new Map(), isInterState: false,
      orderDiscount: 0, type: 'sale',
    })
    expect(r.txItems[0].gstRate).toBe(18)
    expect(r.txItems[0].cgst).toBeGreaterThan(0)
  })
})
