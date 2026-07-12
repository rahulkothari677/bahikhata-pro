/**
 * 🔒 V20-017: Sentry integration smoke test
 *
 * Verifies that apiError() and captureGstFilingError() don't crash when
 * called, and that they return the expected response shape. Does NOT
 * verify Sentry actually receives events (that requires a live DSN +
 * network — an integration test, not a unit test).
 *
 * The dynamic import('@sentry/nextjs') in api-error.ts is wrapped in
 * .catch(), so even if @sentry/nextjs isn't installed, the function
 * doesn't throw. This test verifies that resilience.
 */

// Mock next/server — jsdom doesn't provide the Request/Response polyfills
// that NextResponse needs. We provide a minimal stand-in.
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
    static json(body: any, init?: { status?: number }) {
      return new MockNextResponse(body, init)
    }
  }
  return { NextResponse: MockNextResponse, NextRequest: class {} }
})

import { describe, test, expect } from '@jest/globals'
import { apiError } from '@/lib/api-error'
import { captureGstFilingError } from '@/lib/sentry-gst'

describe('🔒 V20-017: Sentry integration smoke test', () => {
  test('apiError returns a NextResponse with errorId and status 500', async () => {
    const error = new Error('Test GST filing failure')
    const response = apiError(error, 'Failed to file GSTR-3B', 500, {
      route: '/api/gstr-3b',
      action: 'file',
    })

    // Returns a NextResponse (has .json() method)
    expect(response).toBeDefined()
    expect(typeof response.json).toBe('function')

    // Status is 500
    expect(response.status).toBe(500)

    // Body has error message + errorId
    const body = await response.json()
    expect(body.error).toBe('Failed to file GSTR-3B')
    expect(body.errorId).toBeDefined()
    expect(body.errorId).toMatch(/^[a-f0-9]{8}$/) // 8-char hex
  })

  test('apiError with 400 status does not crash', () => {
    const error = new Error('Bad request')
    const response = apiError(error, 'Invalid input', 400)

    expect(response.status).toBe(400)
    // No assertion on Sentry — we just verify it doesn't crash.
    // The 400 path skips captureInSentry entirely (status < 500).
  })

  test('apiError does not leak context to the client', async () => {
    const error = new Error('DB timeout')
    const response = apiError(error, 'Database error', 503, {
      userId: 'user123',
      route: '/api/gstr-3b',
    })

    expect(response.status).toBe(503)
    const body = await response.json()
    expect(body.error).toBe('Database error')
    expect(body.errorId).toBeDefined()
    // Context is NOT sent to the client (security: don't leak internals)
    expect(body.userId).toBeUndefined()
    expect(body.route).toBeUndefined()
  })

  test('captureGstFilingError does not throw (fire-and-forget)', () => {
    const error = new Error('GST compute failure')

    // This should NOT throw, even if @sentry/nextjs isn't fully initialized
    expect(() => {
      captureGstFilingError(error, {
        route: '/api/gstr-3b',
        action: 'compute',
      })
    }).not.toThrow()
  })

  test('captureGstFilingError with all optional fields does not throw', () => {
    const error = new Error('GST file failure')

    expect(() => {
      captureGstFilingError(error, {
        route: '/api/gstr-1',
        action: 'file',
        monthYear: '072026',
        userId: 'user123',
        metadata: { transactionId: 'txn456', gstin: '27ABCDE1234F1Z5' },
      })
    }).not.toThrow()
  })

  test('apiError generates unique errorIds', async () => {
    const error = new Error('Test')
    const r1 = apiError(error, 'Error 1', 500)
    const r2 = apiError(error, 'Error 2', 500)

    // Both should have valid errorIds
    const b1 = await r1.json()
    const b2 = await r2.json()
    expect(b1.errorId).toMatch(/^[a-f0-9]{8}$/)
    expect(b2.errorId).toMatch(/^[a-f0-9]{8}$/)
    // ErrorIds should be different (random)
    expect(b1.errorId).not.toBe(b2.errorId)
  })
})

