import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { rateLimit, getClientIP, rateLimitedResponse } from '@/lib/rate-limit'
import crypto from 'crypto'

/**
 * POST /api/auth/reset-request
 *
 * 🔒 AUDIT FIX C1+C2 (v2 audit):
 * - C1: Never return the reset link in the API response (was: account takeover
 *   — attacker could reset ANY account by reading resetLink from the response).
 *   Now: always returns the same generic message regardless of whether the
 *   email exists. The link is only returned in dev mode (gated by
 *   ALLOW_DEV_RESET env var) for testing.
 * - C2: Tokens are now stored in the DB (PasswordResetToken table) with
 *   SHA-256 hashing, not in an in-memory Map. This fixes the serverless
 *   multi-instance bug where tokens created on instance A didn't exist on
 *   instance B.
 *
 * Rate limited: 3 requests per IP per hour (prevents abuse)
 */

export async function POST(req: NextRequest) {
  try {
    // Rate limit: 3 per IP per hour
    const ip = getClientIP(req)
    const rl = await rateLimit(`reset-request:${ip}`, { limit: 3, windowSec: 3600 })
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

    // 🔒 SECURITY (C1): Always return the same generic message whether or not
    // the email exists. This prevents account enumeration (attacker can't tell
    // if an email is registered by reading the response).
    const genericResponse = NextResponse.json({
      success: true,
      message: 'If the email exists, a reset link has been sent.',
    })

    if (!user) {
      // Email doesn't exist — return the same generic message (don't reveal)
      return genericResponse
    }

    // Generate secure random token
    const token = crypto.randomBytes(32).toString('hex')
    const tokenHash = crypto.createHash('sha256').update(token).digest('hex')
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000) // 1 hour

    // 🔒 SECURITY (C2): Store token HASH in DB (not raw token, not in-memory Map)
    try {
      await db.passwordResetToken.create({
        data: {
          email: emailLower,
          tokenHash,
          expiresAt,
        },
      })
    } catch (dbError) {
      console.error('[reset-request] Failed to store reset token:', dbError)
      // Don't reveal the error to the user — return generic message
      return genericResponse
    }

    // Clean up expired tokens for this email (housekeeping, non-critical)
    try {
      await db.passwordResetToken.deleteMany({
        where: {
          email: emailLower,
          expiresAt: { lt: new Date() },
        },
      })
    } catch {
      // Non-critical — don't fail the request if cleanup fails
    }

    // 🔒 SECURITY (C1): In production, send the link via email (never in response).
    // In development, return the link ONLY if ALLOW_DEV_RESET env var is set.
    const isDevReset = process.env.NODE_ENV !== 'production' && process.env.ALLOW_DEV_RESET === 'true'

    if (isDevReset) {
      const origin = req.headers.get('origin') || 'http://localhost:3000'
      const resetLink = `${origin}/reset-password?token=${token}`
      // TODO: When email service is set up (Resend/SendGrid), replace this with:
      // await sendEmail({ to: emailLower, subject: 'Reset your password', body: resetLink })
      return NextResponse.json({
        success: true,
        message: 'If the email exists, a reset link has been sent.',
        // DEV MODE ONLY: return the link so you can test without email
        // This is gated by ALLOW_DEV_RESET=true env var AND non-production NODE_ENV
        resetLink,
        devNote: 'Reset link shown because ALLOW_DEV_RESET=true. Set up email service and remove this for production.',
      })
    }

    // Production: return generic message (no resetLink in response)
    // TODO: Wire up email service (Resend/SendGrid) to send the link:
    // const origin = req.headers.get('origin') || 'https://bahikhata-pro.vercel.app'
    // const resetLink = `${origin}/reset-password?token=${token}`
    // await sendEmail({ to: emailLower, subject: 'Reset your EkBook password', body: `Click here: ${resetLink}` })

    return genericResponse
  } catch (error) {
    console.error('[reset-request] Error:', error)
    return NextResponse.json({ error: 'Failed to process request' }, { status: 500 })
  }
}
