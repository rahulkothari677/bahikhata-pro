/**
 * 🔒 THE ACCRUAL BOUNDARY: what a PAYMENT may and may not move.
 *
 * Rahul asked whether the settle-payment workflow is correct "according to
 * ledger... including GST and all other places". This pins the rule the whole
 * ledger rests on, because the drawer bug of 2026-08-03 was a breach of it:
 * the drawer mixed invoice value (accrual) with cash collected.
 *
 * A SALE books revenue and GST liability the moment it is invoiced.
 * A PAYMENT moves cash and reduces the party's balance. It is not revenue, and
 * it never changes tax.
 *
 * Concretely, a Settle payment MUST:
 *   - reduce the bill's due and the party's balance
 *   - appear in cash/collection figures
 * and MUST NOT:
 *   - change revenue, profit, or any GST return
 *   - be counted a second time inside an invoice total
 *
 * Getting this backwards in either direction is a filing error, not a display
 * bug: counting collections as revenue would overstate turnover, and letting
 * a payment touch GSTR-1 would file tax on money rather than on invoices.
 */
import fs from 'fs'
import path from 'path'

function read(rel: string): string {
  return fs.readFileSync(path.join(process.cwd(), rel), 'utf8')
}
function exists(rel: string): boolean {
  return fs.existsSync(path.join(process.cwd(), rel))
}

/** Files that compute GST returns. None may read the Payment table. */
const GST_SOURCES = [
  'src/lib/gstr1-builder.ts',
  'src/lib/e-invoice.ts',
  'src/app/api/gstr-export/route.ts',
].filter(exists)

describe('GST is computed from invoices, never from payments', () => {
  test('the GST sources were actually found', () => {
    // Without this the loop below could pass by iterating an empty list.
    expect(GST_SOURCES.length).toBeGreaterThanOrEqual(2)
  })

  for (const rel of GST_SOURCES) {
    test(`${rel} does not read the Payment table`, () => {
      const src = read(rel)
        .replace(/\/\*[\s\S]*?\*\//g, ' ')
        .replace(/(^|[^:])\/\/.*$/gm, '$1')
      // `paymentMode` / `paymentTerms` on the INVOICE are fine — that is an
      // invoice field. Reading db.payment or paymentAllocations is not.
      expect(src).not.toMatch(/db\.payment\b/)
      expect(src).not.toMatch(/paymentAllocations/)
    })
  }
})

describe('the dashboard keeps collections out of revenue', () => {
  const src = read('src/app/api/dashboard/route.ts')

  test('payments are aggregated separately from sales', () => {
    expect(src).toMatch(/db\.payment\.aggregate/)
  })

  test('the separation is stated where the next reader will see it', () => {
    // A rule that lives only in a test gets undone by someone who never runs it.
    expect(src).toMatch(/NOT revenue/i)
  })

  test('soft-deleted payments are excluded', () => {
    const block = src.slice(src.indexOf('db.payment.aggregate'), src.indexOf('db.payment.aggregate') + 400)
    expect(block).toMatch(/deletedAt:\s*null/)
  })
})

describe('the cash drawer separates invoice value from money received', () => {
  const src = read('src/app/api/day-summary/route.ts')

  test('revenue and cash are tracked as different quantities', () => {
    // totalAmount drives revenue lines; paidAmount drives cash lines.
    expect(src).toMatch(/totalAmount:\s*true,\s*paidAmount:\s*true/)
    expect(src).toMatch(/cashInFromSales/)
  })

  test('the drawer total is built only from cash-mode terms', () => {
    const start = src.indexOf('const expectedCash =')
    const formula = src.slice(start, src.lastIndexOf('return NextResponse.json'))
    expect(start).toBeGreaterThan(-1)
    expect(formula.length).toBeGreaterThan(50)
    for (const term of ['cashInFromSales', 'udhaarCollectedCash', 'cashOutForPurchases', 'udhaarPaidCash']) {
      expect(formula).toContain(term)
    }
  })
})

describe('a money mutation refreshes every screen that shows money', () => {
  const src = read('src/lib/invalidate-money-caches.ts')

  test('the single bill is invalidated, not just the list', () => {
    // ['transactions'] does NOT prefix-match ['transaction', id]. Settling a
    // bill and returning to it showed pre-payment figures.
    expect(src).toMatch(/queryKey:\s*\['transaction'\]/)
  })

  test('the cash drawer is invalidated', () => {
    // Every sale, payment and expense changes expected cash.
    expect(src).toMatch(/queryKey:\s*\['day-summary'\]/)
  })
})

/**
 * 🔒 EVERY REPORT DECLARES ITS BASIS — task #11, audited 2026-08-03.
 *
 * Each surface must be on ONE basis and stay there. The cash-drawer bug was a
 * report that mixed them: invoice value (accrual) plus collections (cash).
 *
 *   ACCRUAL — booked when invoiced. P&L, GST.
 *   CASH    — booked when money moves. Cash-flow, the drawer.
 *
 * A report that silently changes basis is not a display bug: on a P&L it
 * misstates profit, and on a cash-flow it misstates the money in hand.
 */
describe('#11 — each report stays on one basis', () => {
  const reportsSrc = fs.readFileSync(path.join(process.cwd(), 'src/app/api/reports/route.ts'), 'utf8')
    .replace(/\r\n/g, '\n')

  const branch = (marker: string, endMarker: string) => {
    const i = reportsSrc.indexOf(marker)
    expect(i).toBeGreaterThan(-1)
    const j = reportsSrc.indexOf(endMarker, i)
    return reportsSrc.slice(i, j > i ? j : i + 4000)
  }

  test('P&L is ACCRUAL — invoice value, never the Payment table', () => {
    const pl = branch("if (type === 'pl')", "if (type === 'stock')")
    expect(pl).toMatch(/_sum: \{ totalAmount: true/)
    // Reading payments here would turn profit into a collections figure.
    expect(pl).not.toMatch(/db\.payment\./)
  })

  test('cash-flow is CASH — paidAmount for invoices, plus payments separately', () => {
    const cf = branch("if (type === 'cashflow')", "type: 'cashflow',")

    /*
     * Asserted at the CONSUMPTION site, not the query.
     *
     * The first version of this test checked the branch merely contained
     * `_sum: { paidAmount: true` — and it passed while the sales query was
     * deliberately broken to select totalAmount, because the PURCHASE query a
     * few lines down still matched. A guard that any nearby line can satisfy
     * guards nothing. Caught by breaking the code and seeing green.
     *
     * These pin which field each flow is actually built from.
     */
    expect(cf).toMatch(/salesAgg\.forEach\(row => \{\s*const amount = row\._sum\.paidAmount/)
    expect(cf).toMatch(/purchaseAgg\.forEach\(row => \{\s*const amount = row\._sum\.paidAmount/)
    // Using totalAmount for those would count money not yet received, and then
    // count it again below as a settlement — the cash-drawer bug.
    expect(cf).not.toMatch(/salesAgg\.forEach\(row => \{\s*const amount = row\._sum\.totalAmount/)

    // ...and settlements are added as their own rows.
    expect(cf).toMatch(/db\.payment\.groupBy/)
    expect(cf).toMatch(/paymentsReceivedAgg\.forEach/)
    expect(cf).toMatch(/paymentsPaidAgg\.forEach/)
  })

  test('the party report counts collections as well as invoices', () => {
    // Fixed as task #12: periodActivity was invoice-only while `balance` on
    // the same row already included payments, so the two disagreed.
    expect(reportsSrc).toMatch(/periodPaymentAgg/)
  })

  test('bank reconciliation matches money movements, and excludes cash', () => {
    const recon = fs.readFileSync(path.join(process.cwd(), 'src/lib/bank-recon.ts'), 'utf8')
    // Cash never appears on a bank statement; matching it would invent matches.
    expect(recon).toMatch(/cash payments can't be reconciled/i)
  })
})

describe('#11 — surfaces that show a bill due use the one shared definition', () => {
  const files = [
    'src/lib/statement-balance.ts',
    'src/lib/invoice-pdf.ts',
    'src/app/api/whatsapp-reminder/route.ts',
    'src/app/api/insights/route.ts',
  ]

  test('the file list is real', () => {
    for (const f of files) expect(fs.existsSync(path.join(process.cwd(), f))).toBe(true)
  })

  for (const f of files) {
    test(`${f} computes due via the shared helper, not inline`, () => {
      const s = fs.readFileSync(path.join(process.cwd(), f), 'utf8')
      // The helper subtracts allocations; `total - paidAmount` does not, which
      // is the stale Due that invites collecting a bill twice.
      expect(s).toMatch(/computeInvoiceDue|computeDueBreakdown/)
    })
  }
})
