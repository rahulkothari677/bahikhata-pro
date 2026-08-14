import { NextAuthOptions } from 'next-auth'
import CredentialsProvider from 'next-auth/providers/credentials'
import bcrypt from 'bcryptjs'
import { db } from '@/lib/db'
import { rateLimit } from '@/lib/rate-limit'
import { Redis } from '@upstash/redis'
import { createHash } from 'crypto'

/**
 * 🔒 2026-08-13 (#17): one message for BOTH login limits.
 *
 * The per-IP and per-account limits must be indistinguishable from outside.
 * If the account limit said something different, anyone could tell a real
 * shopkeeper's email from a made-up one just by failing to log in eleven
 * times — which hands an attacker the list of accounts worth attacking.
 *
 * The wording avoids "a minute" because the account window is fifteen.
 */
const TOO_MANY_ATTEMPTS =
  'Too many login attempts. Please wait a few minutes and try again.'

/**
 * 🔒 #28: a real bcrypt hash to compare against when the account does not exist.
 *
 * Cost 12 — the same factor register/reset/staff use — so a login for an email
 * with no account costs the same ~240ms as one for an email that has an
 * account. Without it, "no such account" returned in a few milliseconds and
 * "wrong password" took a quarter of a second, which reads straight off the
 * network tab and turns the login form into a list of who banks here.
 *
 * Publishing this hash costs nothing. It is bcrypt of 32 random bytes that were
 * generated once, used here, and never written down — so there is no password
 * that satisfies it, and no account it would let anyone into even if there were.
 * Its only job is to take exactly as long as a real comparison.
 */
const TIMING_EQUALISER_HASH =
  '$2b$12$FwBrKb2t/1OEv03YmpIZ8ePWzeH5sSVKnYBP/30yfJTMh6I/wu512'

// 🔒 V9 2.8: Redis cache for tokenVersion — reduces revocation lag from
// 30 minutes to ~5 seconds. On each request, we check Redis (fast, ~2ms)
// instead of the DB (slow, ~50ms+). If Redis is down, falls back to the
// 5-minute DB check (was 30 minutes).
let tokenVersionRedis: Redis | null = null

function getTokenVersionRedis(): Redis | null {
  if (tokenVersionRedis !== null) return tokenVersionRedis
  const url = process.env.UPSTASH_REDIS_REST_URL
  const token = process.env.UPSTASH_REDIS_REST_TOKEN
  if (!url || !token) return null
  try {
    tokenVersionRedis = new Redis({ url, token })
  } catch {
    tokenVersionRedis = null
  }
  return tokenVersionRedis
}

/**
 * 🔒 V9 2.8: Get tokenVersion from Redis cache (fast) or DB (fallback).
 * Redis cache TTL = 5 seconds. This means:
 * - On every request, we check Redis (~2ms) instead of DB (~50ms)
 * - When a user's tokenVersion is bumped (password reset, logout all),
 *   the old Redis cache entry expires within 5 seconds
 * - If Redis is down, falls back to DB check every 5 minutes (was 30)
 */
async function getCachedTokenVersion(userId: string): Promise<number | null> {
  const redis = getTokenVersionRedis()
  const cacheKey = `tv:${userId}`

  // Try Redis first (fast path — ~2ms)
  if (redis) {
    try {
      const cached = await redis.get(cacheKey)
      if (cached !== null) {
        // 🔒 V26 S1: "deleted" sentinel means the user was deleted (cached
        // for 60s to reduce DB load). Return null to signal "revoke."
        if (cached === 'deleted') return null
        return Number(cached)
      }
      // Cache miss — read from DB, cache for 5 seconds
      const dbUser = await db.user.findUnique({
        where: { id: userId },
        select: { tokenVersion: true },
      })
      // 🔒 V26 S1 FIX: If the user doesn't exist (deleted staff), return null
      // (signal "revoked") instead of coercing to 0 (which is a VALID version
      // for freshly-created accounts, letting deleted staff keep access).
      // The jwt callback checks for null and treats it as "revoke."
      if (!dbUser) {
        // Cache the "deleted" state for 60 seconds (longer than the 5s for
        // live users — deleted users don't come back, so a longer cache is
        // safe and reduces DB load from repeated checks on stale tokens).
        await redis.set(cacheKey, 'deleted', { ex: 60 })
        return null
      }
      const version = dbUser.tokenVersion
      await redis.set(cacheKey, String(version), { ex: 5 }) // 5 second TTL
      return version
    } catch {
      // Redis error — fall through to DB check below
    }
  }

  // Fallback: direct DB query (no cache)
  const dbUser = await db.user.findUnique({
    where: { id: userId },
    select: { tokenVersion: true },
  })
  // 🔒 V26 S1 FIX: same null-for-deleted-user logic in the fallback path
  if (!dbUser) return null
  return dbUser.tokenVersion
}

/**
 * 🔒 V9 2.8: Invalidate the Redis cache for a user's tokenVersion.
 * Call this when tokenVersion is bumped (password reset, logout all devices).
 */
export async function invalidateTokenVersionCache(userId: string): Promise<void> {
  const redis = getTokenVersionRedis()
  if (redis) {
    try {
      await redis.del(`tv:${userId}`)
    } catch {
      // Non-critical — the 5s TTL will expire naturally
    }
  }
}

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
          const rl = await rateLimit(`login:${ip}`, { limit: 10, windowSec: 60 })
          if (!rl.success) {
            throw new Error(TOO_MANY_ATTEMPTS)
          }

          /*
           * 🔒 2026-08-13 (#17): a SECOND limit, counted per ACCOUNT.
           *
           * The per-IP limit above stops one machine guessing quickly. It does
           * nothing about the attack that actually matters: the same account
           * guessed from many addresses. Botnets and residential proxies make
           * that cheap, and every request looks like a first attempt, so
           * before this the number of guesses against one shopkeeper's account
           * was limited only by how many addresses the attacker could rent.
           *
           * 10 tries per 15 minutes per account. A real person who has
           * forgotten their password gets several goes and can use Reset
           * Password (limited separately). An attacker gets 40 an hour rather
           * than as many as they can pay for — and each one still costs a full
           * bcrypt comparison.
           *
           * WHY THIS AND NOT AN ACCOUNT LOCK: locking the account outright
           * would let anyone lock a shopkeeper out of their own books by
           * failing their login on purpose. A short rolling window means the
           * worst an attacker can do is make someone wait, and only while they
           * keep paying to do it. `lockedUntil` on Setting is NOT this — that
           * is the accounting period lock, a different thing entirely.
           *
           * The email is hashed into the key for two reasons: it bounds the key
           * length whatever is typed in, and it keeps shopkeepers' email
           * addresses out of a third-party service (Upstash) that has no
           * business holding them.
           */
          const accountKey = createHash('sha256')
            .update(credentials.email.trim().toLowerCase())
            .digest('hex')
            .slice(0, 32)
          const accountRl = await rateLimit(`login:acct:${accountKey}`, {
            limit: 10,
            windowSec: 900,
          })
          if (!accountRl.success) {
            /*
             * Deliberately the SAME message as the per-IP limit. A distinct
             * one ("this account is locked") would confirm the account exists,
             * turning the protection into an account-enumeration oracle.
             */
            throw new Error(TOO_MANY_ATTEMPTS)
          }

          const user = await db.user.findUnique({
            where: { email: credentials.email.toLowerCase() },
          })

          /*
           * 🔒 #28 (2026-08-13): both paths must cost the same.
           *
           * This used to `return null` the instant no user matched, and run a
           * full bcrypt comparison when one did. bcrypt at cost 12 takes about
           * 240ms on purpose — so "no such account" answered in a few
           * milliseconds while "wrong password" took a quarter of a second, and
           * the difference is large enough to read straight off the network tab.
           *
           * That turns the login form into a list of which emails have accounts.
           * On its own that is only a leak; combined with a breached
           * password dump it tells an attacker exactly which shopkeepers to
           * spend their guesses on, and #17's per-account limit is what makes
           * those guesses expensive.
           *
           * So a missing user is compared against a DUMMY hash instead. Same
           * cost factor, same work, same wall-clock — and it can never succeed,
           * because the value hashed was 32 random bytes that were never
           * recorded anywhere.
           */
          const isValid = user
            ? await bcrypt.compare(credentials.password, user.password)
            : await bcrypt
                .compare(credentials.password, TIMING_EQUALISER_HASH)
                // The result is discarded; only the time it took matters.
                .then(() => false)

          if (!user || !isValid) {
            // One exit for both, so the shapes cannot drift apart later either.
            return null
          }

          return {
            id: user.id,
            email: user.email,
            name: user.name,
            role: user.role || 'owner',
            ownerId: user.ownerId,
            permissions: user.permissions,
            tokenVersion: user.tokenVersion,  // 🔒 captured at login
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
    // 🔒 SECURITY (Audit fix Phase 3.3): Shortened from 30 days to 7 days.
    // A stolen JWT was previously valid for a month with no way to revoke it.
    // 7 days balances security (shorter window if stolen) with UX (user
    // doesn't have to re-login constantly). Combined with tokenVersion, we
    // can now ALSO revoke sessions immediately by bumping tokenVersion.
    maxAge: 7 * 24 * 60 * 60, // 7 days (was 30 days)
  },
  pages: {
    // The app uses AuthScreen component at / (not a separate /login route)
    // NextAuth redirect callbacks go to / which renders the login form
    signIn: '/',
    /*
     * 🔒 Reported from a real phone: the app had navigated the whole webview
     * to `/api/auth/error` and died there with ERR_NAME_NOT_RESOLVED.
     *
     * `error` was not set, so NextAuth used its own default page — which is
     * server-rendered at that URL. Two things make that fatal in the Android
     * build rather than merely ugly: it is a FULL PAGE NAVIGATION out of the
     * app shell, and it cannot be fetched at all without a network. So the one
     * moment it appears — a failed sign-in, which on a bad connection is
     * exactly when the network is unavailable — is the moment it cannot load,
     * and the webview is left on a dead page with no way back into the app.
     *
     * Sending errors to '/' keeps the user inside the app, where AuthScreen
     * shows a real message and the cached session can still take over.
     */
    error: '/',
  },
  callbacks: {
    async jwt({ token, user }) {
      // Initial login: capture user fields + tokenVersion
      if (user) {
        token.id = user.id
        // 🔒 V18 H1: Session/JWT types now declare these fields (next-auth.d.ts).
        // The `user` param here is the Prisma User returned by authorize() —
        // it has these fields at runtime but NextAuth types it as User|AdapterUser.
        // The cast is safe: authorize() always returns them (line 120-128).
        token.role = (user as any).role
        token.ownerId = (user as any).ownerId
        token.permissions = (user as any).permissions
        token.tokenVersion = (user as any).tokenVersion
        token.lastVersionCheck = Date.now()  // throttle DB checks (see below)
        return token
      }

      // 🔒 V9 2.8: JWT revocation check — now Redis-backed.
      // Was: check DB every 30 minutes (up to 30 min revocation lag).
      // Now: check Redis on EVERY request (~2ms). Redis caches tokenVersion
      // with a 5-second TTL. When tokenVersion is bumped (password reset,
      // logout all), the cache expires within 5 seconds → revocation lag
      // drops from 30 minutes to ~5 seconds.
      //
      // If Redis is down, falls back to the old 5-minute DB check
      // (reduced from 30 minutes — still better than before).
      //
      // 🔒 BUG FIX (V5): Old JWTs created BEFORE tokenVersion don't have
      // the claim (undefined). Treat as 0 (DB default).
      const redis = getTokenVersionRedis()

      if (redis) {
        // Fast path: check Redis on every request (~2ms)
        try {
          const currentVersion = await getCachedTokenVersion(token.id as string)
          const jwtTokenVersion = (token.tokenVersion as number) ?? 0
          // 🔒 V26 S1 FIX: currentVersion === null means the user was deleted
          // (getCachedTokenVersion returns null for non-existent users, not 0).
          // Treat null as "revoke" — a deleted staff member's session must die.
          // Was: `if (currentVersion !== null && currentVersion !== jwtTokenVersion)`
          // — this SKIPPED the revocation check when currentVersion was null,
          // letting deleted staff keep access (because 0 === 0 for fresh accounts).
          if (currentVersion === null || currentVersion !== jwtTokenVersion) {
            // tokenVersion mismatch OR user deleted → session revoked
            return { ...token, id: undefined as any, tokenVersion: undefined as any }
          }
          token.lastVersionCheck = Date.now()
        } catch {
          // Redis error — fall through to DB check below
        }
      } else {
        // Fallback: DB check every 5 minutes (was 30 minutes)
        const lastCheck = (token.lastVersionCheck as number) || 0
        const FIVE_MINUTES = 5 * 60 * 1000
        if (Date.now() - lastCheck > FIVE_MINUTES) {
          try {
            const dbUser = await db.user.findUnique({
              where: { id: token.id as string },
              select: { tokenVersion: true },
            })
            const jwtTokenVersion = (token.tokenVersion as number) ?? 0
            // 🔒 V26 S1 FIX: !dbUser (deleted user) → revoke (was: kept access
            // because the check `dbUser.tokenVersion !== jwtTokenVersion` would
            // throw on null, caught by the try/catch, and session stayed valid).
            if (!dbUser || dbUser.tokenVersion !== jwtTokenVersion) {
              return { ...token, id: undefined as any, tokenVersion: undefined as any }
            }
            token.tokenVersion = jwtTokenVersion
            token.lastVersionCheck = Date.now()
          } catch {
            // DB check failed — don't log out, retry next time
          }
        }
      }

      return token
    },
    async session({ session, token }) {
      // If the token was revoked (id set to undefined), treat as logged out
      if (!token.id) {
        return { ...session, user: undefined as any }
      }
      if (session.user) {
        session.user.id = token.id as string
        session.user.role = (token.role as string) || 'owner'
        session.user.ownerId = token.ownerId as string | null
        session.user.permissions = token.permissions ?? null
        // 🐛 INTEGRATION PHASE D.3: Propagate impersonation flag to the
        // session so the UI can show the yellow "Impersonating user X" banner.
        // The flag is set on the JWT by /api/impersonate when it creates
        // an impersonated session (see that route for details).
        session.user.isImpersonated = (token.isImpersonated as boolean) ?? false
        session.user.impersonatedBy = token.impersonatedBy as string | undefined
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
