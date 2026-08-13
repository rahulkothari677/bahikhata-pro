import { test, expect } from './fixtures'
import { E2E_CUSTOMER } from './seed-e2e-user'

/**
 * The tax on a bill reaches the GST figures, and the reports open.
 *
 * WHY (#19, audit 2026-08-13). EkBook's whole claim is that it is a compliance
 * engine, not a register. The number that ends up on a GSTR-1 is the sharpest
 * end of that: a wrong figure there is a notice from the department, not a
 * cosmetic bug.
 *
 * Deliberately narrow. This does NOT try to prove the GST engine correct —
 * that is a large audit in its own right, and there are hundreds of unit tests
 * for the arithmetic. What it proves is the thing unit tests cannot: that a
 * bill recorded through the real API, in the real database, actually shows up
 * in the tax the app reports, with the tax it was charged. Every join between
 * the sale and the summary is real.
 *
 * ₹1,000 at 18% intra-state is ₹90 CGST + ₹90 SGST. Round numbers on purpose,
 * so a wrong answer has one explanation rather than a rounding argument.
 */

const NET = 1000
const RATE = 18
const EXPECTED_TAX = (NET * RATE) / 100        // 180 total
const EXPECTED_HALF = EXPECTED_TAX / 2         // 90 CGST + 90 SGST, intra-state

async function gstSummary(request: import('@playwright/test').APIRequestContext) {
  const d = await (await request.get('/api/dashboard')).json()
  return d.gstSummary as { cgst: number; sgst: number; igst: number; outputTax: number }
}

test.describe('GST figures follow the bill', () => {
  test('a taxed sale reaches the GST summary, split correctly', async ({ loggedInPage }) => {
    const request = loggedInPage.request

    const parties = await (await request.get('/api/parties?limit=200')).json()
    const list = (parties.parties ?? parties) as Array<{ id: string; name: string }>
    const customer = list.find((p) => p.name === E2E_CUSTOMER.name)
    expect(customer, 'the seeded customer must exist').toBeTruthy()

    const before = await gstSummary(request)

    const res = await request.post('/api/transactions', {
      data: {
        type: 'sale',
        partyId: customer!.id,
        date: new Date().toISOString().slice(0, 10),
        items: [{ productName: 'E2E Taxed Widget', quantity: 1, unitPrice: NET, gstRate: RATE }],
        paymentMode: 'cash',
        paidAmount: NET + EXPECTED_TAX,
      },
    })
    expect(res.ok(), await res.text()).toBeTruthy()
    const sale = (await res.json()).transaction

    // The bill itself carries the tax, split in two for a sale inside the state.
    expect(sale.cgst + sale.sgst + sale.igst).toBeCloseTo(EXPECTED_TAX, 2)

    const after = await gstSummary(request)

    // And that tax reaches what the app reports it owes. This is the join a
    // unit test cannot exercise: a real row, through a real query, into a real
    // total.
    expect(after.outputTax).toBeCloseTo(before.outputTax + EXPECTED_TAX, 2)

    /*
     * The split must be right, and BOTH cases are asserted — never skipped.
     *
     * The first draft wrapped this in `if (!sale.isInterState)`, which would
     * have quietly checked nothing on an inter-state sale. That is the same
     * "skip the step if the thing isn't there" pattern that let the old E2E
     * suite pass while testing nothing, and running this against the live app
     * is what exposed it: that account's customer is in another state, so the
     * sale came back IGST and the whole block would have been skipped.
     *
     * Putting the tax in the wrong column is a real filing error either way —
     * IGST on a local sale, or CGST+SGST on an inter-state one — so each
     * branch asserts the money went to the right place AND not to the wrong one.
     */
    if (sale.isInterState) {
      expect(after.igst).toBeCloseTo(before.igst + EXPECTED_TAX, 2)
      expect(after.cgst).toBeCloseTo(before.cgst, 2)
      expect(after.sgst).toBeCloseTo(before.sgst, 2)
    } else {
      expect(after.cgst).toBeCloseTo(before.cgst + EXPECTED_HALF, 2)
      expect(after.sgst).toBeCloseTo(before.sgst + EXPECTED_HALF, 2)
      expect(after.igst).toBeCloseTo(before.igst, 2)
    }

    // Clean up, and prove the tax figures came back to where they started.
    await request.delete(`/api/transactions/${sale.id}`)
    const restored = await gstSummary(request)
    expect(restored.outputTax).toBeCloseTo(before.outputTax, 2)
    expect(restored.cgst).toBeCloseTo(before.cgst, 2)
    expect(restored.sgst).toBeCloseTo(before.sgst, 2)
  })

  test('a deleted bill stops counting towards the tax owed', async ({ loggedInPage }) => {
    /*
     * Its own test because it is its own failure. A deleted invoice that still
     * counted would inflate a return — the shopkeeper would pay tax on a sale
     * they cancelled, and would have no way to see why the figure was wrong.
     */
    const request = loggedInPage.request
    const parties = await (await request.get('/api/parties?limit=200')).json()
    const list = (parties.parties ?? parties) as Array<{ id: string; name: string }>
    const customer = list.find((p) => p.name === E2E_CUSTOMER.name)!

    const before = await gstSummary(request)
    const res = await request.post('/api/transactions', {
      data: {
        type: 'sale',
        partyId: customer.id,
        date: new Date().toISOString().slice(0, 10),
        items: [{ productName: 'E2E Cancelled Widget', quantity: 1, unitPrice: NET, gstRate: RATE }],
        paymentMode: 'cash',
        paidAmount: NET + EXPECTED_TAX,
      },
    })
    const sale = (await res.json()).transaction

    const withSale = await gstSummary(request)
    // Control: it counted while it existed, so the check below is not vacuous.
    expect(withSale.outputTax).toBeCloseTo(before.outputTax + EXPECTED_TAX, 2)

    await request.delete(`/api/transactions/${sale.id}`)

    const afterDelete = await gstSummary(request)
    expect(afterDelete.outputTax).toBeCloseTo(before.outputTax, 2)
  })
})
