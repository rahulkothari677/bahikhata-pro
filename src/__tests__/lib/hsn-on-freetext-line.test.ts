import { computeLineItems } from '@/lib/line-items'
describe('hsn on a free-text line', () => {
  it('is kept when there is no product', () => {
    const r = computeLineItems({
      items: [{ productId: null, productName: 'Service', quantity: 1, unitPrice: 1000, gstRate: 18, unit: 'pcs', hsn: '998314' } as any],
      productMap: new Map(), isInterState: false, orderDiscount: 0, type: 'sale',
    })
    expect(r.txItems[0].hsn).toBe('998314')
  })
  it('prefers the product code when there is one', () => {
    const r = computeLineItems({
      items: [{ productId: 'p1', productName: 'Soap', quantity: 1, unitPrice: 100, gstRate: 18, unit: 'pcs', hsn: '9999' } as any],
      productMap: new Map([['p1', { id:'p1', name:'Soap', unit:'pcs', hsn:'3401', gstRate:18, sellingPrice:100 } as any]]),
      isInterState: false, orderDiscount: 0, type: 'sale',
    })
    expect(r.txItems[0].hsn).toBe('3401')
  })
})
