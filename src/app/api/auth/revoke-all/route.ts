import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getAuthUserId } from '@/lib/get-auth'

/**
 * POST /api/auth/revoke-all
 *
 * 🔒 SECURITY (Audit fix Phase 3.3): Revokes ALL existing JWT sessions for the
 * current user by incrementing `tokenVersion` on the User record. Every JWT
 * contains a `tokenVersion` claim; the jwt callback in auth.ts checks it on
 * every request (throttled to once per 5 min). If the DB's tokenVersion
 * doesn't match the token's, the session is treated as logged out.
 *
 * Use cases:
 *   - "Logout all devices" button in settings
 *   - User suspects their session was stolen
 *   - Admin force-logs-out a user
 *
 * After calling this, the user (and any attacker with a stolen token) must
 * re-login. The tokenVersion check runs within 5 minutes, so worst case a
 * stolen session lives for 5 more minutes before being killed.
 *
 * Auth: requires the user to be logged in (calls getAuthUserId).
 */
export async function POST() {
  try {
    const { userId, error } = await getAuthUserId()
    if (error || !userId) return error || NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    // Atomically increment tokenVersion. All existing JWTs become invalid
    // because their embedded tokenVersion claim no longer matches the DB.
    await db.user.update({
      where: { id: userId },
      data: { tokenVersion: { increment: 1 } },
    })

    return NextResponse.json({
      success: true,
      message: 'All sessions revoked. You will need to log in again on all devices.',
    })
  } catch (error) {
    console.error('[revoke-all] Error:', error)
    return NextResponse.json({ error: 'Failed to revoke sessions' }, { status: 500 })
  }
}
