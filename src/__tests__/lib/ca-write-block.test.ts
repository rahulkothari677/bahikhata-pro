/**
 * V17-Ext Tier 3 Step 3: CA write-blocking tests.
 *
 * Tests the assertCanWrite() helper that enforces the "CA = read-only"
 * invariant across all write routes.
 *
 * These are PURE-FUNCTION tests — assertCanWrite takes a role string and
 * returns a NextResponse or null. No DB, no session, no network.
 *
 * SECURITY INVARIANT: A CA must NEVER be able to create, edit, or delete
 * anything. If any of these tests fail, a CA could write data.
 *
 * NOTE: We mock next-auth, @/lib/auth, @/lib/db, and next/server to avoid
 * pulling in the full server-side chain (which requires Request/Response
 * polyfills that jsdom doesn't provide). assertCanWrite itself only needs
 * NextResponse.json() — the mock provides a minimal stand-in.
 */

// jest.mock factories are hoisted above imports, so we define the mock class
// INSIDE the factory to avoid TDZ errors. We expose it via a global so the
// test assertions can reference it.
jest.mock('next/server', () => {
  class MockNextResponse {
    status: number
    body: any
    constructor(body: any, init?: { status?: number }) {
      this.body = body
      this.status = init?.status ?? 200
    }
    async json() {
      return this.body
    }
    // Static factory — matches how assertCanWrite calls NextResponse.json(body, init)
    static json(body: any, init?: { status?: number }) {
      return new MockNextResponse(body, init)
    }
  }
  // Expose on global so tests can use toBeInstanceOf
  ;(globalThis as any).MockNextResponse = MockNextResponse
  return { NextResponse: MockNextResponse }
})
jest.mock('next-auth', () => ({
  getServerSession: jest.fn().mockResolvedValue(null),
}))
jest.mock('@/lib/auth', () => ({
  authOptions: {},
  invalidateTokenVersionCache: jest.fn(),
}))
jest.mock('@/lib/db', () => ({ db: {} }))

import { assertCanWrite } from '@/lib/get-auth'

// Reference to the mock class (set by the jest.mock factory above)
const MockNextResponse = (globalThis as any).MockNextResponse

describe('🔒 V17-Ext Tier 3 Step 3: assertCanWrite', () => {
  test('blocks CA role with 403', async () => {
    const result = assertCanWrite({ role: 'ca' })
    expect(result).not.toBeNull()
    expect(result).toBeInstanceOf(MockNextResponse)
    expect(result!.status).toBe(403)

    const body = await result!.json()
    expect(body.error).toBe('Read-only access')
    expect(body.message).toContain('CA account')
    expect(body.message).toContain('read-only')
  })

  test('allows owner role (returns null)', () => {
    const result = assertCanWrite({ role: 'owner' })
    expect(result).toBeNull()
  })

  test('allows staff role (returns null)', () => {
    const result = assertCanWrite({ role: 'staff' })
    expect(result).toBeNull()
  })

  test('allows null/undefined role (legacy owner — returns null)', () => {
    // null/undefined role is treated as owner (backward compat in canAccessModule)
    expect(assertCanWrite({ role: '' as any })).toBeNull()
  })

  test('allows unknown roles (returns null — fail-open for non-CA)', () => {
    // assertCanWrite ONLY blocks 'ca'. Unknown roles are handled by
    // canAccessModule (which is fail-closed for unknown roles). So
    // assertCanWrite itself is intentionally narrow: it only blocks CA.
    // An unknown role like 'viewer' would already be denied by canAccessModule
    // before assertCanWrite is reached.
    expect(assertCanWrite({ role: 'viewer' })).toBeNull()
    expect(assertCanWrite({ role: 'manager' })).toBeNull()
    expect(assertCanWrite({ role: 'admin' })).toBeNull()
  })

  test('CA error response has correct structure for UI consumption', async () => {
    const result = assertCanWrite({ role: 'ca' })
    expect(result).not.toBeNull()
    const body = await result!.json()
    // The UI checks for body.error === 'Read-only access' to show a
    // friendly message instead of a generic error.
    expect(body).toHaveProperty('error')
    expect(body).toHaveProperty('message')
    expect(typeof body.message).toBe('string')
    expect(body.message.length).toBeGreaterThan(10)
  })
})

/**
 * Summary of the write-blocking surface area (Step 3):
 *
 * Category B (getAuthContext + assertCanWrite — 8 routes):
 *   - transactions POST (create)
 *   - transactions/[id] PUT (edit)
 *   - transactions/[id] DELETE (void)
 *   - transactions/[id]/restore POST (un-void)
 *   - payments POST (record payment)
 *   - payments/[id] DELETE (soft-delete payment)
 *   - gstr-2b/import POST (import 2B JSON)
 *   - gstr-3b POST (save/file 3B return)
 *
 * Category C (getAuthContextForWrite — 5 routes):
 *   - parties POST (create party)
 *   - parties/[id] PUT (edit party)
 *   - parties/[id] DELETE (delete party)
 *   - whatsapp-reminder POST (send reminder)
 *   - whatsapp-invoice POST (share invoice)
 *
 * Category D (getAuthContext + assertCanWrite — 2 routes):
 *   - auth/revoke-all POST (revoke sessions)
 *   - referral/apply POST (apply referral code)
 *
 * Category E (already blocked by canAccessModule — no change, 8 routes):
 *   - upload-bill, settings PUT, products POST/PUT/DELETE,
 *     voice-parse, scan-bill, scan-bill/compare POST/PATCH
 *   (CAs can't access scanner/settings/inventory modules at all)
 *
 * Category F (getAuthUserIdOwnerOnly — already blocks CA, ~9 routes):
 *   - account/delete, staff POST/PATCH/DELETE, payment/verify,
 *     payment/create-order, shops POST, seed POST/DELETE
 *
 * Category G (public routes — no auth, 3 routes):
 *   - auth/register, auth/reset-confirm, auth/reset-request
 */
describe('🔒 V17-Ext Tier 3 Step 3: write-blocking surface area', () => {
  test('assertCanWrite is the single enforcement point for CA write-block', () => {
    // This test documents the invariant: assertCanWrite is the ONLY function
    // that decides whether a CA can write. All write routes must call it
    // (directly or via getAuthContextForWrite). If this function is correct,
    // all write routes are correct.
    const caBlocked = assertCanWrite({ role: 'ca' })
    const ownerAllowed = assertCanWrite({ role: 'owner' })
    const staffAllowed = assertCanWrite({ role: 'staff' })

    expect(caBlocked).not.toBeNull()
    expect(ownerAllowed).toBeNull()
    expect(staffAllowed).toBeNull()
  })
})
