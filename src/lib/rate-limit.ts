/**
 * Redis-backed rate limiter (Upstash).
 *
 * Phase 2.2 audit fix: replaced the in-memory Map with Upstash Redis so rate
 * limits are shared across all serverless instances. The old in-memory limiter
 * didn't work on Vercel — each instance had its own Map, so "10 scans/hour"
 * was really "10 per instance × N instances".
 *
 * Graceful fallback: if UPSTASH_REDIS_REST_URL/TOKEN are not set (e.g. in
 * local dev without Redis), falls back to the old in-memory Map so the app
 * still works. This also acts as a safety net if Upstash is temporarily down.
 *
 * Usage (note: now async — callers must `await`):
 *   import { rateLimit } from '@/lib/rate-limit'
 *   const { success, resetAt } = await rateLimit(key, { limit: 5, windowSec: 60 })
 *   if (!success) return 429 response
 *
 * Strategies:
 *   - 'fixed' (default): simple fixed window — N requests per window
 *   - 'token': token bucket — bursty traffic allowed up to capacity
 *             (in-memory only; Upstash uses equivalent sliding window)
 */

import { Ratelimit } from '@upstash/ratelimit'
import { Redis } from '@upstash/redis'

// --- Upstash Redis client (singleton) ------------------------------------

let redisClient: Redis | null = null

function getRedis(): Redis | null {
  if (redisClient !== null) return redisClient
  const url = process.env.UPSTASH_REDIS_REST_URL
  const token = process.env.UPSTASH_REDIS_REST_TOKEN
  if (!url || !token) return null
  try {
    redisClient = new Redis({ url, token })
  } catch {
    redisClient = null
  }
  return redisClient
}

/**
 * Cache of rate limiters, keyed by `${limit}:${windowSec}`.
 * Each unique (limit, window) combo gets its own Ratelimit instance because
 * Upstash's slidingWindow takes the limit+window at construction time.
 */
const limiterCache = new Map<string, Ratelimit>()

function getRatelimiter(limit: number, windowSec: number): Ratelimit | null {
  const redis = getRedis()
  if (!redis) return null

  const cacheKey = `${limit}:${windowSec}`
  let limiter = limiterCache.get(cacheKey)
  if (limiter) return limiter

  // Convert windowSec to a Duration string Upstash understands.
  // Format: "<number> s" for seconds, "<number> m" for minutes, etc.
  const duration = `${windowSec} s`

  limiter = new Ratelimit({
    redis,
    limiter: Ratelimit.slidingWindow(limit, duration as any),
    prefix: 'ratelimit:',
    analytics: false,
  })
  limiterCache.set(cacheKey, limiter)
  return limiter
}

// --- In-memory fallback (for dev / when Redis is down) -------------------

interface Bucket {
  count: number
  resetAt: number
  tokens: number
  lastRefill: number
}

const buckets = new Map<string, Bucket>()

const PURGE_INTERVAL = 5 * 60 * 1000
let lastPurge = Date.now()

function purge() {
  const now = Date.now()
  if (now - lastPurge < PURGE_INTERVAL) return
  lastPurge = now
  for (const [key, bucket] of buckets) {
    if (bucket.resetAt < now) buckets.delete(key)
  }
}

// --- Public types --------------------------------------------------------

interface RateLimitResult {
  success: boolean
  resetAt: number
  remaining: number
  retryAfterSec: number
}

interface FixedWindowOpts {
  limit: number
  windowSec: number
}

interface TokenBucketOpts {
  capacity: number
  refillPerSec: number
}

// --- Main rate-limit function (async — Redis-backed) ---------------------

export async function rateLimit(
  key: string,
  opts: FixedWindowOpts | TokenBucketOpts,
  options?: { failClosed?: boolean },
): Promise<RateLimitResult> {
  // 🔒 AUDIT FIX H9: When failClosed=true and Redis is configured but down,
  // DENY the request instead of falling back to in-memory. This prevents
  // cost-bearing limits (AI scans) from being bypassed during a Redis outage.
  // When failClosed=false (default), falls back to in-memory (for login,
  // signup, reset — where availability matters more than exactness).
  const failClosed = options?.failClosed ?? false

  // Convert token-bucket opts to equivalent fixed-window for both Redis
  // and in-memory paths (keeps behavior consistent)
  let limit: number
  let windowSec: number
  if ('capacity' in opts) {
    limit = opts.capacity
    windowSec = Math.max(1, Math.ceil(opts.capacity / opts.refillPerSec))
  } else {
    limit = opts.limit
    windowSec = opts.windowSec
  }

  const limiter = getRatelimiter(limit, windowSec)
  const isRedisConfigured = !!getRedis()

  // --- Redis-backed path (production) ---
  if (limiter) {
    try {
      const result = await limiter.limit(key)
      const now = Date.now()
      return {
        success: result.success,
        resetAt: result.reset || (now + windowSec * 1000),
        remaining: result.remaining,
        retryAfterSec: result.success ? 0 : Math.ceil(((result.reset || (now + windowSec * 1000)) - now) / 1000),
      }
    } catch (err) {
      console.warn('[rate-limit] Upstash error:', err)

      // 🔒 H9: For cost-bearing limits (AI scans/voice), fail CLOSED when
      // Redis is down. Deny the request to prevent unlimited AI spend.
      if (failClosed && isRedisConfigured) {
        console.error('[rate-limit] FAIL CLOSED — Redis is configured but unreachable. Denying request to protect AI budget.')
        return {
          success: false,
          resetAt: Date.now() + windowSec * 1000,
          remaining: 0,
          retryAfterSec: windowSec,
        }
      }

      // For non-cost-bearing limits, fall back to in-memory (better UX)
    }
  }

  // --- In-memory fallback (dev or Redis down + not failClosed) ---
  return inMemoryRateLimit(key, { limit, windowSec })
}

// --- In-memory implementation (fallback) ---------------------------------

function inMemoryRateLimit(
  key: string,
  opts: FixedWindowOpts,
): RateLimitResult {
  purge()
  const now = Date.now()

  const { limit, windowSec } = opts
  const windowMs = windowSec * 1000
  let bucket = buckets.get(key)

  if (!bucket || bucket.resetAt < now) {
    bucket = {
      count: 0,
      resetAt: now + windowMs,
      tokens: 0,
      lastRefill: now,
    }
    buckets.set(key, bucket)
  }

  if (bucket.count < limit) {
    bucket.count += 1
    return {
      success: true,
      resetAt: bucket.resetAt,
      remaining: limit - bucket.count,
      retryAfterSec: 0,
    }
  }

  return {
    success: false,
    resetAt: bucket.resetAt,
    remaining: 0,
    retryAfterSec: Math.ceil((bucket.resetAt - now) / 1000),
  }
}

/**
 * Get client IP from request, accounting for Vercel's forwarding.
 */
export function getClientIP(req: Request): string {
  const forwarded = req.headers.get('x-forwarded-for')
  if (forwarded) return forwarded.split(',')[0].trim()
  const realIP = req.headers.get('x-real-ip')
  if (realIP) return realIP
  return 'unknown'
}

/**
 * Standard 429 response for rate-limited requests.
 */
export function rateLimitedResponse(result: RateLimitResult): Response {
  return new Response(
    JSON.stringify({
      error: 'Too many requests. Please slow down.',
      retryAfter: result.retryAfterSec,
    }),
    {
      status: 429,
      headers: {
        'Content-Type': 'application/json',
        'Retry-After': String(result.retryAfterSec),
        'X-RateLimit-Limit': String(result.remaining),
        'X-RateLimit-Reset': String(Math.floor(result.resetAt / 1000)),
      },
    },
  )
}
