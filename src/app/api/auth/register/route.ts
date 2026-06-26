import { NextRequest, NextResponse } from 'next/server'
import bcrypt from 'bcryptjs'
import { db } from '@/lib/db'
import { rateLimit, getClientIP, rateLimitedResponse } from '@/lib/rate-limit'

// POST /api/auth/register - create new user account
// Rate limited: 5 signups per IP per hour (prevents abuse)
export async function POST(req: NextRequest) {
  try {
    // Rate limit check
    const ip = getClientIP(req)
    const rl = rateLimit(`signup:${ip}`, { limit: 5, windowSec: 3600 })
    if (!rl.success) return rateLimitedResponse(rl)

    const { email, password, name } = await req.json()

    if (!email || !password) {
      return NextResponse.json({ error: 'Email and password are required' }, { status: 400 })
    }

    if (password.length < 6) {
      return NextResponse.json({ error: 'Password must be at least 6 characters' }, { status: 400 })
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
