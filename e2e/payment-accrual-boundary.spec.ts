import { test, expect } from './fixtures'
import { E2E_CUSTOMER } from './seed-e2e-user'

/**
 * A payment moves cash. It must never change revenue or tax.
 *
 * WHY THIS IS THE TEST WORTH HAVING (#19, audit 2026-08-13). This is the
 * accrual boundary, and it is where the worst bug of this whole audit lived:
 * an udhaar sale with an empty Paid field was recorded as FULLY PAID, so a
 * shopkeeper's ledger quietly forgot money they were owed. 2,700 unit tests
 * passed the entire time that was live, because every piece was correct on its
 * own and the defect sat between them. Only using the product found it.
 *
 * The rule, in a sentence a shopkeeper would recognise:
 *
 *   Writing the bill is when you EARNED it. Being paid is when the money
 *   ARRIVED. The tax follows the bill, never the payment.
 *
 * So a credit sale raises revenue and raises what that customer owes. The
 * payment that follows lowers what they owe and RAISES NOTHING ELSE — same
 * revenue, same GST, to the rupee.
 *
 * WHY THE CUSTOMER'S BALANCE AND NOT `totalReceivable`. The first draft
 * asserted the dashboard's receivable KPI and it did not move at all. Running
 * it against the live app first showed why: that KPI sums only customers who
 * are in debit, so a customer sitting in credit contributes nothing to it. The
 * party balance is both the correct figure and the one a shopkeeper actually
 * reads — it is the answer to "kitna baaki hai".
 *
 * Every number here comes from the endpoints the app itself renders, against a
 * real database. Nothing is mocked, which is the entire point: a unit test
 * cannot see this, because everything it would mock is the part that works.
 */

const SALE = 1000        // rupees. The seeded product is 0% GST — see seed-e2e-user.ts
const PART_PAYMENT = 400

type Money = { revenue: number; outputTax: number; customerBalance: number }

/** The figures the boundary is about, read the way the app reads them. */
async function snapshot(
  request: import('@playwright/test').APIRequestContext,
  customerId: string,
): Promise<Money> {
  const dash = await (await request.get('/api/dashboard')).json()
  const parties = await (await request.get('/api/parties?limit=200')).json()
  const list = (parties.parties ?? parties) as Array<{ id: string; balance: number }>
  const me = list.find((p) => p.id === customerId)
  return {
    revenue: dash.kpis.rangeRevenue,
    outputTax: dash.gstSummary.outputTax,
    customerBalance: me?.balance ?? NaN,
  }
}

async function seededCustomer(request: import('@playwright/test').APIRequestContext) {
  const parties = await (await request.get('/api/parties?limit=200')).json()
  const list = (parties.parties ?? parties) as Array<{ id: string; name: string; type: string }>
  const c = list.find((p) => p.name === E2E_CUSTOMER.name)
  expect(c, `the seeded customer "${E2E_CUSTOMER.name}" must exist`).toBeTruthy()
  // A sale to a SUPPLIER would not move a receivable at all — the first draft
  // of this test picked parties[0], which was a supplier, and proved nothing.
  expect(c!.type).toBe('customer')
  return c!
}

test.describe('Accrual boundary: the bill earns it, the payment collects it', () => {
  test('a credit sale raises revenue and what is owed; the payment raises neither', async ({
    loggedInPage,
  }) => {
    const request = loggedInPage.request
    const customer = await seededCustomer(request)
    const before = await snapshot(request, customer.id)

    // ── 1. An udhaar sale. Nothing paid yet. ──────────────────────────────
    const saleRes = await request.post('/api/transactions', {
      data: {
        type: 'sale',
        partyId: customer.id,
        date: new Date().toISOString().slice(0, 10),
        items: [{ productName: 'E2E Accrual Widget', quantity: 1, unitPrice: SALE, gstRate: 0 }],
        paymentMode: 'credit',
        // paidAmount deliberately absent. THIS EXACT SHAPE is what used to be
        // recorded as paid in full, and it is the bug this test guards.
      },
    })
    expect(saleRes.ok(), await saleRes.text()).toBeTruthy()
    const saleId = (await saleRes.json()).transaction.id
    const afterSale = await snapshot(request, customer.id)

    // The bill earned it, even though no money has arrived.
    expect(afterSale.revenue).toBeCloseTo(before.revenue + SALE, 2)
    // ...and the customer owes it. THE UDHAAR BUG FAILS HERE: recorded as paid
    // in full, this balance would not move at all.
    expect(afterSale.customerBalance).toBeCloseTo(before.customerBalance + SALE, 2)

    // ── 2. They pay part of it. ───────────────────────────────────────────
    const payRes = await request.post('/api/payments', {
      data: {
        partyId: customer.id,
        amount: PART_PAYMENT,
        // 'received', not 'receive' — the API rejects the latter. Learned by
        // asking the live app rather than by guessing.
        type: 'received',
        mode: 'cash',
        date: new Date().toISOString().slice(0, 10),
      },
    })
    expect(payRes.ok(), await payRes.text()).toBeTruthy()
    const paymentId = (await payRes.json()).payment?.id
    const afterPayment = await snapshot(request, customer.id)

    // ── 3. THE BOUNDARY ──────────────────────────────────────────────────
    // Money arrived, so less is owed.
    expect(afterPayment.customerBalance).toBeCloseTo(afterSale.customerBalance - PART_PAYMENT, 2)

    // ...and nothing else moved. Revenue was earned when the bill was written.
    expect(afterPayment.revenue).toBeCloseTo(afterSale.revenue, 2)
    // The tax follows the bill, never the payment. A payment that changed GST
    // would put a wrong number on a return.
    expect(afterPayment.outputTax).toBeCloseTo(afterSale.outputTax, 2)

    // ── 4. Clean up, and prove the books came back. ──────────────────────
    if (paymentId) await request.delete(`/api/payments/${paymentId}`)
    await request.delete(`/api/transactions/${saleId}`)

    const restored = await snapshot(request, customer.id)
    expect(restored.revenue).toBeCloseTo(before.revenue, 2)
    expect(restored.outputTax).toBeCloseTo(before.outputTax, 2)
    expect(restored.customerBalance).toBeCloseTo(before.customerBalance, 2)
  })

  test('an udhaar sale is never silently marked as paid', async ({ loggedInPage }) => {
    /*
     * The udhaar bug on its own, at the level a shopkeeper would see it. Kept
     * separate from the boundary test so that if this breaks, the failure names
     * the cause instead of being one assertion among many.
     */
    const request = loggedInPage.request
    const customer = await seededCustomer(request)

    const res = await request.post('/api/transactions', {
      data: {
        type: 'sale',
        partyId: customer.id,
        date: new Date().toISOString().slice(0, 10),
        items: [{ productName: 'E2E Udhaar Widget', quantity: 1, unitPrice: SALE, gstRate: 0 }],
        paymentMode: 'credit',
        // No paidAmount. "They will pay later" — the whole point of udhaar.
      },
    })
    expect(res.ok(), await res.text()).toBeTruthy()
    const sale = (await res.json()).transaction

    expect(sale.paidAmount).toBe(0)
    expect(sale.totalAmount).toBeCloseTo(SALE, 2)

    await request.delete(`/api/transactions/${sale.id}`)
  })
})
