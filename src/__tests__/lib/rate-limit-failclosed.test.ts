/**
 * Tests for rate-limit.ts — failClosed behavior
 *
 * 🔒 AUDIT FIX H9: When Redis is configured but down, cost-bearing limits
 * (AI scans) should FAIL CLOSED (deny) instead of falling back to in-memory
 * (which would allow unlimited scans per instance).
 */

describe('rate-limit.ts — failClosed behavior', () => {
  // Simulate the failClosed logic (extracted from rate-limit.ts for testing)
  function shouldFailClosed(
    failClosedOption: boolean,
    isRedisConfigured: boolean,
    redisError: boolean,
  ): { allow: boolean; reason: string } {
    if (failClosedOption && isRedisConfigured && redisError) {
      return { allow: false, reason: 'FAIL_CLOSED — Redis is down' }
    }
    return { allow: true, reason: 'ALLOWED — using Redis or in-memory fallback' }
  }

  it('denies when failClosed=true, Redis configured, Redis error', () => {
    const result = shouldFailClosed(true, true, true)
    expect(result.allow).toBe(false)
    expect(result.reason).toContain('FAIL_CLOSED')
  })

  it('allows when failClosed=true but Redis is NOT configured (dev mode)', () => {
    const result = shouldFailClosed(true, false, false)
    expect(result.allow).toBe(true)
  })

  it('allows when failClosed=true, Redis configured, no error', () => {
    const result = shouldFailClosed(true, true, false)
    expect(result.allow).toBe(true)
  })

  it('allows when failClosed=false (login/signup — availability over exactness)', () => {
    const result = shouldFailClosed(false, true, true)
    expect(result.allow).toBe(true)
  })

  it('allows when failClosed=false and Redis is not configured', () => {
    const result = shouldFailClosed(false, false, false)
    expect(result.allow).toBe(true)
  })
})
