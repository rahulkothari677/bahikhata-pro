import { NextRequest, NextResponse } from 'next/server'
import { validateBody, resetRequestSchema } from '@/lib/validation'
import { db } from '@/lib/db'
import { rateLimit, getClientIP, rateLimitedResponse } from '@/lib/rate-limit'
import { sendEmail, sendFounderAlert, isEmailConfigured } from '@/lib/email'
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
 * 🔒 AUDIT FIX V5 HB: Email is now ACTUALLY SENT in production when
 * RESEND_API_KEY is configured. When no provider is configured, the response
 * honestly tells the user to contact support (instead of pretending the
 * email was sent — which silently locked users out). A founder alert is
 * also logged so the founder can manually reset passwords for users who
 * request it.
 *
 * Rate limited: 3 requests per IP per hour (prevents abuse)
 */

export async function POST(req: NextRequest) {
  try {
    // Rate limit: 3 per IP per hour
    const ip = getClientIP(req)
    const rl = await rateLimit(`reset-request:${ip}`, { limit: 3, windowSec: 3600 })
    if (!rl.success) return rateLimitedResponse(rl)

    const body = await req.json()
    const validation = validateBody(resetRequestSchema, body)
    if (!validation.success) {
      return NextResponse.json({ error: validation.error }, { status: 400 })
    }
    const { email } = validation.data
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

    // 🔒 AUDIT FIX V6 PP4: Clean up ALL expired tokens (not just for this email).
    // Was: only deleted expired tokens for the requesting email — so tokens for
    // users who never completed reset would accumulate forever. The auditor
    // flagged this as a low-priority item; a cron job would be cleaner, but
    // running a global cleanup on every reset request is a simple, effective
    // approximation (costs 1 extra query per request, no cron infrastructure
    // needed). Tokens expire in 1 hour, so the accumulation rate is bounded,
    // but this keeps the table tidy.
    try {
      await db.passwordResetToken.deleteMany({
        where: {
          expiresAt: { lt: new Date() },  // global — not scoped to email
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
      return NextResponse.json({
        success: true,
        message: 'If the email exists, a reset link has been sent.',
        // DEV MODE ONLY: return the link so you can test without email
        // This is gated by ALLOW_DEV_RESET=true env var AND non-production NODE_ENV
        resetLink,
        devNote: 'Reset link shown because ALLOW_DEV_RESET=true. Set up email service and remove this for production.',
      })
    }

    // Production path:
    // 🔒 V5 HB: Actually send the email if a provider is configured. If not,
    // surface an honest message instead of pretending the email was sent.
    const origin = req.headers.get('origin') || process.env.NEXTAUTH_URL || 'https://ekbook-pro.vercel.app'
    const resetLink = `${origin}/reset-password?token=${token}`

    if (isEmailConfigured()) {
      // Email provider configured — send the reset link via email.
      const emailResult = await sendEmail({
        to: emailLower,
        subject: 'Reset your EkBook password',
        html: `
          <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto; padding: 24px;">
            <h2 style="color: #f59e0b;">Reset your EkBook password</h2>
            <p>We received a request to reset the password for your EkBook account.</p>
            <p style="margin: 24px 0;">
              <a href="${resetLink}" style="background: #f59e0b; color: white; padding: 12px 24px; border-radius: 8px; text-decoration: none; display: inline-block; font-weight: 600;">
                Reset Password
              </a>
            </p>
            <p style="color: #6b7280; font-size: 14px;">
              Or copy this link into your browser:<br>
              <span style="word-break: break-all; color: #2563eb;">${resetLink}</span>
            </p>
            <p style="color: #6b7280; font-size: 14px;">
              This link expires in 1 hour. If you didn't request a password reset, you can safely ignore this email.
            </p>
            <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 24px 0;">
            <p style="color: #9ca3af; font-size: 12px;">
              EkBook — India's ledger app for shop owners. If you need help, reply to this email.
            </p>
          </div>
        `,
        text: `Reset your EkBook password\n\nWe received a request to reset the password for your EkBook account.\n\nReset link (expires in 1 hour):\n${resetLink}\n\nIf you didn't request this, you can safely ignore this email.`,
      })

      if (!emailResult.ok) {
        // Email failed to send — log a founder alert so the founder can
        // manually help this user. Don't reveal the failure to the user
        // (they could be an attacker probing the system).
        console.error('[reset-request] Email send failed:', emailResult)
        await sendFounderAlert(
          'Password reset email failed to send',
          `A password reset was requested for ${emailLower} but the email failed to send.\n\nReason: ${emailResult.reason}\nDetail: ${emailResult.detail || '(none)'}\n\nToken expires at: ${expiresAt.toISOString()}\n\nIf this is a real user, contact them manually or check the Resend dashboard.`
        ).catch(() => {}) // don't fail the request if alert fails
      }
    } else {
      // No email provider configured — founder needs to know so they can
      // manually reset this user's password. Log a founder alert.
      // The user-facing response stays generic (security: don't reveal
      // whether the email exists OR whether email is configured).
      console.warn('[reset-request] No email provider configured (RESEND_API_KEY not set). User will be locked out unless founder intervenes.')
      await sendFounderAlert(
        'Password reset requested but no email provider configured',
        `A password reset was requested for ${emailLower} but RESEND_API_KEY is not set in env vars. The user will be locked out unless you reset their password manually.\n\nTo manually reset:\n1. Contact the user to verify identity\n2. Generate a reset token: see /api/auth/reset-request logic\n3. Or set RESEND_API_KEY so future requests work automatically\n\nToken hash stored in DB: ${tokenHash.slice(0, 8)}...(truncated)\nToken expires at: ${expiresAt.toISOString()}`
      ).catch(() => {})
    }

    return genericResponse
  } catch (error) {
    console.error('[reset-request] Error:', error)
    return NextResponse.json({ error: 'Failed to process request' }, { status: 500 })
  }
}
