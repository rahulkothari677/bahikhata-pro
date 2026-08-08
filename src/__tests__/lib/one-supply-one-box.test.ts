/**
 * A supply is reported in exactly one box, and both returns agree which.
 *
 * WHY (2026-08-08, found by reconciling GSTR-1 against GSTR-3B in production).
 * Two separate defects met here:
 *
 *  1. DOUBLE REPORTING. buildB2B/buildB2CL/buildB2CS emitted every line,
 *     including nil-rated and exempt ones, as 0%-rated rows — and buildNIL then
 *     reported the SAME values again in Table 8. For August 2026 that was
 *     ₹3,059 counted twice in one return (₹120 in B2B, ₹2,939 in B2CS). It
 *     inflates GSTR-1 turnover against the books and against GSTR-3B, which is
 *     the reconciliation the department actually runs.
 *
 *  2. TWO RULES. GSTR-1 classified from the snapshot on the line with a
 *     rate-based fallback; GSTR-3B joined live to Product and deliberately kept
 *     0%-with-no-treatment inside outward TAXABLE supplies. The same shop's
 *     August: GSTR-1 said ₹2,959 nil + ₹100 exempt, GSTR-3B said ₹0 nil +
 *     ₹3,034 exempt, with ₹25 stranded in 3.1(a).
 *
 * Both now go through `classifySupplyLine`. These tests pin the rule itself and
 * the no-double-counting property, because a change to either is a change to
 * what gets filed.
 */
import { classifySupplyLine, isTaxableSupply } from '@/lib/supply-classification'
import { buildB2B, buildB2CS, buildNIL, type Gstr1Transaction } from '@/lib/gstr1-builder'

const SHOP = { gstin: '27AAAPA1234A1Z5', state: 'Maharashtra', stateCode: '27' }

function line(over: Partial<Gstr1Transaction['items'][0]> = {}) {
  return {
    productId: 'p1', productName: 'Item', hsn: '1006', quantity: 1, unit: 'pc',
    unitPrice: 100, gstRate: 0, discountAmount: 0,
    cgst: 0, sgst: 0, igst: 0, csamt: 0, total: 100,
    ...over,
  } as Gstr1Transaction['items'][0]
}

function sale(over: Partial<Gstr1Transaction> = {}): Gstr1Transaction {
  return {
    id: 't1', type: 'sale', date: new Date('2026-08-10'), invoiceNo: 'INV-1',
    totalAmount: 100, subtotal: 100, discountAmount: 0,
    cgst: 0, sgst: 0, igst: 0, isInterState: false, isReverseCharge: false,
    partyGstin: null, partyName: 'Walk-in', partyState: 'Maharashtra',
    items: [line()],
    ...over,
  } as Gstr1Transaction
}

describe('the classification rule', () => {
  it('honours what the shopkeeper declared', () => {
    expect(classifySupplyLine({ gstTreatment: 'exempt', gstRate: 0 })).toBe('exempt')
    expect(classifySupplyLine({ gstTreatment: 'nonGst', gstRate: 0 })).toBe('nonGst')
    expect(classifySupplyLine({ gstTreatment: 'nil', gstRate: 0 })).toBe('nil')
    expect(classifySupplyLine({ gstTreatment: 'taxable', gstRate: 18 })).toBe('taxable')
  })

  it('treats an undeclared 0% line as nil-rated, not as a taxable supply', () => {
    /*
     * This is the ₹25. GSTR-3B used to put these in 3.1(a) "outward taxable
     * supplies" on the reasoning that 0% is still taxable. 3.1(a) is headed
     * "other than zero rated, nil rated and exempted", and no tax was charged,
     * so it cannot be declared as a supply on which tax is due.
     */
    expect(classifySupplyLine({ gstTreatment: null, gstRate: 0 })).toBe('nil')
    expect(classifySupplyLine({ gstRate: 0 })).toBe('nil')
  })

  it('treats an undeclared rated line as taxable', () => {
    expect(classifySupplyLine({ gstTreatment: null, gstRate: 18 })).toBe('taxable')
  })

  it('ignores a value it does not recognise rather than trusting it', () => {
    // A junk treatment must not silently become its own box.
    expect(classifySupplyLine({ gstTreatment: 'zero-rated', gstRate: 18 })).toBe('taxable')
    expect(classifySupplyLine({ gstTreatment: 'nonsense', gstRate: 0 })).toBe('nil')
  })

  it('agrees with isTaxableSupply', () => {
    expect(isTaxableSupply({ gstTreatment: null, gstRate: 18 })).toBe(true)
    expect(isTaxableSupply({ gstTreatment: 'exempt', gstRate: 0 })).toBe(false)
    expect(isTaxableSupply({ gstTreatment: null, gstRate: 0 })).toBe(false)
  })
})

describe('GSTR-1 reports each supply once', () => {
  it('keeps an exempt line out of B2CS, because Table 8 already has it', () => {
    const txns = [sale({
      items: [
        line({ productName: 'Rice', gstTreatment: 'exempt', unitPrice: 2939 }),
        line({ productName: 'Soap', gstTreatment: 'taxable', gstRate: 18, unitPrice: 1259, cgst: 113.31, sgst: 113.31 }),
      ],
    })]

    const b2cs = buildB2CS(txns, SHOP)
    const nil = buildNIL(txns)

    // Only the taxable line is in the rate-wise table...
    expect(b2cs.map(r => r.txval)).toEqual([1259])
    expect(b2cs.find(r => r.rt === 0)).toBeUndefined()
    // ...and the exempt value is in Table 8, exactly once.
    expect(nil.inv.find(r => r.sply_ty === 'INTRAB2C')!.expt_amt).toBe(2939)
  })

  it('keeps a nil line out of B2B', () => {
    const txns = [sale({
      partyGstin: '27BBBPB1234B1Z5',
      items: [
        line({ productName: 'Salt', gstRate: 0, unitPrice: 120 }),
        line({ productName: 'Oil', gstRate: 5, unitPrice: 500, cgst: 12.5, sgst: 12.5 }),
      ],
    })]

    const b2b = buildB2B(txns, SHOP)
    const nil = buildNIL(txns)

    const items = b2b[0].inv[0].itms
    expect(items).toHaveLength(1)
    expect(items[0].itm_det.txval).toBe(500)
    expect(nil.inv.find(r => r.sply_ty === 'INTRAB2B')!.nil_amt).toBe(120)
  })

  it('drops a wholly exempt invoice from B2B entirely', () => {
    // An invoice with nothing taxable on it belongs in Table 8 alone. Emitting
    // it with an empty item list would declare an invoice carrying no supply.
    const txns = [sale({
      partyGstin: '27BBBPB1234B1Z5',
      items: [line({ gstTreatment: 'exempt', unitPrice: 400 })],
    })]

    expect(buildB2B(txns, SHOP)).toHaveLength(0)
    expect(buildNIL(txns).inv.find(r => r.sply_ty === 'INTRAB2B')!.expt_amt).toBe(400)
  })

  it('never reports the same rupee in both places', () => {
    /*
     * The property, stated directly: taxable tables + Table 8 must equal the
     * month's supplies, with no overlap. This is the assertion that fails if
     * the item filter is ever removed from any one builder.
     */
    const txns = [sale({
      items: [
        line({ productName: 'Rice', gstTreatment: 'exempt', unitPrice: 300 }),
        line({ productName: 'Salt', gstRate: 0, unitPrice: 200 }),
        line({ productName: 'Petrol', gstTreatment: 'nonGst', unitPrice: 500 }),
        line({ productName: 'Soap', gstRate: 18, unitPrice: 1000, cgst: 90, sgst: 90 }),
      ],
    })]

    const taxableTotal = buildB2CS(txns, SHOP).reduce((a, r) => a + r.txval, 0)
    const eight = buildNIL(txns).inv.find(r => r.sply_ty === 'INTRAB2C')!
    const eightTotal = eight.nil_amt + eight.expt_amt + eight.ngsup_amt

    expect(taxableTotal).toBe(1000)
    expect(eightTotal).toBe(1000)  // 300 + 200 + 500
    // Together they account for every rupee exactly once.
    expect(taxableTotal + eightTotal).toBe(2000)
  })

  it('filters a credit note on the same rule as the sale it reverses', () => {
    // Otherwise a note against an exempt supply would reduce the rate-wise
    // table it was never added to, pushing B2CS negative.
    const txns = [
      sale({ id: 's', invoiceNo: 'INV-1', items: [line({ gstTreatment: 'exempt', unitPrice: 500 })] }),
      sale({
        id: 'n', type: 'credit-note', invoiceNo: 'CN-1', originalTransactionId: 's',
        items: [line({ gstTreatment: 'exempt', unitPrice: 500 })],
      }),
    ]

    const b2cs = buildB2CS(txns, SHOP)
    expect(b2cs.every(r => r.txval >= 0)).toBe(true)
    expect(b2cs).toHaveLength(0)
  })
})
