import { NextAuthOptions } from 'next-auth'
import CredentialsProvider from 'next-auth/providers/credentials'
import bcrypt from 'bcryptjs'
import { db } from '@/lib/db'
import { rateLimit } from '@/lib/rate-limit'

export const authOptions: NextAuthOptions = {
  providers: [
    CredentialsProvider({
      name: 'Email & Password',
      credentials: {
        email: { label: 'Email', type: 'email', placeholder: 'you@example.com' },
        password: { label: 'Password', type: 'password' },
      },
      async authorize(credentials, req) {
        try {
          if (!credentials?.email || !credentials?.password) {
            return null
          }

          // Rate limit: 10 login attempts per IP per minute (prevents brute force)
          const forwarded = (req as any)?.headers?.['x-forwarded-for']
          const ip = (typeof forwarded === 'string' ? forwarded.split(',')[0].trim() : null)
            || (req as any)?.headers?.['x-real-ip']
            || 'unknown'
          const rl = rateLimit(`login:${ip}`, { limit: 10, windowSec: 60 })
          if (!rl.success) {
            throw new Error('Too many login attempts. Please wait a minute and try again.')
          }

          const user = await db.user.findUnique({
            where: { email: credentials.email.toLowerCase() },
          })

          if (!user) {
            return null
          }

          const isValid = await bcrypt.compare(credentials.password, user.password)

          if (!isValid) {
            return null
          }

          return {
            id: user.id,
            email: user.email,
            name: user.name,
            role: user.role || 'owner',
            ownerId: user.ownerId,
            permissions: user.permissions,
          }
        } catch (error) {
          console.error('Auth error:', error)
          // Re-throw rate limit errors so they propagate to the client as an error
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
    maxAge: 30 * 24 * 60 * 60, // 30 days
  },
  pages: {
    signIn: '/login',
  },
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token.id = user.id
        token.role = (user as any).role
        token.ownerId = (user as any).ownerId
        token.permissions = (user as any).permissions
      }
      return token
    },
    async session({ session, token }) {
      if (session.user) {
        session.user.id = token.id as string
        session.user.role = (token.role as string) || 'owner'
        session.user.ownerId = token.ownerId as string | null
        ;(session.user as any).permissions = token.permissions
      }
      return session
    },
  },
  // 🔒 SECURITY: Never fall back to a hardcoded secret. If NEXTAUTH_SECRET is
  // missing in production, the app must fail to start rather than silently
  // signing JWTs with a public, source-controlled secret that anyone can forge.
  // (Audit fix Phase 1.1 — was: `|| 'ekbook-dev-secret-change-in-production'`)
  //
  // Note: we check this at runtime (when the server handles a request), not
  // at module-load time, because `next build` runs this file in production
  // mode during page-data collection and would fail the build. The runtime
  // check still protects every real request — if the secret is missing, the
  // first auth call will throw and surface a clear error.
  secret: process.env.NEXTAUTH_SECRET,
}

// Runtime guard: if a request comes in and NEXTAUTH_SECRET is missing in
// production, throw immediately. This runs when the auth config is first
// used (not at import time), so it doesn't break `next build`.
if (process.env.NODE_ENV === 'production' && !process.env.NEXTAUTH_SECRET) {
  console.error('🚨 FATAL: NEXTAUTH_SECRET environment variable is not set. The app will not authenticate any requests. Set it in your Vercel environment variables immediately.')
}
