import {
  convertQuantity,
  normalizeToUnit,
  resolveEnteredQuantity,
  canConvert,
  baseUnitOf,
  isSubUnit,
  normalizeUnitName,
} from '@/lib/units'
import { computeLineItems } from '@/lib/line-items'

describe('units — conversion', () => {
  it('converts gm ↔ kg', () => {
    expect(convertQuantity(500, 'gm', 'kg')).toBeCloseTo(0.5, 6)
    expect(convertQuantity(2, 'kg', 'gm')).toBeCloseTo(2000, 6)
  })
  it('converts ml ↔ ltr and cm ↔ m', () => {
    expect(convertQuantity(750, 'ml', 'ltr')).toBeCloseTo(0.75, 6)
    expect(convertQuantity(150, 'cm', 'm')).toBeCloseTo(1.5, 6)
  })
  it('handles Indian aliases (gram, kilo, litre)', () => {
    expect(convertQuantity(500, 'gram', 'kg')).toBeCloseTo(0.5, 6)
    expect(normalizeUnitName('grams')).toBe('gm')
    expect(normalizeUnitName('KILO')).toBe('kg')
  })
  it('refuses cross-family conversion', () => {
    expect(convertQuantity(500, 'gm', 'pcs')).toBeNull()
    expect(canConvert('gm', 'pcs')).toBe(false)
  })
  it('knows base units and sub-units', () => {
    expect(baseUnitOf('gm')).toBe('kg')
    expect(isSubUnit('gm')).toBe(true)
    expect(isSubUnit('kg')).toBe(false)
  })
})

describe('units — resolveEnteredQuantity (the ₹10,000 tomato fix)', () => {
  it('normalizes a spoken sub-unit quantity to the product unit', () => {
    const r = resolveEnteredQuantity(500, 'gm', 'kg')
    expect(r.quantity).toBeCloseTo(0.5, 6)
    expect(r.unit).toBe('kg')
    expect(r.converted).toBe(true)
  })
  it('normalizes an UNLINKED sub-unit quantity to its base unit', () => {
    const r = resolveEnteredQuantity(500, 'gm', undefined)
    expect(r.quantity).toBeCloseTo(0.5, 6)
    expect(r.unit).toBe('kg')
  })
  it('leaves base/count units untouched', () => {
    expect(resolveEnteredQuantity(3, 'pcs', undefined).quantity).toBe(3)
    expect(resolveEnteredQuantity(2, 'kg', 'kg').quantity).toBe(2)
  })
})

describe('line-items — the reported bug + GST + discount', () => {
  const tomato = { id: 'p1', name: 'Tomato', unit: 'kg', purchasePrice: 10, salePrice: 20, priceIncludesGst: false }
  const productMap = new Map<string, any>([['p1', tomato]])

  it('500 gm of a ₹20/kg product = ₹10, not ₹10,000', () => {
    const r = computeLineItems({
      items: [{ productId: 'p1', productName: 'Tomato', quantity: 500, unitPrice: 20, gstRate: 0, unit: 'gm' }],
      productMap, isInterState: false, orderDiscount: 0, type: 'sale',
    })
    expect(r.txItems[0].quantity).toBeCloseTo(0.5, 6)
    expect(r.txItems[0].unit).toBe('kg')
    expect(r.totalBeforeRoundOff).toBeCloseTo(10, 2)
  })

  it('GST-inclusive (MRP) back-calculates the taxable value', () => {
    // MRP ₹118 incl 18% → taxable ₹100, GST ₹18
    const mrpProduct = { id: 'p2', name: 'Biscuit', unit: 'pcs', purchasePrice: 80, salePrice: 118, priceIncludesGst: true }
    const r = computeLineItems({
      items: [{ productId: 'p2', productName: 'Biscuit', quantity: 1, unitPrice: 118, gstRate: 18, unit: 'pcs', priceIncludesGst: true }],
      productMap: new Map([['p2', mrpProduct]]), isInterState: false, orderDiscount: 0, type: 'sale',
    })
    expect(r.subtotal).toBeCloseTo(100, 2)          // taxable value
    expect(r.cgst + r.sgst).toBeCloseTo(18, 2)      // GST extracted, not added
    expect(r.totalBeforeRoundOff).toBeCloseTo(118, 2) // customer still pays MRP
  })

  it('tax equals taxable × rate after a discount (GSTR-filable)', () => {
    const r = computeLineItems({
      items: [{ productId: 'p1', productName: 'Tomato', quantity: 10, unitPrice: 100, gstRate: 18, unit: 'kg' }],
      productMap, isInterState: false, orderDiscount: 100, type: 'sale',
    })
    // taxable = 1000 - 100 = 900; GST = 162; total = 1062
    const taxable = r.subtotal - 100
    expect(r.cgst + r.sgst).toBeCloseTo(taxable * 0.18, 2)
    expect(r.totalBeforeRoundOff).toBeCloseTo(1062, 2)
  })

  it('inter-state uses IGST only', () => {
    const r = computeLineItems({
      items: [{ productId: 'p1', productName: 'Tomato', quantity: 1, unitPrice: 100, gstRate: 18, unit: 'kg' }],
      productMap, isInterState: true, orderDiscount: 0, type: 'sale',
    })
    expect(r.igst).toBeCloseTo(18, 2)
    expect(r.cgst).toBe(0)
    expect(r.sgst).toBe(0)
  })
})
