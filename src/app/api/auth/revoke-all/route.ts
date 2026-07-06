import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getAuthUserId } from '@/lib/get-auth'
import { invalidateTokenVersionCache } from '@/lib/auth'

/**
 * POST /api/auth/revoke-all
 *
 * 🔒 SECURITY (Audit fix Phase 3.3 + V9 2.8): Revokes ALL existing JWT sessions
 * for the current user by incrementing `tokenVersion` on the User record.
 *
 * V9 2.8: Now also invalidates the Redis cache for tokenVersion, so the
 * revocation takes effect within ~5 seconds (was up to 30 minutes with
 * the old throttle).
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

    // 🔒 V9 2.8: Invalidate Redis cache so revocation takes effect in ~5s
    // (not up to 30 minutes). Without this, the cached old tokenVersion
    // would persist until the 5-second TTL expires naturally.
    await invalidateTokenVersionCache(userId)

    return NextResponse.json({
      success: true,
      message: 'All sessions revoked. You will need to log in again on all devices.',
    })
  } catch (error) {
    console.error('[revoke-all] Error:', error)
    return NextResponse.json({ error: 'Failed to revoke sessions' }, { status: 500 })
  }
}
