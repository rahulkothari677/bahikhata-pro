/**
 * @jest-environment node
 *
 * A wrongly imported bank statement must be removable.
 *
 * WHY (audit 2026-08-05, Phase 10). /api/bank-recon exposed import (POST),
 * reconcile (GET) and match/unmatch one row (PATCH). There was no delete, in
 * the API or the UI.
 *
 * So importing the wrong CSV — wrong account, wrong month, a file from another
 * bank — was permanent. Those rows sat in reconciliation for good, showing as
 * unmatched, and the only escape was deleting the whole account. A shopkeeper
 * would be told forever about transactions that were never theirs.
 *
 * Found by importing a probe statement during this audit and discovering I
 * could not remove it.
 *
 * Two properties are load-bearing and each has a test:
 *
 *  1. Scoped by userId. `delete({ where: { id } })` matches on the primary key
 *     alone, so one shop could remove another's import by guessing an id.
 *  2. The shopkeeper's LEDGER is untouched. BankTransaction rows are imported
 *     data; matchedPaymentId/matchedTransactionId point outward from the
 *     statement to real payments and invoices. Removing the statement must drop
 *     those pointers and nothing else.
 */

const mockStatementFindFirst = jest.fn()
const mockStatementDeleteMany = jest.fn()
const mockTxnDeleteMany = jest.fn()
const mockPaymentDeleteMany = jest.fn()
const mockTransactionDeleteMany = jest.fn()

jest.mock('@/lib/db', () => ({
  db: {
    bankStatement: {
      findFirst: (...a: unknown[]) => mockStatementFindFirst(...a),
      deleteMany: (...a: unknown[]) => mockStatementDeleteMany(...a),
    },
    bankTransaction: { deleteMany: (...a: unknown[]) => mockTxnDeleteMany(...a) },
    // Present so the test can prove they are NEVER called.
    payment: { deleteMany: (...a: unknown[]) => mockPaymentDeleteMany(...a) },
    transaction: { deleteMany: (...a: unknown[]) => mockTransactionDeleteMany(...a) },
    $transaction: jest.fn(async (fn: (tx: unknown) => unknown) =>
      fn({
        bankTransaction: { deleteMany: (...a: unknown[]) => mockTxnDeleteMany(...a) },
        bankStatement: { deleteMany: (...a: unknown[]) => mockStatementDeleteMany(...a) },
      }),
    ),
  },
}))

const mockGetAuthContext = jest.fn()
const mockAssertCanWrite = jest.fn()
jest.mock('@/lib/get-auth', () => ({
  getAuthContext: (...a: unknown[]) => mockGetAuthContext(...a),
  assertCanWrite: (...a: unknown[]) => mockAssertCanWrite(...a),
}))

jest.mock('@/lib/staff-permissions', () => ({ canAccessModule: jest.fn(() => true) }))
jest.mock('@/lib/audit', () => ({ logAudit: jest.fn() }))

import { DELETE } from '@/app/api/bank-recon/statement/[id]/route'

const OWNER = 'user_owner'
const req = () => new Request('https://app.test/api/bank-recon/statement/bs_1', { method: 'DELETE' }) as never
const ctx = (id = 'bs_1') => ({ params: Promise.resolve({ id }) }) as never

beforeEach(() => {
  jest.clearAllMocks()
  mockGetAuthContext.mockResolvedValue({
    userId: OWNER, actingUserId: OWNER, role: 'owner', permissions: null,
    isImpersonated: false, impersonatedBy: null,
  })
  mockAssertCanWrite.mockReturnValue(undefined)
  mockStatementFindFirst.mockResolvedValue({ id: 'bs_1', bankName: 'HDFC', txnCount: 12 })
  mockTxnDeleteMany.mockResolvedValue({ count: 12 })
  mockStatementDeleteMany.mockResolvedValue({ count: 1 })
})

describe('a wrong import can be removed', () => {
  it('deletes the statement and reports how many rows went with it', async () => {
    const res = await DELETE(req(), ctx())
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.success).toBe(true)
    expect(body.rowsRemoved).toBe(12)
  })

  it('removes the rows and the statement in ONE transaction', async () => {
    const { db } = jest.requireMock('@/lib/db') as { db: { $transaction: jest.Mock } }
    await DELETE(req(), ctx())
    expect(db.$transaction).toHaveBeenCalled()
    expect(mockTxnDeleteMany).toHaveBeenCalled()
    expect(mockStatementDeleteMany).toHaveBeenCalled()
  })

  it('404s for an id the caller does not own, without deleting anything', async () => {
    mockStatementFindFirst.mockResolvedValue(null)
    const res = await DELETE(req(), ctx('someone_elses'))
    expect(res.status).toBe(404)
    expect(mockTxnDeleteMany).not.toHaveBeenCalled()
    expect(mockStatementDeleteMany).not.toHaveBeenCalled()
  })
})

describe('one shop cannot delete another shop\'s import', () => {
  it('scopes the lookup by userId', async () => {
    await DELETE(req(), ctx())
    const [args] = mockStatementFindFirst.mock.calls[0] as [{ where: Record<string, unknown> }]
    expect(args.where).toEqual(expect.objectContaining({ userId: OWNER }))
  })

  it('scopes BOTH deletes by userId, not by id alone', async () => {
    // The regression: `delete({ where: { id } })` matches on the primary key
    // and ignores ownership entirely.
    await DELETE(req(), ctx())
    for (const call of [...mockTxnDeleteMany.mock.calls, ...mockStatementDeleteMany.mock.calls]) {
      expect((call[0] as { where: Record<string, unknown> }).where)
        .toEqual(expect.objectContaining({ userId: OWNER }))
    }
  })
})

describe('the ledger itself is never touched', () => {
  it('deletes no payments and no transactions', async () => {
    // This is the whole safety argument for making it a hard delete. A bank
    // statement is imported data; the shopkeeper's money is not.
    await DELETE(req(), ctx())
    expect(mockPaymentDeleteMany).not.toHaveBeenCalled()
    expect(mockTransactionDeleteMany).not.toHaveBeenCalled()
  })

  it('says so in the response, because a delete button on money is frightening', async () => {
    const res = await DELETE(req(), ctx())
    const body = await res.json()
    expect(body.message).toMatch(/unchanged/i)
  })
})

describe('read-only roles cannot delete an import', () => {
  it('refuses a CA', async () => {
    mockAssertCanWrite.mockReturnValue(
      new Response(JSON.stringify({ error: 'Read-only access' }), { status: 403 }),
    )
    const res = await DELETE(req(), ctx())
    expect(res.status).toBe(403)
    expect(mockStatementDeleteMany).not.toHaveBeenCalled()
  })

  it('refuses an unauthenticated caller', async () => {
    mockGetAuthContext.mockResolvedValue({
      userId: null,
      error: new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 }),
    })
    const res = await DELETE(req(), ctx())
    expect(res.status).toBe(401)
    expect(mockStatementDeleteMany).not.toHaveBeenCalled()
  })
})
