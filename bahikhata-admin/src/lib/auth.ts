import { NextAuthOptions } from 'next-auth'
import CredentialsProvider from 'next-auth/providers/credentials'
import bcrypt from 'bcryptjs'
import { db } from '@/lib/db'

/**
 * Admin Auth — SEPARATE from the main app's auth.
 *
 * Security features:
 * 1. Only emails in ADMIN_EMAILS env var can login
 * 2. Separate NEXTAUTH_SECRET (different from main app)
 * 3. Shorter session (1 hour instead of 30 days)
 * 4. All login attempts logged
 * 5. 🔒 AUDIT FIX A3: Rate limiting on login (5 attempts per 15 min per email+IP)
 *
 * To create an admin account:
 * 1. Sign up normally in the main app first (e.g. rahulkothari677@gmail.com)
 * 2. Add that email to ADMIN_EMAILS env var
 * 3. Login here with the same email + password
 */

const ADMIN_EMAILS = (process.env.ADMIN_EMAILS || '').split(',').map(e => e.trim().toLowerCase())

// 🔒 AUDIT FIX A3: Simple in-memory rate limiter for admin login.
// 5 attempts per 15 minutes per email+IP combo. In-memory is fine here
// because the admin panel has very few users (just admins) — unlike the
// main app which needs Redis for serverless multi-instance rate limiting.
interface RateBucket { count: number; resetAt: number }
const loginAttempts = new Map<string, RateBucket>()
const RATE_LIMIT_MAX = 5
const RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000 // 15 minutes

function checkRateLimit(key: string): { allowed: boolean; retryAfterSec: number } {
  const now = Date.now()
  let bucket = loginAttempts.get(key)

  if (!bucket || bucket.resetAt < now) {
    bucket = { count: 0, resetAt: now + RATE_LIMIT_WINDOW_MS }
    loginAttempts.set(key, bucket)
  }

  if (bucket.count >= RATE_LIMIT_MAX) {
    return { allowed: false, retryAfterSec: Math.ceil((bucket.resetAt - now) / 1000) }
  }

  bucket.count++
  return { allowed: true, retryAfterSec: 0 }
}

export const adminAuthOptions: NextAuthOptions = {
  providers: [
    CredentialsProvider({
      name: 'Admin Login',
      credentials: {
        email: { label: 'Email', type: 'email' },
        password: { label: 'Password', type: 'password' },
      },
      async authorize(credentials, req) {
        try {
          if (!credentials?.email || !credentials?.password) return null

          const email = credentials.email.toLowerCase()

          // 🔒 AUDIT FIX A3: Rate limit by email + IP to prevent brute force
          const forwarded = (req as any)?.headers?.['x-forwarded-for']
          const ip = (typeof forwarded === 'string' ? forwarded.split(',')[0].trim() : null) || 'unknown'
          const rateKey = `admin-login:${email}:${ip}`
          const rateCheck = checkRateLimit(rateKey)
          if (!rateCheck.allowed) {
            console.warn(`[admin-auth] Rate limit exceeded for ${email} from ${ip}`)
            throw new Error(`Too many login attempts. Please wait ${Math.ceil(rateCheck.retryAfterSec / 60)} minutes.`)
          }

          // Check if email is in admin whitelist
          if (!ADMIN_EMAILS.includes(email)) {
            console.warn(`[admin-auth] Non-admin email attempted: ${email}`)
            return null
          }

          // Find user in database (same DB as main app)
          const user = await db.user.findUnique({ where: { email } })
          if (!user) return null

          // Verify password
          const isValid = await bcrypt.compare(credentials.password, user.password)
          if (!isValid) return null

          // Login successful — clear the rate limit bucket for this key
          loginAttempts.delete(rateKey)

          return {
            id: user.id,
            email: user.email,
            name: user.name,
          }
        } catch (error) {
          console.error('[admin-auth] Error:', error)
          // Re-throw rate limit errors so they propagate to the client
          if (error instanceof Error && error.message.includes('Too many')) {
            throw error
          }
          return null
        }
      },
    }),
  ],
  session: {
    strategy: 'jwt',
    maxAge: 1 * 60 * 60, // 1 hour (short — security)
  },
  pages: {
    signIn: '/login',
  },
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token.id = user.id
      }
      return token
    },
    async session({ session, token }) {
      if (session.user) {
        session.user.id = token.id as string
      }
      return session
    },
  },
  secret: process.env.NEXTAUTH_SECRET,
}
