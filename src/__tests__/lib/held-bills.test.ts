/**
 * @jest-environment jsdom
 *
 * Phase 7f — hold a bill and start the next customer's (#144, #187).
 *
 *  - A held bill's total is the bill engine's, never Σ qty × price: #187 saw a
 *    ₹230 + 5% GST purchase listed as ₹230 (lib/bill-total.ts).
 *  - Nothing is dropped silently: held bills never expire and the 21st is
 *    refused with a word, not by pushing out the oldest (hooks/use-drafts.ts).
 *  - Hold writes at once, even inside the autosave pause.
 */
import { renderHook, act } from '@testing-library/react'
import { heldBillFigures, heldBillName, heldBillWhen, billTotalAfterRoundOff } from '@/lib/bill-total'
import { useDrafts, MAX_HELD } from '@/hooks/use-drafts'

const productMap = new Map<string, any>([
  ['rice', { id: 'rice', name: 'Rice 25 kg', unit: 'pcs', gstRate: 5, priceIncludesGst: false }],
  ['atta', { id: 'atta', name: 'Aashirvaad Atta 5kg', unit: 'pcs', gstRate: 5, priceIncludesGst: true }],
])

describe('a held bill stands at what the screen showed (#187)', () => {
  test('a ₹230 purchase + 5% GST is ₹241.50, not ₹230', () => {
    const f = heldBillFigures(
      { items: [{ productId: 'rice', productName: 'Rice 25 kg', quantity: 1, unitPrice: 230, gstRate: 5, unit: 'pcs' }] },
      { formType: 'purchase', productMap, chargesGst: true, roundOffEnabled: false },
    )
    expect(f.total).toBe(241.5)
    expect(f.lineTotals).toEqual([241.5])
  })
  test('an MRP line counts at its price; a bill discount counts (off the value before GST, s.15(3)(a)); round-off as the shop has it', () => {
    const f = heldBillFigures(
      { items: [{ productId: 'atta', productName: 'Aashirvaad Atta 5kg', quantity: 2, unitPrice: 255, gstRate: 5, unit: 'pcs' }], discountAmount: '10' },
      { formType: 'sale', productMap, chargesGst: true, roundOffEnabled: false },
    )
    // 2 × ₹255 incl. 5% = ₹485.71 + GST; ₹10 off the ₹485.71 → ₹475.71 + 5% = ₹499.50 — the bill screen's own figure.
    expect(f.total).toBe(499.5)
    expect(billTotalAfterRoundOff(241.5, true)).toBe(242)
  })
  test('an empty bill is nothing', () => {
    expect(heldBillFigures({ items: [] }, { formType: 'sale', productMap, chargesGst: true, roundOffEnabled: true }).total).toBe(0)
  })
})

describe('what a held bill is called, and when', () => {
  test('the customer, else the first item (+ how many more)', () => {
    expect(heldBillName({ items: [{ productName: 'Toor Dal' }, { productName: 'Sugar' }] }, 'Sharma ji')).toBe('Sharma ji')
    expect(heldBillName({ items: [{ productName: 'Toor Dal' }, { productName: 'Sugar' }, { productName: 'Eggs' }] })).toBe('Toor Dal +2')
    expect(heldBillName({ items: [] })).toBe('Empty bill')
  })
  test('the time today, the day before that (India time)', () => {
    const now = Date.UTC(2026, 9, 25, 10, 0) // 25 Oct, 3:30 pm IST
    expect(heldBillWhen(Date.UTC(2026, 9, 25, 5, 12), now)).toMatch(/10:42\s?am/i)
    expect(heldBillWhen(Date.UTC(2026, 9, 21, 5, 0), now)).toBe('21 Oct')
  })
})

describe('held bills are never dropped silently', () => {
  beforeEach(() => window.localStorage.clear())
  const bill = (n: number) => ({ items: [{ productId: 'atta', productName: `Atta ${n}`, quantity: 1, unitPrice: 255 }] })

  test('Hold writes at once, marks it held, and lets go so the next bill starts fresh', () => {
    const { result } = renderHook(() => useDrafts<any>('sale'))
    let r: string = ''
    act(() => { r = result.current.holdNow(bill(1)) })
    expect(r).toBe('held')
    expect(result.current.drafts).toHaveLength(1)
    expect(result.current.drafts[0].heldAt).toBeGreaterThan(0)
    expect(result.current.activeDraftId).toBeNull()
  })
  test('a bill emptied by hand stops being held — its last full copy does not stay behind', () => {
    jest.useFakeTimers()
    const { result } = renderHook(() => useDrafts<any>('sale'))
    act(() => { result.current.save(bill(1)); jest.advanceTimersByTime(700) })
    expect(result.current.drafts).toHaveLength(1)
    act(() => { result.current.save({ items: [] }); jest.advanceTimersByTime(700) })
    expect(result.current.drafts).toHaveLength(0)
    jest.useRealTimers()
  })
  test('nothing to keep is not held', () => {
    const { result } = renderHook(() => useDrafts<any>('sale'))
    let r: string = ''
    act(() => { r = result.current.holdNow({ items: [] }) })
    expect(r).toBe('empty')
  })
  test(`at ${MAX_HELD} held, the next Hold is refused — the oldest is never pushed out`, () => {
    const { result } = renderHook(() => useDrafts<any>('sale'))
    for (let i = 0; i < MAX_HELD; i++) act(() => { result.current.holdNow(bill(i)) })
    let r: string = ''
    act(() => { r = result.current.holdNow(bill(99)) })
    expect(r).toBe('full')
    expect(result.current.drafts).toHaveLength(MAX_HELD)
    expect(result.current.drafts.some((d) => d.data.items[0].productName === 'Atta 0')).toBe(true)
  })
  test('an old held bill does not expire (a bill held yesterday is still there)', () => {
    const old = { v: 2, drafts: [{ id: 'x', savedAt: Date.now() - 3 * 24 * 3600 * 1000, heldAt: Date.now() - 3 * 24 * 3600 * 1000, data: bill(7) }] }
    window.localStorage.setItem('bahikhata:drafts:sale:v2', JSON.stringify(old))
    const { result } = renderHook(() => useDrafts<any>('sale'))
    expect(result.current.drafts.map((d) => d.id)).toContain('x')
  })
})
