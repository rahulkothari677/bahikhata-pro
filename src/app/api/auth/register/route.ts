import { NextRequest, NextResponse } from 'next/server'
import { validateBody, registerSchema } from '@/lib/validation'
import bcrypt from 'bcryptjs'
import { db } from '@/lib/db'
import { rateLimit, getClientIP, rateLimitedResponse } from '@/lib/rate-limit'
import { isFeatureEnabled } from '@/lib/feature-flags'

// POST /api/auth/register - create new user account
// Rate limited: 5 signups per IP per hour (prevents abuse)
export async function POST(req: NextRequest) {
  try {
    // 🐛 FIX (audit 2026-07-28): the `new_signups` kill switch was not enforced
    // ANYWHERE on the server. Flags were fetched by the browser from the public
    // /api/feature-flags endpoint and used only to show or hide UI, so turning
    // "New Signups" off in the admin panel hid the button while this endpoint
    // kept creating accounts for anyone who posted to it directly.
    //
    // That is the failure mode a kill switch exists to prevent: the founder
    // flips it during an abuse wave or a capacity problem, sees the button
    // disappear, and believes signups have stopped.
    if (!(await isFeatureEnabled('new_signups'))) {
      return NextResponse.json(
        {
          error: 'Signups are temporarily paused',
          message: 'New account creation is paused right now. Please try again later.',
        },
        { status: 503 },
      )
    }

    // Rate limit check
    const ip = getClientIP(req)
    const rl = await rateLimit(`signup:${ip}`, { limit: 5, windowSec: 3600 })
    if (!rl.success) return rateLimitedResponse(rl)

    const body = await req.json()
    const validation = validateBody(registerSchema, body)
    if (!validation.success) {
      return NextResponse.json({ error: validation.error }, { status: 400 })
    }
    const { email, password, name } = validation.data

    if (!email || !password) {
      return NextResponse.json({ error: 'Email and password are required' }, { status: 400 })
    }

    // 🔒 SECURITY (Audit fix Phase 1.7): Raised minimum from 6 → 8 characters.
    // 6 chars is below NIST SP 800-63B and OWASP recommendations for apps
    // holding financial data. 8 is the new minimum; ideally add breach-check
    // via HaveIBeenPwned k-anonymity API in a future phase.
    if (password.length < 8) {
      return NextResponse.json({ error: 'Password must be at least 8 characters' }, { status: 400 })
    }

    const emailLower = email.toLowerCase()

    // Check if user already exists
    const existing = await db.user.findUnique({ where: { email: emailLower } })
    if (existing) {
      return NextResponse.json({ error: 'An account with this email already exists' }, { status: 409 })
    }

    // Hash password
    const hashedPassword = await bcrypt.hash(password, 12)

    // Create user
    const user = await db.user.create({
      data: {
        email: emailLower,
        password: hashedPassword,
        name: name || null,
      },
    })

    // Create default settings for the user
    await db.setting.create({
      data: {
        userId: user.id,
        shopName: name ? `${name}'s Shop` : 'My Shop',
        ownerName: name || null,
      },
    })

    return NextResponse.json({
      success: true,
      user: { id: user.id, email: user.email, name: user.name },
    })
  } catch (error) {
    console.error('Register error:', error)
    return NextResponse.json({ error: 'Failed to create account' }, { status: 500 })
  }
}
