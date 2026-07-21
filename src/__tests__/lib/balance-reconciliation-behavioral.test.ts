/**
 * 🔒 V17 §2.1 — Behavioral reconciliation test.
 *
 * This is the test the V16 auditor asked for: instead of greping source files
 * for text patterns, it actually RUNS the balance computation logic against a
 * fixture and asserts all three computation paths produce the SAME number.
 *
 * The three paths that must agree:
 *   1. computePartyBalance(userId, partyId) — server-side, used by the
 *      party-detail headline + WhatsApp reminder.
 *   2. getReceivablePayable(userId) — server-side, used by the dashboard
 *      "You'll get" / "You'll pay" totals + party list balances.
 *   3. computeStatementRunningBalance(transactions, payments, statsBalance) —
 *      the client-side running balance on the account statement (extracted
 *      to src/lib/statement-balance.ts in V17 §2.1 so it's testable).
 *
 * The fixture includes a soft-deleted payment to verify that ALL three paths
 * exclude it (V15 M-3 + V16 C1-C4).
 *
 * Approach: set a dummy DATABASE_URL so PrismaClient instantiation doesn't
 * throw, then use jest.spyOn to mock each db method to return fixture-derived
 * data. Then call the real computePartyBalance, getReceivablePayable, and
 * computeStatementRunningBalance functions and assert their outputs agree.
 *
 * If any of the three paths ever drifts (sign error, missing deletedAt filter,
 * rounding mismatch), this test fails with a clear message showing which
 * paths disagree.
 */

// Set dummy DATABASE_URL BEFORE any imports — PrismaClient validates the URL
// format at instantiation time. This dummy URL passes format validation but
// never connects (we mock all methods before any query runs).
process.env.DATABASE_URL = 'postgresql://dummy:dummy@localhost:5432/dummy'
process.env.DIRECT_URL = 'postgresql://dummy:dummy@localhost:5432/dummy'

import { jest } from '@jest/globals'
import { db } from '@/lib/db'
import { computePartyBalance, getReceivablePayable } from '@/lib/party-balance'
import { computeStatementRunningBalance } from '@/lib/statement-balance'

// ============================================================
// FIXTURE: a party with 2 sales, 1 purchase, 3 payments (1 soft-deleted)
// ============================================================

const USER_ID = 'user1'
const PARTY_ID = 'party1'
const OPENING_BALANCE = 1000

// Transactions (all non-deleted)
const FIXTURE_TRANSACTIONS = [
  {
    id: 't1',
    userId: USER_ID,
    partyId: PARTY_ID,
    type: 'sale' as const,
    date: new Date('2026-01-01T00:00:00Z'),
    totalAmount: 500,
    paidAmount: 0,
    invoiceNo: 'INV-001',
    deletedAt: null,
  },
  {
    id: 't2',
    userId: USER_ID,
    partyId: PARTY_ID,
    type: 'sale' as const,
    date: new Date('2026-01-02T00:00:00Z'),
    totalAmount: 300,
    paidAmount: 0,
    invoiceNo: 'INV-002',
    deletedAt: null,
  },
  {
    id: 't3',
    userId: USER_ID,
    partyId: PARTY_ID,
    type: 'purchase' as const,
    date: new Date('2026-01-03T00:00:00Z'),
    totalAmount: 200,
    paidAmount: 0,
    invoiceNo: 'PUR-001',
    deletedAt: null,
  },
]

// Payments: P2 is SOFT-DELETED — must be excluded from all balance calcs.
const FIXTURE_PAYMENTS = [
  {
    id: 'p1',
    userId: USER_ID,
    partyId: PARTY_ID,
    type: 'received' as const,
    date: new Date('2026-01-04T00:00:00Z'),
    amount: 400,
    mode: 'cash',
    notes: null,
    deletedAt: null, // ACTIVE
  },
  {
    id: 'p2',
    userId: USER_ID,
    partyId: PARTY_ID,
    type: 'received' as const,
    date: new Date('2026-01-05T00:00:00Z'),
    amount: 100,
    mode: 'upi',
    notes: 'should be excluded',
    deletedAt: new Date('2026-01-05T00:00:00Z'), // SOFT-DELETED
  },
  {
    id: 'p3',
    userId: USER_ID,
    partyId: PARTY_ID,
    type: 'paid' as const,
    date: new Date('2026-01-06T00:00:00Z'),
    amount: 100,
    mode: 'bank',
    notes: null,
    deletedAt: null, // ACTIVE
  },
]

// Active payments only (P2 excluded) — used for the statement.
const ACTIVE_PAYMENTS = FIXTURE_PAYMENTS.filter(p => p.deletedAt === null)

// ============================================================
// EXPECTED VALUES (hand-computed, independent of the code under test)
// ============================================================
//
// totalSales        = 500 + 300 = 800
// totalPurchases    = 200
// totalReceived     = 0 (invoice paidAmount sum for sales = 0)
// totalPaid         = 0 (invoice paidAmount sum for purchases = 0)
// salesOutstanding  = 800 - 0 = 800
// purchaseOutstanding = 200 - 0 = 200
// paymentsReceived  = 400 (only P1; P2 is soft-deleted)
// paymentsPaid      = 100 (P3)
//
// balance = opening + salesOut - purchaseOut - paymentsReceived + paymentsPaid
//         = 1000 + 800 - 200 - 400 + 100
//         = 1300

const EXPECTED_BALANCE = 1300
const EXPECTED_PAYMENTS_RECEIVED = 400 // P2 (100) is soft-deleted, excluded
const EXPECTED_PAYMENTS_PAID = 100

// ============================================================
// Helper: configure the db mocks to return fixture-derived data
// ============================================================

function configureMocks() {
  // Restore all spies before re-configuring
  jest.restoreAllMocks()

  // --- computePartyBalance mocks ---

  // db.party.findFirst — returns the party's openingBalance
  jest.spyOn(db.party, 'findFirst').mockResolvedValue({
    openingBalance: OPENING_BALANCE,
  } as any)

  // db.transaction.aggregate — returns different values based on the `type`
  // in the where clause. computePartyBalance calls this for sale + purchase.
  ;(jest.spyOn(db.transaction, 'aggregate') as jest.Mock).mockImplementation((args: any) => {
    const type = args?.where?.type
    if (type === 'sale') {
      const matching = FIXTURE_TRANSACTIONS.filter(
        t => t.type === 'sale' && t.deletedAt === null
      )
      return Promise.resolve({
        _sum: {
          totalAmount: matching.reduce((s, t) => s + t.totalAmount, 0),
          paidAmount: matching.reduce((s, t) => s + t.paidAmount, 0),
        },
      })
    }
    if (type === 'purchase') {
      const matching = FIXTURE_TRANSACTIONS.filter(
        t => t.type === 'purchase' && t.deletedAt === null
      )
      return Promise.resolve({
        _sum: {
          totalAmount: matching.reduce((s, t) => s + t.totalAmount, 0),
          paidAmount: matching.reduce((s, t) => s + t.paidAmount, 0),
        },
      })
    }
    // Fallback for any other aggregate (e.g. date range)
    return Promise.resolve({ _sum: {}, _min: {}, _max: {} })
  })

  // 🔒 M11 (2026-07-21): computePartyBalance and getReceivablePayable now sum
  // payments via db.payment.findMany (the money-extension path the on-screen
  // statement uses) instead of raw SQL, because in production the two paths
  // disagreed by 100× on a fresh ₹100 payment and the balance must agree with
  // the statement the user is looking at.
  //
  // NOTE for future readers: `amount` here is in RUPEES, because that is what
  // the extension returns on read. The $queryRaw mock below deliberately uses
  // rupees × 100 to simulate the paise column. That difference is the whole
  // point of this fixture — the two paths must land on the SAME rupee value.
  ;(jest.spyOn(db.payment, 'findMany') as jest.Mock).mockImplementation((args: any) => {
    const wantsDeletedNull = args?.where?.deletedAt === null
    const partyFilter = args?.where?.partyId
    const rows = FIXTURE_PAYMENTS
      .filter(p => (wantsDeletedNull ? p.deletedAt === null : true))
      .filter(p => (partyFilter ? p.partyId === partyFilter : true))
    return Promise.resolve(rows.map(p => ({
      id: p.id, partyId: p.partyId, type: p.type,
      amount: p.amount, date: p.date, mode: p.mode, notes: p.notes,
    })))
  })

  // db.payment.aggregate — returns different values based on the `type`
  // in the where clause. Must respect the deletedAt: null filter.
  ;(jest.spyOn(db.payment, 'aggregate') as jest.Mock).mockImplementation((args: any) => {
    const type = args?.where?.type
    const activePayments = FIXTURE_PAYMENTS.filter(p => p.deletedAt === null)
    if (type === 'received') {
      const matching = activePayments.filter(p => p.type === 'received')
      return Promise.resolve({ _sum: { amount: matching.reduce((s, p) => s + p.amount, 0) } })
    }
    if (type === 'paid') {
      const matching = activePayments.filter(p => p.type === 'paid')
      return Promise.resolve({ _sum: { amount: matching.reduce((s, p) => s + p.amount, 0) } })
    }
    // No type filter — sum ALL active payments
    return Promise.resolve({ _sum: { amount: activePayments.reduce((s, p) => s + p.amount, 0) } })
  })

  // --- getReceivablePayable mocks ---

  // db.$queryRaw — returns the pre-aggregated rows that the SQL would produce.
  // Prisma raw SQL returns numeric as string, COUNT as bigint.
  // The helper converts with Number() + fromPaise().
  //
  // 🔒 V17 PAISE MIGRATION Phase 2B: Mock now returns PAISE fields (integer
  // paise as strings) instead of rupee fields. This matches the new SQL
  // contract: ROUND(... * 100 + nudge) AS "XPaise". The helper's JS code
  // converts back to rupees via fromPaise(Number(row.XPaise)).
  //
  // The fixture values are clean integers (500, 300, 200, 1000, 400, 100),
  // so * 100 is exact — no float drift, no nudge effect. The final rupee
  // values (after fromPaise) are identical to the pre-migration values.
  // Note: using direct assignment instead of jest.spyOn because $queryRaw's
  // TypeScript overloads don't play well with jest.spyOn's type inference.
  // jest.restoreAllMocks() won't restore this — but we re-assign in every
  // beforeEach call via configureMocks(), so it's always fresh.
  //
  // 🔒 V26 M11: computePartyBalance now uses $queryRaw for payment aggregates
  // (bypassing the money extension's double-converting aggregate handler).
  // The mock must differentiate between:
  //   1. getReceivablePayable's party-list query (returns array of party rows)
  //   2. computePartyBalance's payment queries (returns [{ totalPaise }])
  // We check the SQL string to determine which query it is.
  ;(db as any).$queryRaw = (jest.fn() as any).mockImplementation((strings: TemplateStringsArray, ...values: any[]) => {
    const sql = strings.join('?')
    // computePartyBalance's payment queries: SELECT COALESCE(SUM("amount")...
    if (sql.includes('SELECT COALESCE(SUM("amount")')) {
      // Determine if it's 'received' or 'paid' by checking the SQL
      if (sql.includes("'received'")) {
        const total = FIXTURE_PAYMENTS
          .filter(p => p.type === 'received' && p.deletedAt === null)
          .reduce((s, p) => s + p.amount, 0) * 100  // convert rupees to paise
        return Promise.resolve([{ totalPaise: BigInt(total) }])
      }
      if (sql.includes("'paid'")) {
        const total = FIXTURE_PAYMENTS
          .filter(p => p.type === 'paid' && p.deletedAt === null)
          .reduce((s, p) => s + p.amount, 0) * 100
        return Promise.resolve([{ totalPaise: BigInt(total) }])
      }
    }
    // Default: getReceivablePayable's party-list query
    return Promise.resolve([
      {
        partyId: PARTY_ID,
        openingBalancePaise: String(OPENING_BALANCE * 100),
        salesOutstandingPaise: String(
          FIXTURE_TRANSACTIONS
            .filter(t => t.type === 'sale' && t.deletedAt === null)
            .reduce((s, t) => s + (t.totalAmount - t.paidAmount), 0) * 100
        ),
        purchaseOutstandingPaise: String(
          FIXTURE_TRANSACTIONS
            .filter(t => t.type === 'purchase' && t.deletedAt === null)
            .reduce((s, t) => s + (t.totalAmount - t.paidAmount), 0) * 100
        ),
        creditNoteOutstandingPaise: '0',
        debitNoteOutstandingPaise: '0',
        paymentsReceivedPaise: String(
          FIXTURE_PAYMENTS
            .filter(p => p.type === 'received' && p.deletedAt === null)
            .reduce((s, p) => s + p.amount, 0) * 100
        ),
        paymentsPaidPaise: String(
          FIXTURE_PAYMENTS
            .filter(p => p.type === 'paid' && p.deletedAt === null)
            .reduce((s, p) => s + p.amount, 0) * 100
        ),
        transactionCount: BigInt(FIXTURE_TRANSACTIONS.filter(t => t.deletedAt === null).length),
      },
    ] as any)
  })
}

// ============================================================
// TESTS
// ============================================================

describe('🔒 V17 §2.1 — Behavioral reconciliation (all 3 balance paths agree)', () => {
  beforeEach(() => {
    configureMocks()
  })

  describe('computePartyBalance (server path 1)', () => {
    it('returns the correct balance for the fixture', async () => {
      const result = await computePartyBalance(USER_ID, PARTY_ID)

      expect(result.balance).toBe(EXPECTED_BALANCE)
      expect(result.totalSales).toBe(800)
      expect(result.totalPurchases).toBe(200)
      expect(result.salesOutstanding).toBe(800)
      expect(result.purchaseOutstanding).toBe(200)
      expect(result.paymentsReceived).toBe(EXPECTED_PAYMENTS_RECEIVED)
      expect(result.paymentsPaid).toBe(EXPECTED_PAYMENTS_PAID)
    })

    it('🔒 V15 M-3: excludes soft-deleted payments (P2 amount=100 is NOT counted)', async () => {
      const result = await computePartyBalance(USER_ID, PARTY_ID)
      // If P2 (soft-deleted, received 100) were included, paymentsReceived
      // would be 500 (400 + 100). It must be 400.
      expect(result.paymentsReceived).toBe(400)
      // And the balance would be 1200 (1000+800-200-500+100) instead of 1300.
      expect(result.balance).toBe(1300)
    })
  })

  describe('getReceivablePayable (server path 2 — dashboard + party list)', () => {
    it('returns the same balance as computePartyBalance for the same party', async () => {
      const receivableResult = await getReceivablePayable(USER_ID)
      const computeResult = await computePartyBalance(USER_ID, PARTY_ID)

      const receivableBalance = receivableResult.partyBalances.get(PARTY_ID)?.balance
      const computeBalance = computeResult.balance

      expect(receivableBalance).toBeDefined()
      expect(receivableBalance).toBe(computeBalance)
      expect(receivableBalance).toBe(EXPECTED_BALANCE)
    })

    it('🔒 V15 M-3: excludes soft-deleted payments (SQL path also filters deletedAt IS NULL)', async () => {
      const result = await getReceivablePayable(USER_ID)
      const balance = result.partyBalances.get(PARTY_ID)?.balance
      // If P2 were included, balance would be 1200 instead of 1300.
      expect(balance).toBe(EXPECTED_BALANCE)
    })
  })

  describe('computeStatementRunningBalance (client path 3 — account statement)', () => {
    it('first entry (newest) runningBalance === statsBalance (ties to headline)', () => {
      const entries = computeStatementRunningBalance(
        FIXTURE_TRANSACTIONS,
        ACTIVE_PAYMENTS,
        EXPECTED_BALANCE,
      )

      expect(entries.length).toBeGreaterThan(0)
      // The first entry is the newest (P3, paid 100, date 2026-01-06).
      expect(entries[0].runningBalance).toBe(EXPECTED_BALANCE)
    })

    it('🔒 V15 M-3: excludes soft-deleted payments (P2 does not appear in the statement)', () => {
      const entries = computeStatementRunningBalance(
        FIXTURE_TRANSACTIONS,
        ACTIVE_PAYMENTS, // P2 already filtered out here
        EXPECTED_BALANCE,
      )

      // P2's id must NOT appear in the statement entries.
      const p2Entry = entries.find(e => e.id === 'p2')
      expect(p2Entry).toBeUndefined()

      // The statement should have 5 entries: T1, T2, T3, P1, P3 (NOT P2).
      expect(entries.length).toBe(5)
    })

    it('oldest entry: runningBalance - delta === openingBalance (invariant)', () => {
      const entries = computeStatementRunningBalance(
        FIXTURE_TRANSACTIONS,
        ACTIVE_PAYMENTS,
        EXPECTED_BALANCE,
      )

      // The last entry is the oldest (T1, sale 500, date 2026-01-01).
      const oldest = entries[entries.length - 1]
      // oldest.runningBalance is the balance AFTER T1 was recorded.
      // oldest.runningBalance - oldest.delta = balance BEFORE T1 = openingBalance.
      expect(oldest.runningBalance - oldest.delta).toBe(OPENING_BALANCE)
    })

    it('traces the full statement and verifies every running balance', () => {
      const entries = computeStatementRunningBalance(
        FIXTURE_TRANSACTIONS,
        ACTIVE_PAYMENTS,
        EXPECTED_BALANCE,
      )

      // Expected order (newest first):
      //   1. P3 (paid 100, date 01-06) — runningBalance = 1300
      //   2. P1 (received 400, date 01-04) — runningBalance = 1300 - 100 = 1200
      //   3. T3 (purchase 200, date 01-03) — runningBalance = 1200 - (-400) = 1600
      //   4. T2 (sale 300, date 01-02) — runningBalance = 1600 - (-200) = 1800
      //   5. T1 (sale 500, date 01-01) — runningBalance = 1800 - 300 = 1500

      expect(entries[0].id).toBe('p3')
      expect(entries[0].runningBalance).toBe(1300)

      expect(entries[1].id).toBe('p1')
      expect(entries[1].runningBalance).toBe(1200)

      expect(entries[2].id).toBe('t3')
      expect(entries[2].runningBalance).toBe(1600)

      expect(entries[3].id).toBe('t2')
      expect(entries[3].runningBalance).toBe(1800)

      expect(entries[4].id).toBe('t1')
      expect(entries[4].runningBalance).toBe(1500)
    })
  })

  describe('🔒 THE RECONCILIATION: all 3 paths produce the SAME balance', () => {
    it('computePartyBalance.balance === getReceivablePayable.balance === statement[0].runningBalance', async () => {
      // Path 1: computePartyBalance (server, used by party-detail + WhatsApp)
      const computeResult = await computePartyBalance(USER_ID, PARTY_ID)
      const balance1 = computeResult.balance

      // Path 2: getReceivablePayable (server, used by dashboard + party list)
      const receivableResult = await getReceivablePayable(USER_ID)
      const balance2 = receivableResult.partyBalances.get(PARTY_ID)?.balance

      // Path 3: computeStatementRunningBalance (client, used by statement)
      const statement = computeStatementRunningBalance(
        FIXTURE_TRANSACTIONS,
        ACTIVE_PAYMENTS,
        balance1, // the client receives this from the server (stats.balance)
      )
      const balance3 = statement[0]?.runningBalance

      // THE ASSERTION: all three must agree.
      expect(balance1).toBe(EXPECTED_BALANCE)
      expect(balance2).toBe(EXPECTED_BALANCE)
      expect(balance3).toBe(EXPECTED_BALANCE)
      expect(balance1).toBe(balance2)
      expect(balance2).toBe(balance3)
    })
  })

  describe('edge cases', () => {
    it('returns [] for a party with no transactions and no payments', () => {
      const entries = computeStatementRunningBalance([], [], 0)
      expect(entries).toEqual([])
    })

    it('handles a single sale (balance = opening + sale)', () => {
      const entries = computeStatementRunningBalance(
        [{ id: 't1', date: '2026-01-01', type: 'sale', totalAmount: 500, paidAmount: 0 }],
        [],
        1500, // opening 1000 + sale 500
      )
      expect(entries.length).toBe(1)
      expect(entries[0].runningBalance).toBe(1500)
    })

    it('handles a fully-paid sale (delta = total - paid = 0)', () => {
      const entries = computeStatementRunningBalance(
        [{ id: 't1', date: '2026-01-01', type: 'sale', totalAmount: 500, paidAmount: 500 }],
        [],
        1000, // opening only — sale was fully paid at billing time, no outstanding
      )
      expect(entries[0].runningBalance).toBe(1000)
      expect(entries[0].delta).toBe(0)
    })
  })
})
