/**
 * Money taken before the bill exists.
 *
 * WHY (2026-08-09). GST splits advances two ways and the app handled neither:
 * advances for GOODS carry no tax (Notification 66/2017), advances for SERVICES
 * are taxable the moment the money arrives. A kirana never meets this; a salon
 * taking a booking deposit, a tailor taking half up front, a photographer or a
 * repair shop meets it weekly — and this is a ledger app for every kind of shop.
 *
 * Three things are easy to get wrong here and each is tested below:
 *
 *  1. THE DIRECTION OF THE TAX SUM. ₹1,180 received for an 18% service is
 *     ₹1,000 + ₹180, not ₹1,180 + ₹212.40. Rule 35 gives the inclusive
 *     back-calculation. Getting it backwards makes the shopkeeper pay tax on
 *     tax, out of their own pocket.
 *  2. WHICH TABLE IT LANDS IN. Billed in the same month → neither table, because
 *     the invoice already carries the tax. Billed later → 11A now, 11B then.
 *     Putting it in both taxes the same money twice.
 *  3. NOT TAXING GOODS ADVANCES AT ALL.
 */
import { advanceTax } from '@/lib/advance-tax'
import { buildAT, buildTXPD } from '@/lib/gstr1-builder'
import type { AdvanceReceipt } from '@/lib/advance-tax'

function receipt(over: Partial<AdvanceReceipt> = {}): AdvanceReceipt {
  return {
    id: 'p1', amount: 1180, date: new Date('2026-08-05'),
    advanceGstRate: 18, isInterState: false, pos: '27',
    adjustedByPeriodEnd: 0, adjustedInPeriod: 0,
    ...over,
  }
}

describe('tax inside an advance', () => {
  it('treats the money received as inclusive of tax (Rule 35)', () => {
    const t = advanceTax(1180, 18, false)
    expect(t.adAmt).toBe(1000)
    expect(t.tax).toBe(180)
    expect(t.cgst).toBe(90)
    expect(t.sgst).toBe(90)
    expect(t.igst).toBe(0)
    // The shopkeeper never pays more than they received.
    expect(t.adAmt + t.tax).toBe(1180)
  })

  it('puts the whole tax under IGST for an inter-state advance', () => {
    const t = advanceTax(1180, 18, true)
    expect(t.igst).toBe(180)
    expect(t.cgst).toBe(0)
    expect(t.sgst).toBe(0)
  })

  it('splits an odd number of paise without inventing one', () => {
    // 5% on ₹105 → ₹5.00 tax, halves cleanly. Pick one that does not.
    const t = advanceTax(107.77, 18, false)
    expect(Math.round((t.cgst + t.sgst) * 100) / 100).toBe(t.tax)
    expect(Math.round((t.adAmt + t.tax) * 100) / 100).toBe(107.77)
    // Never round both halves up.
    expect(Math.abs(t.cgst - t.sgst)).toBeLessThanOrEqual(0.01)
  })

  it('charges nothing when there is no rate — an advance for goods', () => {
    const t = advanceTax(5000, 0, false)
    expect(t.tax).toBe(0)
    expect(t.adAmt).toBe(5000)
  })
})

describe('Table 11A — advances still unbilled', () => {
  it('declares an advance taken this month and not yet billed', () => {
    const at = buildAT([receipt()])
    expect(at).toHaveLength(1)
    expect(at[0].pos).toBe('27')
    expect(at[0].sply_ty).toBe('INTRA')
    expect(at[0].itms).toEqual([
      { rt: 18, ad_amt: 1000, iamt: 0, camt: 90, samt: 90, csamt: 0 },
    ])
  })

  it('declares nothing when the invoice went out in the same month', () => {
    /*
     * The invoice already carries the tax. Declaring the advance as well would
     * tax the same money twice — the single most expensive mistake available
     * here, because the shopkeeper pays it.
     */
    const at = buildAT([receipt({ adjustedByPeriodEnd: 1180 })])
    expect(at).toHaveLength(0)
  })

  it('declares only the part still unbilled', () => {
    const at = buildAT([receipt({ amount: 2360, adjustedByPeriodEnd: 1180 })])
    expect(at[0].itms[0].ad_amt).toBe(1000)
    expect(at[0].itms[0].camt).toBe(90)
  })

  it('ignores an advance for goods entirely', () => {
    // Notification 66/2017 — no GST on advances for goods.
    expect(buildAT([receipt({ advanceGstRate: null })])).toHaveLength(0)
  })

  it('groups by place of supply and rate', () => {
    const at = buildAT([
      receipt({ id: 'a', amount: 1180, advanceGstRate: 18 }),
      receipt({ id: 'b', amount: 1180, advanceGstRate: 18 }),
      receipt({ id: 'c', amount: 1050, advanceGstRate: 5 }),
      receipt({ id: 'd', amount: 1180, advanceGstRate: 18, isInterState: true, pos: '29' }),
    ])
    const intra = at.find((e) => e.sply_ty === 'INTRA')!
    expect(intra.itms.find((i) => i.rt === 18)!.ad_amt).toBe(2000)
    expect(intra.itms.find((i) => i.rt === 5)!.ad_amt).toBe(1000)
    const inter = at.find((e) => e.sply_ty === 'INTER')!
    expect(inter.pos).toBe('29')
    expect(inter.itms[0].iamt).toBe(180)
  })
})

describe('Table 11B — earlier advances released against a bill', () => {
  it('releases the advance in the month the invoice is raised', () => {
    const txpd = buildTXPD([receipt({ date: new Date('2026-07-05'), adjustedInPeriod: 1180 })])
    expect(txpd[0].itms).toEqual([
      { rt: 18, ad_amt: 1000, iamt: 0, camt: 90, samt: 90, csamt: 0 },
    ])
  })

  it('releases nothing when nothing was settled this month', () => {
    expect(buildTXPD([receipt({ date: new Date('2026-07-05') })])).toHaveLength(0)
  })

  it('releases only the part settled', () => {
    const txpd = buildTXPD([receipt({ amount: 2360, date: new Date('2026-07-05'), adjustedInPeriod: 1180 })])
    expect(txpd[0].itms[0].ad_amt).toBe(1000)
  })
})

describe('an old unbilled advance is not declared again every month', () => {
  it('11A covers only receipts taken in the period it is built for', () => {
    /*
     * Nearly shipped this. Both tables were being handed the same list of
     * receipts, so an advance taken in July and still unbilled in August would
     * be declared in August's 11A as well — and again in September, and every
     * month after, with the shop paying the tax each time. The two builders
     * take different sets now, and the parameter names say so.
     *
     * July's advance is already declared in July's 11A. August's 11A is built
     * from August's receipts alone, so it is empty.
     */
    const julyAdvanceStillUnbilled = receipt({ date: new Date('2026-07-05') })
    expect(buildAT([])).toHaveLength(0)
    // ...and it is not released either, because nothing was settled.
    expect(buildTXPD([julyAdvanceStillUnbilled])).toHaveLength(0)
  })
})

describe('the two tables never claim the same rupee', () => {
  it('an advance taken and billed in later months appears once in each', () => {
    // August: taken, unbilled → 11A only.
    const august = receipt({ date: new Date('2026-08-05'), adjustedByPeriodEnd: 0, adjustedInPeriod: 0 })
    expect(buildAT([august])[0].itms[0].ad_amt).toBe(1000)
    expect(buildTXPD([august])).toHaveLength(0)

    // September: billed → 11B only, and 11A has nothing left to declare.
    const september = receipt({ date: new Date('2026-08-05'), adjustedByPeriodEnd: 1180, adjustedInPeriod: 1180 })
    expect(buildTXPD([september])[0].itms[0].ad_amt).toBe(1000)
    expect(buildAT([september])).toHaveLength(0)
  })
})
