/**
 * 🔒 GUARD: "still due on a bill" means the same in SQL as in computeInvoiceDue
 * (Phase 5c). The oldest-unpaid query behind Debt Aging used
 * `totalAmount > paidAmount`, ignoring payments settled against the bill later.
 */
import { describe, test, expect } from '@jest/globals'
import { ALLOCATED_JOIN, DUE_SQL, oldestDueSaleSql } from '@/lib/invoice-due-sql'
import { readCode } from '@/test-support/read-source'

describe('the SQL due rule', () => {
  test('subtracts allocations of payments that are not deleted', () => {
    expect(DUE_SQL.sql).toContain('t."totalAmount" - t."paidAmount" - COALESCE(a.alloc, 0)')
    expect(ALLOCATED_JOIN.sql).toContain('py."deletedAt" IS NULL')
    expect(oldestDueSaleSql('u1').sql).toContain('> 0')
  })
  test('Insights and the Debt Aging data both use it; neither keeps the old comparison', () => {
    for (const f of ['src/app/api/insights/route.ts', 'src/app/api/reports/route.ts']) {
      const code = readCode(f)
      expect({ f, shared: code.includes('oldestDueSaleSql(userId)'), old: /"totalAmount" > "paidAmount"\s*GROUP BY "partyId"/.test(code) })
        .toEqual({ f, shared: true, old: false })
    }
  })
})
