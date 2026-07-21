/**
 * 🔒 V20-018: Nightly reconciliation cron route smoke test
 *
 * Verifies the auth gate and response shape of /api/cron/nightly-reconciliation.
 * Does NOT run the full reconciliation (that requires a live DB with users) —
 * this is a smoke test for the route's security + response contract.
 */

// Mock next/server — same pattern as v20-sentry-integration.test.ts
jest.mock('next/server', () => {
  class MockNextResponse {
    status: number
    body: any
    headers: Map<string, string>
    constructor(body: any, init?: { status?: number }) {
      this.body = body
      this.status = init?.status ?? 200
      this.headers = new Map()
    }
    async json() {
      return this.body
    }
    static json(body: any, init?: { status?: number }) {
      return new MockNextResponse(body, init)
    }
  }
  return { NextResponse: MockNextResponse, NextRequest: class {
    headers = new Map<string, string>()
    constructor() {
      this.headers.set('authorization', '')
    }
  } }
})

// Mock the db + reconciliation so we don't need a live database
jest.mock('@/lib/db', () => ({
  db: {
    user: {
      findMany: jest.fn(),
    },
  },
}))

jest.mock('@/lib/reconciliation', () => ({
  // 🔒 Critical #3: The nightly cron now uses runReconciliationChecksNightly
  // (the extended function that ALSO runs checkPaiseAnomalies). Mock that.
  runReconciliationChecks: jest.fn(),
  runReconciliationChecksNightly: jest.fn(),
}))

import { describe, test, expect, beforeEach } from '@jest/globals'
import { GET } from '@/app/api/cron/nightly-reconciliation/route'
import { db } from '@/lib/db'
import { runReconciliationChecksNightly as runReconciliationChecks } from '@/lib/reconciliation'

// Helper: create a mock NextRequest with the given auth header
function makeRequest(authHeader?: string) {
  const req = {
    headers: new Map<string, string>(),
  } as any
  if (authHeader !== undefined) {
    req.headers.set('authorization', authHeader)
  }
  return req
}

describe('🔒 V20-018: Nightly reconciliation cron route', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    delete process.env.CRON_SECRET
  })

  test('returns 503 when CRON_SECRET env var is not set', async () => {
    const req = makeRequest('Bearer some-secret')
    const response = await GET(req)
    expect(response.status).toBe(503)
    const body = await response.json()
    expect(body.error).toContain('CRON_SECRET not configured')
  })

  test('returns 401 when Authorization header is missing', async () => {
    process.env.CRON_SECRET = 'test-secret'
    const req = makeRequest(undefined)  // no auth header
    const response = await GET(req)
    expect(response.status).toBe(401)
    const body = await response.json()
    expect(body.error).toContain('Unauthorized')
  })

  test('returns 401 when Authorization header has wrong secret', async () => {
    process.env.CRON_SECRET = 'correct-secret'
    const req = makeRequest('Bearer wrong-secret')
    const response = await GET(req)
    expect(response.status).toBe(401)
  })

  test('returns 401 when Authorization header has wrong format', async () => {
    process.env.CRON_SECRET = 'test-secret'
    const req = makeRequest('test-secret')  // missing "Bearer " prefix
    const response = await GET(req)
    expect(response.status).toBe(401)
  })

  test('returns success with 0 users when DB is empty', async () => {
    process.env.CRON_SECRET = 'test-secret'
    ;(db.user.findMany as jest.Mock).mockResolvedValue([])

    const req = makeRequest('Bearer test-secret')
    const response = await GET(req)
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.ok).toBe(true)
    expect(body.totalUsers).toBe(0)
    expect(body.totalFailures).toBe(0)
    expect(body.message).toContain('No users found')
  })

  test('runs reconciliation for each user and returns summary', async () => {
    process.env.CRON_SECRET = 'test-secret'
    const mockUsers = [
      { id: 'user1', email: 'user1@test.com', name: 'User One' },
      { id: 'user2', email: 'user2@test.com', name: 'User Two' },
    ]
    ;(db.user.findMany as jest.Mock).mockResolvedValue(mockUsers)
    ;(runReconciliationChecks as jest.Mock)
      .mockResolvedValueOnce({
        allPassed: true,
        checks: [
          { name: 'Party Balances', passed: true, details: 'OK' },
          { name: 'GST Reconciliation', passed: true, details: 'OK' },
          { name: 'Data Integrity', passed: true, details: 'OK' },
        ],
      })
      .mockResolvedValueOnce({
        allPassed: false,
        checks: [
          { name: 'Party Balances', passed: true, details: 'OK' },
          { name: 'GST Reconciliation', passed: false, details: 'GST mismatch: CGST items=100 vs headers=99' },
          { name: 'Data Integrity', passed: true, details: 'OK' },
        ],
      })

    const req = makeRequest('Bearer test-secret')
    const response = await GET(req)
    expect(response.status).toBe(200)
    const body = await response.json()

    expect(body.ok).toBe(true)
    expect(body.totalUsers).toBe(2)
    expect(body.totalPassed).toBe(1)
    expect(body.totalFailed).toBe(1)
    expect(body.totalFailures).toBe(1)
    expect(body.failures).toHaveLength(1)
    expect(body.failures[0].userId).toBe('user2')
    expect(body.failures[0].checkName).toBe('GST Reconciliation')
    expect(body.failures[0].details).toContain('GST mismatch')
  })

  test('continues processing other users if one user crashes', async () => {
    process.env.CRON_SECRET = 'test-secret'
    const mockUsers = [
      { id: 'user1', email: 'user1@test.com', name: 'User One' },
      { id: 'user2', email: 'user2@test.com', name: 'User Two' },
      { id: 'user3', email: 'user3@test.com', name: 'User Three' },
    ]
    ;(db.user.findMany as jest.Mock).mockResolvedValue(mockUsers)
    ;(runReconciliationChecks as jest.Mock)
      .mockResolvedValueOnce({
        allPassed: true,
        checks: [{ name: 'Party Balances', passed: true, details: 'OK' }],
      })
      .mockRejectedValueOnce(new Error('DB connection lost'))
      .mockResolvedValueOnce({
        allPassed: true,
        checks: [{ name: 'Party Balances', passed: true, details: 'OK' }],
      })

    const req = makeRequest('Bearer test-secret')
    const response = await GET(req)
    expect(response.status).toBe(200)
    const body = await response.json()

    expect(body.totalUsers).toBe(3)
    expect(body.totalFailed).toBe(1)
    expect(body.totalFailures).toBe(1)
    expect(body.failures[0].checkName).toBe('reconciliation-crash')
    expect(body.failures[0].details).toContain('DB connection lost')
  })
})
