import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { rateLimit, getClientIP, rateLimitedResponse } from '@/lib/rate-limit'
import crypto from 'crypto'

/**
 * POST /api/auth/reset-request
 *
 * Generates a password reset token and (in dev mode) returns it directly.
 * In production, this would email the link to the user via Resend/SendGrid.
 *
 * Rate limited: 3 requests per email per hour (prevents abuse)
 */

// In-memory store for reset tokens (in production, use Redis or DB table)
// Token expires after 1 hour
const resetTokens = new Map<string, { email: string; expiresAt: number }>()

export async function POST(req: NextRequest) {
  try {
    // Rate limit: 3 per IP per hour
    const ip = getClientIP(req)
    const rl = rateLimit(`reset-request:${ip}`, { limit: 3, windowSec: 3600 })
    if (!rl.success) return rateLimitedResponse(rl)

    const { email } = await req.json()
    if (!email) {
      return NextResponse.json({ error: 'Email is required' }, { status: 400 })
    }

    const emailLower = email.toLowerCase()

    // Check if user exists — defensive (DB might not have new columns yet)
    let user
    try {
      user = await db.user.findUnique({ where: { email: emailLower } })
    } catch (dbError) {
      console.error('[reset-request] DB error:', dbError)
      return NextResponse.json({ error: 'Database temporarily unavailable. Please try again in a moment.' }, { status: 503 })
    }

    if (!user) {
      // Don't reveal whether email exists (security)
      return NextResponse.json({ success: true, message: 'If the email exists, a reset link has been sent.' })
    }

    // Generate secure random token
    const token = crypto.randomBytes(32).toString('hex')
    const expiresAt = Date.now() + 60 * 60 * 1000 // 1 hour

    // Store token
    resetTokens.set(token, { email: emailLower, expiresAt })

    // Clean up expired tokens
    if (resetTokens.size > 100) {
      const now = Date.now()
      for (const [key, value] of resetTokens) {
        if (value.expiresAt < now) resetTokens.delete(key)
      }
    }

    // Dev mode: return the reset link directly (no email sent)
    const origin = req.headers.get('origin') || 'https://bahakhata-pro.vercel.app'
    const resetLink = `${origin}/reset-password?token=${token}`

    // TODO: When email service is set up, replace this with actual email sending:
    // await sendEmail({
    //   to: emailLower,
    //   subject: 'Reset your BahiKhata Pro password',
    //   body: `Click here to reset your password: ${resetLink}`,
    // })

    return NextResponse.json({
      success: true,
      message: 'If the email exists, a reset link has been sent.',
      // DEV MODE: return the link directly so user can click it
      // Remove this in production when email sending is enabled
      resetLink,
    })
  } catch (error) {
    console.error('[reset-request] Error:', error)
    return NextResponse.json({ error: 'Failed to process request' }, { status: 500 })
  }
}

// Export the token store for the confirm endpoint to use
export { resetTokens }
