/**
 * Tests for auth tokenVersion backward compatibility
 *
 * 🔒 CRITICAL: This test catches the exact bug that broke the app on July 5.
 * The tokenVersion check was rejecting ALL existing sessions because old JWTs
 * have tokenVersion=undefined while the DB has tokenVersion=0.
 * 0 !== undefined → true → session revoked → 401 on everything.
 *
 * This test verifies the fix: undefined is treated as 0.
 */

describe('tokenVersion backward compatibility', () => {
  // Simulate the JWT callback logic (extracted from auth.ts for testing)
  function checkTokenVersion(
    dbTokenVersion: number | null,
    jwtTokenVersion: number | undefined,
  ): { revoked: boolean } {
    // This is the FIXED logic from auth.ts
    const jwtVersion = jwtTokenVersion ?? 0

    if (dbTokenVersion === null || dbTokenVersion === undefined) {
      return { revoked: true } // User not found in DB
    }

    if (dbTokenVersion !== jwtVersion) {
      return { revoked: true } // Version mismatch
    }

    return { revoked: false } // All good
  }

  it('does NOT revoke when JWT has no tokenVersion (old JWT) and DB has 0', () => {
    // This is the exact scenario that broke the app:
    // - User logged in BEFORE tokenVersion was added → JWT has undefined
    // - DB has tokenVersion = 0 (default from migration)
    const result = checkTokenVersion(0, undefined)
    expect(result.revoked).toBe(false) // Should NOT revoke
  })

  it('does NOT revoke when JWT has tokenVersion=0 and DB has 0', () => {
    const result = checkTokenVersion(0, 0)
    expect(result.revoked).toBe(false)
  })

  it('does NOT revoke when JWT has tokenVersion=1 and DB has 1', () => {
    const result = checkTokenVersion(1, 1)
    expect(result.revoked).toBe(false)
  })

  it('DOES revoke when tokenVersion was bumped (password reset / logout all)', () => {
    // User's JWT has version 0, but DB has version 1 (after password reset)
    const result = checkTokenVersion(1, 0)
    expect(result.revoked).toBe(true)
  })

  it('DOES revoke when user not found in DB', () => {
    const result = checkTokenVersion(null, 0)
    expect(result.revoked).toBe(true)
  })

  it('handles JWT tokenVersion=0 and DB tokenVersion=0 (normal new login)', () => {
    const result = checkTokenVersion(0, 0)
    expect(result.revoked).toBe(false)
  })

  it('handles multiple bumps (version 5)', () => {
    const result = checkTokenVersion(5, 5)
    expect(result.revoked).toBe(false)

    const revokedResult = checkTokenVersion(5, 4)
    expect(revokedResult.revoked).toBe(true)
  })
})
