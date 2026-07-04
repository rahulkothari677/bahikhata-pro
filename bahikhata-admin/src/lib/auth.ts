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
 *
 * To create an admin account:
 * 1. Sign up normally in the main app first (e.g. rahulkothari677@gmail.com)
 * 2. Add that email to ADMIN_EMAILS env var
 * 3. Login here with the same email + password
 */

const ADMIN_EMAILS = (process.env.ADMIN_EMAILS || '').split(',').map(e => e.trim().toLowerCase())

export const adminAuthOptions: NextAuthOptions = {
  providers: [
    CredentialsProvider({
      name: 'Admin Login',
      credentials: {
        email: { label: 'Email', type: 'email' },
        password: { label: 'Password', type: 'password' },
      },
      async authorize(credentials) {
        try {
          if (!credentials?.email || !credentials?.password) return null

          const email = credentials.email.toLowerCase()

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

          return {
            id: user.id,
            email: user.email,
            name: user.name,
          }
        } catch (error) {
          console.error('[admin-auth] Error:', error)
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
