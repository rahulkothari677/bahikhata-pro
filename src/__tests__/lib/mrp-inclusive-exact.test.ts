/**
 * #98 — a GST-inclusive (MRP) bill charges EXACTLY quantity × MRP.
 *
 * The bug: the taxable unit price was rounded to the paisa and the line was
 * `quantity × rounded price + GST`, so the error was multiplied by the quantity.
 * 100 × ₹1 at 18% billed ₹100.30; on the live app "20 pcs × ₹230 = ₹4,600.05"
 * and "3 × ₹255 = ₹765.01". Charging above MRP breaks Legal Metrology.
 *
 * Swept over the whole domain, not samples (CLAUDE.md: a hand-picked test let
 * the HSN table's junk keys through). Every quantity 1–1,000 × ten MRPs ×
 * every rate.
 */
import { computeLineItems } from '@/lib/line-items'
import { lineTaxable } from '@/lib/line-taxable'

const toPaise = (r: number) => Math.round(r * 100)

function bill(qty: number, mrp: number, rate: number, discount = 0, interState = false) {
  return computeLineItems({
    items: [{ productId: null, productName: 'Item', quantity: qty, unitPrice: mrp, gstRate: rate, unit: 'pcs', priceIncludesGst: true }],
    productMap: new Map(),
    isInterState: interState,
    orderDiscount: discount,
    type: 'sale',
  })
}

const MRPS = [1, 9.99, 10, 25.5, 99, 110, 230, 255, 1199, 4999.99]
const RATES = [0.25, 1.5, 3, 5, 12, 18, 28, 40]

describe('#98 — MRP lines total exactly quantity × MRP', () => {
  test('every quantity 1–1,000 × ten MRPs × every rate', () => {
    const failures: string[] = []
    for (const rate of RATES) {
      for (const mrp of MRPS) {
        for (let qty = 1; qty <= 1000; qty++) {
          const r = bill(qty, mrp, rate)
          const line = r.txItems[0]
          const expected = Math.round(qty * toPaise(mrp))
          if (toPaise(line.total) !== expected || toPaise(r.totalBeforeRoundOff) !== expected) {
            failures.push(`${qty} × ₹${mrp} @${rate}% → line ₹${line.total}, bill ₹${r.totalBeforeRoundOff}, expected ₹${expected / 100}`)
            if (failures.length > 10) break
          }
        }
      }
    }
    expect(failures).toEqual([])
  })

  test('the reported cases from the live app', () => {
    expect(bill(20, 230, 5).totalBeforeRoundOff).toBe(4600)
    expect(bill(3, 255, 5).totalBeforeRoundOff).toBe(765)
    expect(bill(10, 255, 5).totalBeforeRoundOff).toBe(2550)
    expect(bill(100, 1, 18).totalBeforeRoundOff).toBe(100)
  })

  test('taxable + tax = total, and the tax is the rate on the taxable value within 1 paisa', () => {
    for (const rate of RATES) {
      for (const mrp of MRPS) {
        for (const qty of [1, 2, 3, 7, 13, 99, 250, 999]) {
          const line = bill(qty, mrp, rate).txItems[0]
          const taxable = lineTaxable(line)
          const tax = line.cgst + line.sgst + line.igst
          expect(toPaise(taxable) + toPaise(tax)).toBe(toPaise(line.total))
          expect(Math.abs(toPaise(tax) - Math.round(toPaise(taxable) * rate / 100))).toBeLessThanOrEqual(1)
        }
      }
    }
  })

  test('inter-state MRP lines are exact too (IGST)', () => {
    expect(bill(37, 100, 18, 0, true).totalBeforeRoundOff).toBe(3700)
    expect(bill(37, 100, 18, 0, true).txItems[0].cgst).toBe(0)
  })

  test('a discounted MRP line still adds up: taxable + tax = total', () => {
    const r = bill(10, 255, 5, 100)
    const line = r.txItems[0]
    expect(toPaise(lineTaxable(line)) + toPaise(line.cgst + line.sgst)).toBe(toPaise(line.total))
    expect(r.totalBeforeRoundOff).toBeLessThan(2550)
  })

  test('GST-exclusive lines are unchanged: quantity × price, then GST on top', () => {
    const r = computeLineItems({
      items: [{ productId: null, productName: 'Item', quantity: 20, unitPrice: 230, gstRate: 5, unit: 'pcs', priceIncludesGst: false }],
      productMap: new Map(), isInterState: false, orderDiscount: 0, type: 'sale',
    })
    expect(r.subtotal).toBe(4600)
    expect(r.totalBeforeRoundOff).toBe(4830)
  })
})
