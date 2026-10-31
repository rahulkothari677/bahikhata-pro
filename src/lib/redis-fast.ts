/**
 * How long a Redis call may take before the app moves on (#286, Phase 7h).
 *
 * Live, the first signed-in request after a long idle took 12.1 s, while a cold
 * server start measured 0.5 s and the database 35 ms (/api/health, 31 Oct). What
 * runs only on the signed-in path is the session check's Redis call — and the
 * Upstash client's defaults retry 5 times with growing waits (~4 s of backoff
 * alone) before giving up. Every Redis use here already has a fallback (the
 * session's DB check, the rate limiter's in-memory bucket), so a slow Redis should
 * cost at most ~1.5 s, never a 12-second first screen.
 *
 * One setting for every Redis client in the app.
 */
export const REDIS_TIMEOUT_MS = 1500

export const FAST_REDIS_OPTIONS = {
  // A fresh signal per request: one slow call cannot cancel the next.
  signal: () => AbortSignal.timeout(REDIS_TIMEOUT_MS),
  retry: { retries: 1, backoff: () => 100 },
}
