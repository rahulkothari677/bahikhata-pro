/**
 * 🔒 Critical #3 behavioral test — checkPaiseAnomalies (paise sanity check).
 *
 * Verifies the nightly reconciliation's paise-corruption detection:
 *   - Flags rows with Payment.amount > 1,000,000,000 paise (₹1Cr = "almost certain")
 *   - Flags but PASSES rows with Payment.amount > 100,000,000 paise (₹10L = "suspicious")
 *   - PASSES when all rows are within plausible bounds
 *
 * The root cause this guards against (per EkBook-CRITICAL-Payment-100x-RootCause.md):
 * a non-idempotent migration that, when auto-replayed by migrate-with-retry.sh,
 * multiplied money columns by 100 a second time. The migrate-with-retry guard
 * + migration-idempotency-guard.test.ts prevent NEW occurrences, but rows
 * written BEFORE the fix can still be corrupt. This nightly check is the
 * early-warning system.
 */

process.env.DATABASE_URL = 'postgresql://dummy:dummy@localhost:5432/dummy'
process.env.DIRECT_URL = 'postgresql://dummy:dummy@localhost:5432/dummy'

import { jest } from '@jest/globals'
import { db } from '@/lib/db'
import { checkPaiseAnomalies } from '@/lib/reconciliation'

// Helper: build a mock $queryRawUnsafe result row.
function row(max: number | null, susp: number, certain: number) {
  return [{ max: max !== null ? BigInt(max) : null, susp: BigInt(susp), certain: BigInt(certain) }]
}

describe('checkPaiseAnomalies [Critical #3]', () => {
  let spy: ReturnType<typeof jest.spyOn>

  beforeEach(() => {
    jest.restoreAllMocks()
    // Default: all tables healthy (max < suspicious threshold).
    spy = jest.spyOn(db, '$queryRawUnsafe') as unknown as ReturnType<typeof jest.spyOn>
    spy.mockResolvedValue(row(100_000, 0, 0)) // ₹1,000 max — healthy
  })

  test('PASSES when all money columns are within plausible bounds', async () => {
    const result = await checkPaiseAnomalies('user1')
    expect(result.passed).toBe(true)
    expect(result.name).toBe('Paise Sanity')
    expect(result.actual).toBe(0)
  })

  test('FAILS when Payment.amount exceeds ₹1Cr paise (almost-certain corruption)', async () => {
    // 1,500,000,000 paise = ₹1.5Cr — a single payment this large is almost
    // certainly a 100× artifact (₹1.5L payment stored as ₹1.5Cr after a
    // double-conversion).
    spy
      .mockResolvedValueOnce(row(1_500_000_000, 1, 1)) // Payment
      .mockResolvedValueOnce(row(100_000, 0, 0))       // Transaction
      .mockResolvedValueOnce(row(100_000, 0, 0))       // Party
      .mockResolvedValueOnce(row(100_000, 0, 0))       // Product
      .mockResolvedValueOnce(row(100_000, 0, 0))       // TransactionItem

    const result = await checkPaiseAnomalies('user1')
    expect(result.passed).toBe(false)
    expect(result.actual).toBe(1)
    expect(result.details).toMatch(/almost certainly 100×-corrupted/)
    expect(result.details).toMatch(/Payment: 1/)
  })

  test('FAILS when Product.salePrice exceeds ₹1Cr paise', async () => {
    spy
      .mockResolvedValueOnce(row(100_000, 0, 0))       // Payment
      .mockResolvedValueOnce(row(100_000, 0, 0))       // Transaction
      .mockResolvedValueOnce(row(100_000, 0, 0))       // Party
      .mockResolvedValueOnce(row(2_500_000_000, 1, 1)) // Product (₹2.5Cr — clearly corrupt)
      .mockResolvedValueOnce(row(100_000, 0, 0))       // TransactionItem

    const result = await checkPaiseAnomalies('user1')
    expect(result.passed).toBe(false)
    expect(result.actual).toBe(1)
    expect(result.details).toMatch(/Product: 1/)
  })

  test('FAILS when Transaction.totalAmount exceeds ₹1Cr paise', async () => {
    spy
      .mockResolvedValueOnce(row(100_000, 0, 0))         // Payment
      .mockResolvedValueOnce(row(1_100_000_000, 1, 1))   // Transaction
      .mockResolvedValueOnce(row(100_000, 0, 0))         // Party
      .mockResolvedValueOnce(row(100_000, 0, 0))         // Product
      .mockResolvedValueOnce(row(100_000, 0, 0))         // TransactionItem

    const result = await checkPaiseAnomalies('user1')
    expect(result.passed).toBe(false)
    expect(result.actual).toBe(1)
    expect(result.details).toMatch(/Transaction: 1/)
  })

  test('PASSES (with warning) when rows are in the ₹10L-₹1Cr suspicious band', async () => {
    // 500,000,000 paise = ₹5L — plausible for a B2B sale but worth flagging.
    // Should NOT fail (a single legitimate ₹5L sale is normal for some shops).
    spy
      .mockResolvedValueOnce(row(500_000_000, 1, 0)) // Payment: 1 suspicious, 0 almost-certain
      .mockResolvedValueOnce(row(100_000, 0, 0))
      .mockResolvedValueOnce(row(100_000, 0, 0))
      .mockResolvedValueOnce(row(100_000, 0, 0))
      .mockResolvedValueOnce(row(100_000, 0, 0))

    const result = await checkPaiseAnomalies('user1')
    expect(result.passed).toBe(true)
    expect(result.actual).toBe(0)
    // But the details should mention the suspicious row for manual review.
    expect(result.details).toMatch(/1 row\(s\) above the suspicious threshold/)
  })

  test('aggregates counts across all 5 tables', async () => {
    spy
      .mockResolvedValueOnce(row(1_500_000_000, 1, 1)) // Payment: 1 corrupt
      .mockResolvedValueOnce(row(1_200_000_000, 1, 1)) // Transaction: 1 corrupt
      .mockResolvedValueOnce(row(100_000, 0, 0))
      .mockResolvedValueOnce(row(1_800_000_000, 1, 1)) // Product: 1 corrupt
      .mockResolvedValueOnce(row(100_000, 0, 0))

    const result = await checkPaiseAnomalies('user1')
    expect(result.passed).toBe(false)
    expect(result.actual).toBe(3)
    expect(result.details).toMatch(/Payment: 1, Transaction: 1, Party: 0, Product: 1, Item: 0/)
  })

  test('names the recovery endpoints in the failure details', async () => {
    spy
      .mockResolvedValueOnce(row(1_500_000_000, 1, 1))
      .mockResolvedValueOnce(row(100_000, 0, 0))
      .mockResolvedValueOnce(row(100_000, 0, 0))
      .mockResolvedValueOnce(row(100_000, 0, 0))
      .mockResolvedValueOnce(row(100_000, 0, 0))

    const result = await checkPaiseAnomalies('user1')
    expect(result.details).toMatch(/paise-audit/)
    expect(result.details).toMatch(/repair-payment-amount/)
    expect(result.details).toMatch(/explicit IDs only/)
  })

  test('runs 5 SQL queries in parallel (one per table)', async () => {
    await checkPaiseAnomalies('user1')
    expect(spy).toHaveBeenCalledTimes(5)
  })

  test('scopes every query by userId (no cross-user leak)', async () => {
    await checkPaiseAnomalies('user-special-id')
    // The first argument to $queryRawUnsafe is the SQL template; the second
    // is userId ($1 in the SQL).
    for (const call of spy.mock.calls) {
      const sql: string = call[0] as string
      const userId: string = call[1] as string
      expect(sql).toMatch(/\$1/)
      expect(userId).toBe('user-special-id')
    }
  })
})
