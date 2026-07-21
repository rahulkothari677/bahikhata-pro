/**
 * 🔒 V17-Ext §5.1 — Reconciliation health check tests.
 *
 * Tests the three reconciliation checks using jest.spyOn on the real db
 * object (same approach as the behavioral balance reconciliation test).
 *
 * The checks verify that:
 *   1. Party balances tie out (SQL aggregate vs JS sum)
 *   2. GST ties out (per-item vs header)
 *   3. No orphaned data (items attached to deleted transactions, etc.)
 *
 * Each test seeds fixture data via the mocks, runs the check, and verifies
 * the { name, passed, details } result.
 */

process.env.DATABASE_URL = 'postgresql://dummy:dummy@localhost:5432/dummy'
process.env.DIRECT_URL = 'postgresql://dummy:dummy@localhost:5432/dummy'

import { jest } from '@jest/globals'
import { db } from '@/lib/db'
import { runReconciliationChecks } from '@/lib/reconciliation'

const USER_ID = 'user1'

// Helper: set up the common mocks for all 3 checks.
// Individual tests can override specific mocks as needed.
function setupCommonMocks(overrides: {
  queryRawResult?: any[]
  itemGst?: { cgst: number; sgst: number; igst: number }
  headerGst?: { cgst: number; sgst: number; igst: number }
  orphanedItems?: number
  orphanedPayments?: number
} = {}) {
  jest.restoreAllMocks()

  const dbAny = db as any

  // $queryRaw is used by BOTH getReceivablePayable (checkPartyBalances) AND
  // the orphaned-data check (checkOrphanedData). We use mockImplementation
  // to return different results based on the SQL query content.
  //
  // 🔒 BUG-007 FIX (V17 Phase 2C): The old routing used `includes('Payment')`
  // to identify the orphaned-payments query. However, getReceivablePayable's
  // SQL ALSO contains `"Payment"` in its subquery (LEFT JOIN ... FROM "Payment"
  // ...). This caused getReceivablePayable to be misrouted to the orphaned-
  // payments branch, receiving `[{ count: 0 }]` instead of the fixture party-
  // balance rows. The test then passed trivially (0 === 0) without ever
  // testing the actual fixture data.
  //
  // Fix: use patterns UNIQUE to each query:
  //   - Orphaned-items: `includes('TransactionItem')` — no other query refs TransactionItem
  //   - Orphaned-payments: `includes('pty.id IS NULL')` — only orphaned-payments checks pty.id IS NULL
  //   - getReceivablePayable: default (falls through to overrides.queryRawResult)
  const queryRawMock: any = jest.fn()
  queryRawMock.mockImplementation((sql: any) => {
    const sqlStr = Array.isArray(sql?.strings) ? sql.strings.join('') : String(sql)
    // Orphaned-items query: references TransactionItem table
    if (sqlStr.includes('TransactionItem')) {
      return Promise.resolve([{ count: BigInt(overrides.orphanedItems ?? 0) }])
    }
    // Orphaned-payments query: checks pty.id IS NULL (Party hard-deleted)
    if (sqlStr.includes('pty.id IS NULL')) {
      return Promise.resolve([{ count: BigInt(overrides.orphanedPayments ?? 0) }])
    }
    // Default: return the party balances result (getReceivablePayable SQL)
    return Promise.resolve(overrides.queryRawResult ?? [])
  })
  dbAny.$queryRaw = queryRawMock

  // 🔒 M11 (2026-07-21): getReceivablePayable now sums payments via
  // db.payment.findMany (the money-extension path the party screen and the
  // statement use) rather than the raw-SQL subquery, because in production the
  // two disagreed by 100× on a fresh ₹100 payment. These reconciliation
  // fixtures drive balances through queryRawResult and have no payment rows,
  // so an empty payment list preserves their existing expectations.
  jest.spyOn(dbAny.payment, 'findMany').mockResolvedValue([])

  // transactionItem.aggregate — used by checkGstReconciliation (per-item GST)
  jest.spyOn(dbAny.transactionItem, 'aggregate').mockResolvedValue({
    _sum: {
      cgst: overrides.itemGst?.cgst ?? 0,
      sgst: overrides.itemGst?.sgst ?? 0,
      igst: overrides.itemGst?.igst ?? 0,
    },
  })

  // transaction.aggregate — used by checkGstReconciliation (header GST)
  jest.spyOn(dbAny.transaction, 'aggregate').mockResolvedValue({
    _sum: {
      cgst: overrides.headerGst?.cgst ?? 0,
      sgst: overrides.headerGst?.sgst ?? 0,
      igst: overrides.headerGst?.igst ?? 0,
    },
  })
}

describe('🔒 V17-Ext §5.1 — Reconciliation health check', () => {
  afterEach(() => {
    jest.restoreAllMocks()
  })

  describe('checkPartyBalances (Check 1)', () => {
    it('passes when SQL totals match JS sum of per-party balances', async () => {
      // 🔒 V17 PAISE MIGRATION Phase 2B: Mock returns PAISE fields (integer
      // paise as strings) to match the new SQL contract. Values are
      // original_rupees * 100. Missing creditNote/debitNote fields default
      // to 0 via fromPaise(toMoney(undefined)) = 0.
      setupCommonMocks({
        queryRawResult: [
          {
            partyId: 'p1',
            openingBalancePaise: '100000',
            salesOutstandingPaise: '50000',
            purchaseOutstandingPaise: '0',
            paymentsReceivedPaise: '20000',
            paymentsPaidPaise: '0',
            transactionCount: BigInt(1),
          },
          {
            partyId: 'p2',
            openingBalancePaise: '0',
            salesOutstandingPaise: '0',
            purchaseOutstandingPaise: '30000',
            paymentsReceivedPaise: '0',
            paymentsPaidPaise: '0',
            transactionCount: BigInt(1),
          },
        ],
      })

      const result = await runReconciliationChecks(USER_ID)
      const partyCheck = result.checks.find(c => c.name === 'Party Balances')

      expect(partyCheck).toBeDefined()
      // p1 balance = 1000 + 500 - 0 - 200 + 0 = 1300 (receivable)
      // p2 balance = 0 + 0 - 300 - 0 + 0 = -300 (payable)
      // totalReceivable should = 1300, totalPayable should = 300
      // JS sum of positive = 1300, JS sum of negative = 300
      // They match → passed
      expect(partyCheck!.passed).toBe(true)
    })

    it('passes with float values that could cause drift (roundMoney handles it)', async () => {
      // 🔒 V17 PAISE MIGRATION Phase 2B: Mock returns paise. The float drift
      // (0.1 + 0.2 = 0.30000000000000004) still occurs in the JS balance
      // computation (roundMoney in party-balance.ts:307), independent of
      // whether the SQL returns rupees or paise. The test verifies that
      // roundMoney fixes the drift in BOTH the SQL total and the JS sum.
      setupCommonMocks({
        queryRawResult: [
          {
            partyId: 'p1',
            openingBalancePaise: '10',
            salesOutstandingPaise: '20',
            purchaseOutstandingPaise: '0',
            paymentsReceivedPaise: '0',
            paymentsPaidPaise: '0',
            transactionCount: BigInt(1),
          },
          {
            partyId: 'p2',
            openingBalancePaise: '20',
            salesOutstandingPaise: '10',
            purchaseOutstandingPaise: '0',
            paymentsReceivedPaise: '0',
            paymentsPaidPaise: '0',
            transactionCount: BigInt(1),
          },
        ],
      })

      const result = await runReconciliationChecks(USER_ID)
      const partyCheck = result.checks.find(c => c.name === 'Party Balances')

      expect(partyCheck).toBeDefined()
      // 0.1+0.2 = 0.30000000000000004 in float, but roundMoney fixes it.
      // Both paths use roundMoney, so they should still agree.
      expect(partyCheck!.passed).toBe(true)
    })

    it('passes with no parties (empty result)', async () => {
      setupCommonMocks({ queryRawResult: [] })

      const result = await runReconciliationChecks(USER_ID)
      const partyCheck = result.checks.find(c => c.name === 'Party Balances')

      expect(partyCheck).toBeDefined()
      expect(partyCheck!.passed).toBe(true) // 0 == 0
    })
  })

  describe('checkGstReconciliation (Check 2)', () => {
    it('passes when per-item GST matches header GST', async () => {
      setupCommonMocks({
        itemGst: { cgst: 100, sgst: 100, igst: 0 },
        headerGst: { cgst: 100, sgst: 100, igst: 0 },
      })

      const result = await runReconciliationChecks(USER_ID)
      const gstCheck = result.checks.find(c => c.name === 'GST Reconciliation')

      expect(gstCheck).toBeDefined()
      expect(gstCheck!.passed).toBe(true)
    })

    it('fails when per-item CGST does not match header CGST', async () => {
      setupCommonMocks({
        itemGst: { cgst: 100, sgst: 100, igst: 0 },
        headerGst: { cgst: 150, sgst: 100, igst: 0 }, // Header CGST = 150, items = 100
      })

      const result = await runReconciliationChecks(USER_ID)
      const gstCheck = result.checks.find(c => c.name === 'GST Reconciliation')

      expect(gstCheck).toBeDefined()
      expect(gstCheck!.passed).toBe(false)
      expect(gstCheck!.details).toMatch(/Mismatch/)
    })

    it('passes when both are zero (no transactions yet)', async () => {
      setupCommonMocks({
        itemGst: { cgst: 0, sgst: 0, igst: 0 },
        headerGst: { cgst: 0, sgst: 0, igst: 0 },
      })

      const result = await runReconciliationChecks(USER_ID)
      const gstCheck = result.checks.find(c => c.name === 'GST Reconciliation')

      expect(gstCheck).toBeDefined()
      expect(gstCheck!.passed).toBe(true)
    })
  })

  describe('checkOrphanedData (Check 3)', () => {
    it('passes when no truly orphaned items or payments', async () => {
      setupCommonMocks({
        orphanedItems: 0,
        orphanedPayments: 0,
      })

      const result = await runReconciliationChecks(USER_ID)
      const orphanCheck = result.checks.find(c => c.name === 'Data Integrity')

      expect(orphanCheck).toBeDefined()
      expect(orphanCheck!.passed).toBe(true)
    })

    it('fails when truly orphaned items exist (parent transaction hard-deleted)', async () => {
      setupCommonMocks({
        orphanedItems: 3,
        orphanedPayments: 0,
      })

      const result = await runReconciliationChecks(USER_ID)
      const orphanCheck = result.checks.find(c => c.name === 'Data Integrity')

      expect(orphanCheck).toBeDefined()
      expect(orphanCheck!.passed).toBe(false)
      expect(orphanCheck!.details).toMatch(/3 item/)
    })

    it('fails when truly orphaned payments exist (parent party hard-deleted)', async () => {
      setupCommonMocks({
        orphanedItems: 0,
        orphanedPayments: 2,
      })

      const result = await runReconciliationChecks(USER_ID)
      const orphanCheck = result.checks.find(c => c.name === 'Data Integrity')

      expect(orphanCheck).toBeDefined()
      expect(orphanCheck!.passed).toBe(false)
      expect(orphanCheck!.details).toMatch(/2 payment/)
    })
  })

  describe('runReconciliationChecks (combined)', () => {
    it('returns allPassed=true when all 3 checks pass', async () => {
      setupCommonMocks({
        queryRawResult: [],
        itemGst: { cgst: 50, sgst: 50, igst: 0 },
        headerGst: { cgst: 50, sgst: 50, igst: 0 },
        orphanedItems: 0,
        orphanedPayments: 0,
      })

      const result = await runReconciliationChecks(USER_ID)

      expect(result.allPassed).toBe(true)
      expect(result.checks).toHaveLength(3)
      expect(result.runAt).toBeDefined()
    })

    it('returns allPassed=false when GST check fails', async () => {
      setupCommonMocks({
        queryRawResult: [],
        itemGst: { cgst: 50, sgst: 50, igst: 0 },
        headerGst: { cgst: 60, sgst: 50, igst: 0 }, // mismatch
        orphanedItems: 0,
        orphanedPayments: 0,
      })

      const result = await runReconciliationChecks(USER_ID)

      expect(result.allPassed).toBe(false)
      const failedChecks = result.checks.filter(c => !c.passed)
      expect(failedChecks.length).toBeGreaterThanOrEqual(1)
    })

    it('returns allPassed=false when orphan check fails', async () => {
      setupCommonMocks({
        queryRawResult: [],
        itemGst: { cgst: 0, sgst: 0, igst: 0 },
        headerGst: { cgst: 0, sgst: 0, igst: 0 },
        orphanedItems: 5,
        orphanedPayments: 0,
      })

      const result = await runReconciliationChecks(USER_ID)

      expect(result.allPassed).toBe(false)
      const orphanCheck = result.checks.find(c => c.name === 'Data Integrity')
      expect(orphanCheck!.passed).toBe(false)
    })

    it('returns all 3 checks with correct names', async () => {
      setupCommonMocks()

      const result = await runReconciliationChecks(USER_ID)

      expect(result.checks.map(c => c.name)).toEqual([
        'Party Balances',
        'GST Reconciliation',
        'Data Integrity',
      ])
    })
  })
})
