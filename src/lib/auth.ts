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
  secret: process.env.NEXTAUTH_SECRET || 'bahikhata-pro-dev-secret-change-in-production',
}
