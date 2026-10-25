/**
 * @jest-environment jsdom
 *
 * Phase 7g-4 — a return picks from the bill it reverses (#190).
 *
 * A credit note against a bill opened on the whole shop's item picker, with
 * "Load all items from original sale" under it. Now the bill's own lines come
 * first, each with − / + up to what was sold, and "Return all" is one tap. The
 * note still starts empty (most returns are partial), and every returned line
 * carries the price as billed (refillPrice, #130).
 */
import { render, screen, fireEvent } from '@testing-library/react'
import { originalLinesOf, returnedQty, setReturnedQty, returnAll, returnStep, type ReturnRow } from '@/lib/return-lines'
import { ReturnFromBill } from '@/components/ledger/ReturnFromBill'
import { readCode } from '@/test-support/read-source'

// INV-0038 as the detail API returns it: atta at MRP ₹255 (5% inside), dal loose 0.5 kg.
const saved = [
  { productId: 'atta', productName: 'Aashirvaad Atta 5kg', quantity: 3, unit: 'pcs', unitPrice: 242.86, enteredPrice: 255, priceIncludesGst: true, gstRate: 5 },
  { productId: 'dal', productName: 'Toor Dal (loose)', quantity: 0.5, unit: 'kg', enteredQuantity: 500, enteredUnit: 'g', unitPrice: 140, enteredPrice: 140, priceIncludesGst: false, gstRate: 0 },
]
const lines = originalLinesOf(saved)

describe('the bill\'s lines, as billed', () => {
  test('each line carries the typed price and quantity (500 g, ₹255 incl. GST)', () => {
    expect(lines[0]).toMatchObject({ productId: 'atta', quantity: 3, unit: 'pcs', unitPrice: 255, priceIncludesGst: true, gstRate: 5 })
    expect(lines[1]).toMatchObject({ productId: 'dal', quantity: 500, unit: 'g', unitPrice: 140, priceIncludesGst: false })
  })
  test('a whole-count line steps by one; any other comes back whole or not at all', () => {
    expect(returnStep(lines[0])).toBe(1)
    expect(returnStep({ ...lines[1], quantity: 0.5 })).toBe(0.5)
  })
})

describe('setting what came back', () => {
  test('starts empty; + adds the line at the billed price; − to 0 takes it off', () => {
    let rows: ReturnRow[] = []
    expect(returnedQty(rows, lines[0])).toBe(0)
    rows = setReturnedQty(rows, lines[0], 1)
    expect(rows).toEqual([{ productId: 'atta', productName: 'Aashirvaad Atta 5kg', quantity: 1, unitPrice: 255, priceIncludesGst: true, gstRate: 5, unit: 'pcs', discountAmount: 0 }])
    rows = setReturnedQty(rows, lines[0], 2)
    expect(rows).toHaveLength(1)
    expect(returnedQty(rows, lines[0])).toBe(2)
    rows = setReturnedQty(rows, lines[0], 0)
    expect(rows).toEqual([])
  })
  test('never more than was sold, never below nothing', () => {
    expect(returnedQty(setReturnedQty([], lines[0], 9), lines[0])).toBe(3)
    expect(setReturnedQty([], lines[0], -2)).toEqual([])
  })
  test('Return all brings every line back in full and keeps a line not on the bill', () => {
    const extra: ReturnRow = { productId: 'bag', productName: 'Carry bag', quantity: 1, unitPrice: 5, gstRate: 0, unit: 'pcs' }
    const rows = returnAll([extra], lines)
    expect(rows.map((r) => [r.productId, r.quantity])).toEqual([['bag', 1], ['atta', 3], ['dal', 500]])
  })
})

describe('the card', () => {
  test('− / + and Return all call back with the right amounts', () => {
    const onSet = jest.fn()
    const onAll = jest.fn()
    const rows = setReturnedQty([] as ReturnRow[], lines[0], 1)
    render(<ReturnFromBill billNo="INV-0038" lines={lines} rows={rows} onSet={onSet} onAll={onAll} />)
    expect(screen.getByText('From INV-0038')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'One more Aashirvaad Atta 5kg back' }))
    expect(onSet).toHaveBeenLastCalledWith(lines[0], 2)
    fireEvent.click(screen.getByRole('button', { name: 'One less Aashirvaad Atta 5kg back' }))
    expect(onSet).toHaveBeenLastCalledWith(lines[0], 0)
    fireEvent.click(screen.getByRole('button', { name: /Return all/ }))
    expect(onAll).toHaveBeenCalled()
  })
  test('a bill that could not be read says so — never "no items"', () => {
    render(<ReturnFromBill billNo="INV-0038" lines={[]} rows={[]} onSet={() => {}} onAll={() => {}} failed />)
    expect(screen.getByText(/Couldn.t open INV-0038/)).toBeTruthy()
    expect(screen.queryByText('This bill has no items.')).toBeNull()
  })
})

describe('the return screen uses it', () => {
  const entry = readCode('components/ledger/TransactionEntry.tsx')
  test('a note against a bill draws the From-bill card and folds the shop picker behind a button', () => {
    expect(entry).toMatch(/\{isNote && originalTransactionId && \(\r?\n\s*<ReturnFromBill/)
    expect(entry).toMatch(/isNote && originalTransactionId && !notePickerOpen && fromBillState !== 'failed' \?/)
    expect(entry).toContain('Item not on {fromBill?.billNo')
  })
  test('a return\'s bars say where the money goes, not "₹52 due" in red', () => {
    expect(entry).toContain("text: `${formatINR(due)} to ${isCreditNote ? 'customer' : 'supplier'} khata`")
    expect(entry.split('{barDue.text}').length - 1).toBe(2)
    // no bar prints the old text on its own JSX line (the barDue definition holds it for a sale)
    expect(entry).not.toMatch(/^\s*\{formatINR\(due\)\} due\s*$/m)
  })
  test('the old "Load all items" button is gone; lines come from lib/return-lines.ts', () => {
    expect(entry).not.toMatch(/Load all items from original/)
    expect(entry).not.toMatch(/handleLoadOriginalItems/)
    expect(entry).toContain('originalLinesOf(bill.items || [])')
  })
})
