import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import bcrypt from 'bcryptjs'
import crypto from 'crypto'
import { invalidateTokenVersionCache } from '@/lib/auth'

/**
 * POST /api/auth/reset-confirm
 *
 * Confirms a password reset using the token from the email/link.
 * Updates the user's password.
 *
 * 🔒 AUDIT FIX C2 (v2 audit): Now uses DB-stored hashed tokens instead of
 * the in-memory Map. The token is hashed (SHA-256) on the server and looked
 * up by hash — the raw token is never stored.
 *
 * Body: { token: string, password: string }
 */
export async function POST(req: NextRequest) {
  try {
    const { token, password } = await req.json()

    if (!token || !password) {
      return NextResponse.json({ error: 'Token and new password are required' }, { status: 400 })
    }

    if (password.length < 8) {
      return NextResponse.json({ error: 'Password must be at least 8 characters' }, { status: 400 })
    }

    // 🔒 SECURITY (C2): Hash the token and look it up in the DB
    const tokenHash = crypto.createHash('sha256').update(token).digest('hex')

    let tokenRecord
    try {
      tokenRecord = await db.passwordResetToken.findUnique({
        where: { tokenHash },
      })
    } catch (dbError) {
      console.error('[reset-confirm] DB error looking up token:', dbError)
      return NextResponse.json({ error: 'Database error. Please try again.' }, { status: 503 })
    }

    if (!tokenRecord) {
      return NextResponse.json({ error: 'Invalid or expired reset token' }, { status: 400 })
    }

    // Check if token already used (single-use)
    if (tokenRecord.usedAt) {
      return NextResponse.json({ error: 'This reset token has already been used. Please request a new one.' }, { status: 400 })
    }

    // Check if token expired
    if (new Date() > tokenRecord.expiresAt) {
      // Clean up expired token
      try {
        await db.passwordResetToken.delete({ where: { id: tokenRecord.id } })
      } catch {}
      return NextResponse.json({ error: 'Reset token has expired. Please request a new one.' }, { status: 400 })
    }

    // Hash the new password
    const hashedPassword = await bcrypt.hash(password, 12)

    // 🔒 ATOMICITY: Update password + bump tokenVersion + mark token as used
    // in a single transaction. If any step fails, all roll back.
    try {
      await db.$transaction([
        // Update password and revoke all sessions (tokenVersion bump)
        db.user.update({
          where: { email: tokenRecord.email },
          data: {
            password: hashedPassword,
            tokenVersion: { increment: 1 },  // 🔒 revoke all existing sessions
          },
        }),
        // Mark token as used (single-use enforcement)
        db.passwordResetToken.update({
          where: { id: tokenRecord.id },
          data: { usedAt: new Date() },
        }),
      ])
    } catch (dbError) {
      console.error('[reset-confirm] DB error updating password:', dbError)
      return NextResponse.json({ error: 'Database error. Please try again or contact support.' }, { status: 503 })
    }

    // 🔒 V9 2.8: Invalidate Redis cache for tokenVersion so the password
    // reset takes effect immediately (kills all existing sessions within ~5s).
    // Need to fetch the user ID from the email since the $transaction above
    // doesn't return it directly.
    try {
      const user = await db.user.findUnique({
        where: { email: tokenRecord.email },
        select: { id: true },
      })
      if (user) {
        await invalidateTokenVersionCache(user.id)
      }
    } catch {
      // Non-critical — the 5s TTL will expire the old cache naturally
    }

    return NextResponse.json({
      success: true,
      message: 'Password updated successfully. You can now login with your new password.',
    })
  } catch (error) {
    console.error('[reset-confirm] Error:', error)
    return NextResponse.json({ error: 'Failed to reset password' }, { status: 500 })
  }
}
