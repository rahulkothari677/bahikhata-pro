/**
 * Simple in-memory rate limiter.
 *
 * For production at scale, replace with @upstash/ratelimit (Redis-backed).
 * For a startup app with <1000 users, in-memory is fine and avoids the cost
 * of a Redis instance.
 *
 * Usage:
 *   import { rateLimit } from '@/lib/rate-limit'
 *   const { success, resetAt } = rateLimit(key, { limit: 5, windowSec: 60 })
 *   if (!success) return 429 response
 *
 * Strategies:
 *   - 'fixed' (default): simple fixed window — N requests per window
 *   - 'token': token bucket — bursty traffic allowed up to capacity
 */

interface Bucket {
  count: number
  resetAt: number
  tokens: number  // for token bucket
  lastRefill: number
}

const buckets = new Map<string, Bucket>()

// Periodically purge expired buckets to prevent memory leak
const PURGE_INTERVAL = 5 * 60 * 1000 // 5 min
let lastPurge = Date.now()

function purge() {
  const now = Date.now()
  if (now - lastPurge < PURGE_INTERVAL) return
  lastPurge = now
  for (const [key, bucket] of buckets) {
    if (bucket.resetAt < now) buckets.delete(key)
  }
}

interface RateLimitResult {
  success: boolean
  resetAt: number        // epoch ms when bucket resets
  remaining: number      // remaining requests in window
  retryAfterSec: number  // seconds until reset (for Retry-After header)
}

interface FixedWindowOpts {
  limit: number      // max requests per window
  windowSec: number  // window length in seconds
}

interface TokenBucketOpts {
  capacity: number   // max tokens in bucket (burst size)
  refillPerSec: number  // tokens added per second
}

export function rateLimit(
  key: string,
  opts: FixedWindowOpts | TokenBucketOpts,
): RateLimitResult {
  purge()
  const now = Date.now()

  // Token bucket strategy
  if ('capacity' in opts) {
    const { capacity, refillPerSec } = opts
    let bucket = buckets.get(key)
    if (!bucket) {
      bucket = {
        count: 0,
        resetAt: now + 60_000,
        tokens: capacity,
        lastRefill: now,
      }
      buckets.set(key, bucket)
    }

    // Refill tokens based on elapsed time
    const elapsed = (now - bucket.lastRefill) / 1000
    bucket.tokens = Math.min(capacity, bucket.tokens + elapsed * refillPerSec)
    bucket.lastRefill = now

    if (bucket.tokens >= 1) {
      bucket.tokens -= 1
      return {
        success: true,
        resetAt: now + Math.ceil((1 - bucket.tokens) / refillPerSec * 1000),
        remaining: Math.floor(bucket.tokens),
        retryAfterSec: 0,
      }
    }

    const retryAfterSec = Math.ceil((1 - bucket.tokens) / refillPerSec)
    return {
      success: false,
      resetAt: now + retryAfterSec * 1000,
      remaining: 0,
      retryAfterSec,
    }
  }

  // Fixed window strategy (default)
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
