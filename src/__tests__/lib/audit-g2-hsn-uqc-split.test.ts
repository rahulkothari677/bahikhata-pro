/**
 * 🔒 AUDIT G2 — GSTR-1 Table 12 (HSN summary) must not add quantities across
 * different units of measure.
 *
 * THE BUG: buildHSN aggregated by `hsn|gstRate` and took `uqc` from whichever
 * item was encountered FIRST, then summed every quantity into it. A shop
 * selling one HSN both loose (kg) and in packets filed a single row reading
 * "15 KGS" for 5 kg + 10 packets.
 *
 * Why it went unnoticed: the value and tax columns stayed correct. Only the
 * quantity became meaningless, so neither the app nor the return looked wrong
 * — Table 12 simply carried a number that describes nothing real.
 */

import { buildHSN } from '@/lib/gstr1-builder'

function item(over: Partial<any> = {}) {
  return {
    productName: 'Rice',
    hsn: '1006',
    quantity: 1,
    unitPrice: 100,
    unit: 'kg',
    gstRate: 5,
    discountAmount: 0,
    cgst: 2.5,
    sgst: 2.5,
    igst: 0,
    csamt: 0,
    ...over,
  }
}

function txn(items: any[], over: Partial<any> = {}) {
  return {
    id: 't1',
    type: 'sale',
    date: new Date('2026-06-15'),
    invoiceNo: 'INV-0001',
    totalAmount: 105,
    isInterState: false,
    partyGstin: null,
    partyState: 'Maharashtra',
    items,
    ...over,
  } as any
}

describe('G2 — HSN summary splits rows by unit of measure', () => {
  test('same HSN + rate but different units produce SEPARATE rows', () => {
    const { data } = buildHSN([
      txn([
        item({ quantity: 5, unit: 'kg' }),
        item({ quantity: 10, unit: 'packet' }),
      ]),
    ])

    // Pre-fix: ONE row, qty 15, uqc 'KGS' — 5 kg and 10 packets added together.
    expect(data).toHaveLength(2)

    const kgs = data.find(d => d.uqc === 'KGS')
    const pac = data.find(d => d.uqc === 'PAC')

    expect(kgs).toBeDefined()
    expect(pac).toBeDefined()
    expect(kgs!.qty).toBe(5)
    expect(pac!.qty).toBe(10)
    expect(kgs!.hsn_sc).toBe('1006')
    expect(pac!.hsn_sc).toBe('1006')
  })

  test('same HSN + rate + SAME unit still aggregates into one row', () => {
    // The fix must not fragment the common case.
    const { data } = buildHSN([
      txn([
        item({ quantity: 5, unit: 'kg' }),
        item({ quantity: 7, unit: 'kg' }),
      ]),
    ])

    expect(data).toHaveLength(1)
    expect(data[0].qty).toBe(12)
    expect(data[0].uqc).toBe('KGS')
  })

  test('different rates under one HSN stay separate (unchanged behaviour)', () => {
    const { data } = buildHSN([
      txn([
        item({ quantity: 5, unit: 'kg', gstRate: 5 }),
        item({ quantity: 3, unit: 'kg', gstRate: 12 }),
      ]),
    ])

    expect(data).toHaveLength(2)
    // numeric comparator — default .sort() is lexicographic, so [5, 12] would
    // come back as [12, 5].
    expect(data.map(d => d.rt).sort((a, b) => a - b)).toEqual([5, 12])
  })

  test('credit notes reduce the row matching their own unit, not another', () => {
    const { data } = buildHSN([
      txn([
        item({ quantity: 10, unit: 'kg' }),
        item({ quantity: 10, unit: 'packet' }),
      ]),
      txn([item({ quantity: 4, unit: 'kg' })], { id: 't2', type: 'credit-note' }),
    ])

    const kgs = data.find(d => d.uqc === 'KGS')
    const pac = data.find(d => d.uqc === 'PAC')

    // The return was of loose kg, so only the KGS row may move.
    expect(kgs!.qty).toBe(6)
    expect(pac!.qty).toBe(10)
  })

  test('value and tax columns are unaffected by the split', () => {
    const oneUnit = buildHSN([txn([item({ quantity: 5, unit: 'kg' }), item({ quantity: 10, unit: 'kg' })])])
    const twoUnits = buildHSN([txn([item({ quantity: 5, unit: 'kg' }), item({ quantity: 10, unit: 'packet' })])])

    const sum = (rows: any[], f: string) => rows.reduce((s, r) => s + r[f], 0)

    // Splitting by unit redistributes rows; it must not change the totals that
    // actually carry tax liability.
    expect(sum(twoUnits.data, 'txval')).toBeCloseTo(sum(oneUnit.data, 'txval'), 2)
    expect(sum(twoUnits.data, 'camt')).toBeCloseTo(sum(oneUnit.data, 'camt'), 2)
    expect(sum(twoUnits.data, 'samt')).toBeCloseTo(sum(oneUnit.data, 'samt'), 2)
  })
})
