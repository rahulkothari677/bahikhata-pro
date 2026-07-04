import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import bcrypt from 'bcryptjs'
import { resetTokens } from '../reset-request/route'

/**
 * POST /api/auth/reset-confirm
 *
 * Confirms a password reset using the token from the email/link.
 * Updates the user's password.
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

    // Find the token
    const tokenData = resetTokens.get(token)
    if (!tokenData) {
      return NextResponse.json({ error: 'Invalid or expired reset token' }, { status: 400 })
    }

    // Check if token expired
    if (Date.now() > tokenData.expiresAt) {
      resetTokens.delete(token)
      return NextResponse.json({ error: 'Reset token has expired. Please request a new one.' }, { status: 400 })
    }

    // Hash the new password
    const hashedPassword = await bcrypt.hash(password, 12)

    // Update the user's password AND bump tokenVersion (audit fix Phase 3.3).
    // Bumping tokenVersion invalidates ALL existing JWTs for this user, so
    // any attacker who stole a session token before the password reset is
    // now logged out. The user must re-login with the new password.
    try {
      await db.user.update({
        where: { email: tokenData.email },
        data: {
          password: hashedPassword,
          tokenVersion: { increment: 1 },  // 🔒 revoke all existing sessions
        },
      })
    } catch (dbError) {
      console.error('[reset-confirm] DB error:', dbError)
      return NextResponse.json({ error: 'Database error. Please try again or contact support.' }, { status: 503 })
    }

    // Delete the used token (one-time use)
    resetTokens.delete(token)

    return NextResponse.json({
      success: true,
      message: 'Password updated successfully. You can now login with your new password.',
    })
  } catch (error) {
    console.error('[reset-confirm] Error:', error)
    return NextResponse.json({ error: 'Failed to reset password' }, { status: 500 })
  }
}
