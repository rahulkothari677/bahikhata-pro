/**
 * @jest-environment node
 *
 * An edit made by a support admin must be attributable to that admin.
 *
 * WHY (audit 2026-08-04, Phase 7). An admin can log in AS a shopkeeper and, on
 * 34 of the 43 mutating routes, write to that shopkeeper's books —
 * assertNotImpersonated guards only 9 (export, account delete, restore,
 * payments, staff).
 *
 * Both audit trails then recorded the SHOPKEEPER as the actor:
 *
 *   - AuditLog.userId is the shopkeeper by design; the entry belongs in their
 *     trail. But nothing else was stored, so an admin's action was
 *     indistinguishable from the account holder's own.
 *   - FieldChangeLog.changedByUserId held the shopkeeper's id — in a table the
 *     schema describes as "fraud defense + court-admissible".
 *
 * The session DID carry `impersonatedBy`, the admin's email. It was read in
 * exactly one place — ImpersonationBanner.tsx — to draw a banner. It reached
 * nothing that is stored. So the shopkeeper's own records could never answer
 * "did I change this, or did support?", which is the first question anyone asks
 * about a disputed invoice.
 *
 * These tests drive the real logAudit and logFieldChanges.
 */

const auditRows: any[] = []
const fieldRows: any[] = []

jest.mock('@/lib/db', () => ({
  db: {
    auditLog: {
      create: jest.fn(async ({ data }: any) => { auditRows.push(data); return data }),
    },
    fieldChangeLog: {
      createMany: jest.fn(async ({ data }: any) => { fieldRows.push(...data); return { count: data.length } }),
      create: jest.fn(async ({ data }: any) => { fieldRows.push(data); return data }),
    },
  },
}))

import { logAudit } from '@/lib/audit'
import { logFieldChanges } from '@/lib/field-audit'

const SHOPKEEPER = 'user_shopkeeper'
const ADMIN_EMAIL = 'founder@ekbook.example'

beforeEach(() => {
  auditRows.length = 0
  fieldRows.length = 0
  jest.clearAllMocks()
})

describe('AuditLog records the admin behind an impersonated action', () => {
  it('names the admin when the action was taken while impersonating', async () => {
    await logAudit({
      userId: SHOPKEEPER,
      action: 'transaction.update',
      entityType: 'transaction',
      entityId: 'txn_1',
      impersonatedBy: ADMIN_EMAIL,
    })

    expect(auditRows).toHaveLength(1)
    // Still filed under the shopkeeper — it is their trail.
    expect(auditRows[0].userId).toBe(SHOPKEEPER)
    // …but no longer indistinguishable from their own action.
    expect(auditRows[0].metadata).toEqual(
      expect.objectContaining({ impersonatedBy: ADMIN_EMAIL }),
    )
  })

  it('keeps the caller\'s own metadata alongside it', async () => {
    await logAudit({
      userId: SHOPKEEPER,
      action: 'transaction.update',
      metadata: { reason: 'support ticket 412', amount: 2360 },
      impersonatedBy: ADMIN_EMAIL,
    })

    expect(auditRows[0].metadata).toEqual({
      reason: 'support ticket 412',
      amount: 2360,
      impersonatedBy: ADMIN_EMAIL,
    })
  })

  it('does NOT mark a shopkeeper\'s own action as impersonated', async () => {
    // The control. If this ever fails, every ordinary edit is being libelled as
    // a support action, which is worse than the bug being fixed.
    await logAudit({
      userId: SHOPKEEPER,
      action: 'transaction.update',
      metadata: { reason: 'normal edit' },
    })

    expect(auditRows[0].metadata).toEqual({ reason: 'normal edit' })
    expect(JSON.stringify(auditRows[0].metadata)).not.toContain('impersonatedBy')
  })

  it('leaves metadata undefined for a plain action with none', async () => {
    await logAudit({ userId: SHOPKEEPER, action: 'login_success' })
    expect(auditRows[0].metadata).toBeUndefined()
  })
})

describe('FieldChangeLog records the admin behind an impersonated edit', () => {
  const base = {
    userId: SHOPKEEPER,
    entityType: 'transaction' as const,
    entityId: 'txn_1',
    oldValues: { totalAmount: 2360 },
    newValues: { totalAmount: 9999 },
    fieldsToTrack: ['totalAmount'] as const,
    changedByUserId: SHOPKEEPER,
  }

  it('stores the admin email on each changed field', async () => {
    await logFieldChanges({ ...base, impersonatedBy: ADMIN_EMAIL })

    expect(fieldRows).toHaveLength(1)
    expect(fieldRows[0].fieldName).toBe('totalAmount')
    expect(fieldRows[0].impersonatedBy).toBe(ADMIN_EMAIL)
    // changedByUserId keeps its existing meaning — the account the write ran as.
    expect(fieldRows[0].changedByUserId).toBe(SHOPKEEPER)
  })

  it('stores null for the shopkeeper\'s own edit', async () => {
    await logFieldChanges(base)
    expect(fieldRows[0].impersonatedBy).toBeNull()
  })

  it('marks every field of a multi-field impersonated edit', async () => {
    // One edit can change several fields; a row that lost the attribution
    // would look like a shopkeeper edit sitting inside a support edit.
    await logFieldChanges({
      ...base,
      oldValues: { totalAmount: 2360, paidAmount: 2360, notes: 'a' },
      newValues: { totalAmount: 9999, paidAmount: 0, notes: 'b' },
      fieldsToTrack: ['totalAmount', 'paidAmount', 'notes'],
      impersonatedBy: ADMIN_EMAIL,
    })

    expect(fieldRows).toHaveLength(3)
    for (const row of fieldRows) expect(row.impersonatedBy).toBe(ADMIN_EMAIL)
  })
})
