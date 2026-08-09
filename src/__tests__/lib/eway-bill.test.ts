/**
 * When a sale needs an e-way bill.
 *
 * WHY (2026-08-09). The app could store an e-way bill number but never told a
 * shopkeeper when one was REQUIRED. Moving goods without one costs ₹10,000 or
 * the tax sought to be evaded, whichever is higher, and the vehicle can be
 * detained.
 *
 * The asymmetry is the thing to protect. Warning when none was needed costs two
 * minutes on the portal; NOT warning when one was needed costs ₹10,000. So the
 * intra-state check deliberately uses ₹50,000 rather than the higher limits
 * some states notified — see the note in eway-bill.ts.
 */
import { ewayBillNeed, invoiceMovesGoods, EWAY_BILL_THRESHOLD } from '@/lib/eway-bill'

const goods = (consignmentValue: number, isInterState = false) =>
  ewayBillNeed({ consignmentValue, isInterState, movesGoods: true })

describe('goods above the limit', () => {
  it('flags an inter-state consignment over ₹50,000', () => {
    const r = goods(60000, true)
    expect(r.status).toBe('likely-required')
    expect(r.reason).toMatch(/another state/)
  })

  it('flags an intra-state consignment over ₹50,000', () => {
    const r = goods(60000, false)
    expect(r.status).toBe('likely-required')
  })

  it('never asserts the obligation it cannot be certain of', () => {
    /*
     * Several states allow a higher intra-state limit, so within a state the
     * app cannot know. It must raise the question, not state the answer —
     * claiming certainty it does not have is how a warning becomes a lie.
     */
    const r = goods(60000, false)
    expect(r.reason).toMatch(/usually|check/i)
    expect(r.reason).not.toMatch(/you must|you need to generate/i)
  })
})

describe('goods at or below the limit', () => {
  it('does not flag exactly ₹50,000 — the rule says ABOVE', () => {
    expect(goods(EWAY_BILL_THRESHOLD).status).toBe('not-required')
  })

  it('does not flag a small sale', () => {
    expect(goods(1200).status).toBe('not-required')
  })

  it('does not flag a zero or empty consignment', () => {
    expect(goods(0).status).toBe('not-required')
  })
})

describe('services', () => {
  it('never needs one, however large', () => {
    // A salon appointment or a consulting fee has nothing to transport.
    const r = ewayBillNeed({ consignmentValue: 500000, isInterState: true, movesGoods: false })
    expect(r.status).toBe('not-required')
    expect(r.reason).toMatch(/Nothing is being transported/)
  })
})

describe('deciding whether an invoice moves goods', () => {
  it('treats a normal HSN as goods', () => {
    expect(invoiceMovesGoods([{ hsn: '3306' }])).toBe(true)
  })

  it('treats a 99xx SAC as a service', () => {
    expect(invoiceMovesGoods([{ hsn: '998314' }])).toBe(false)
  })

  it('counts a mixed invoice as moving goods', () => {
    // One physical item is enough to put a consignment on a vehicle.
    expect(invoiceMovesGoods([{ hsn: '998314' }, { hsn: '3306' }])).toBe(true)
  })

  it('treats an UNCODED line as goods — the safe direction', () => {
    /*
     * Treating a missing code as a service would switch the warning off for
     * exactly the shops most likely to need it: the ones who have not filled
     * in their HSN codes yet.
     */
    expect(invoiceMovesGoods([{ hsn: null }])).toBe(true)
    expect(invoiceMovesGoods([{ hsn: '' }])).toBe(true)
    expect(invoiceMovesGoods([{}])).toBe(true)
  })

  it('says no for an invoice with no lines at all', () => {
    expect(invoiceMovesGoods([])).toBe(false)
  })
})

describe('a free-text line keeps the HSN it was given', () => {
  /*
   * Regression guard for the data side of this feature. HSN used to come only
   * from the product master, so a line typed by hand lost its code — and a
   * missing code reads as "goods", which raised a false e-way bill warning on
   * every free-text SERVICE invoice over ₹50,000. See line-items.ts.
   */
  it('a SAC on the line marks it a service once the code survives', () => {
    expect(invoiceMovesGoods([{ hsn: '998314' }])).toBe(false)
  })

  it('and without the code it would have warned — which is why the fallback exists', () => {
    expect(invoiceMovesGoods([{ hsn: null }])).toBe(true)
  })
})
