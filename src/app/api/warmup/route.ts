import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getDatabaseConfigStatus } from '@/lib/verify-db-config'

/**
 * GET /api/warmup
 *
 * Pings the database to wake up Neon (free tier auto-pauses after 5 min).
 * Called by:
 *   1. GitHub Actions cron (every 5 minutes) — keeps Neon warm.
 *      See .github/workflows/neon-warmup.yml
 *   2. Client-side on page load (before real API calls) — ensures DB is awake.
 *
 * NOTE: vercel.json has a daily cron at 6 AM UTC, but that's a fallback.
 * The REAL warmup is GitHub Actions every 5 min (Vercel Hobby only allows
 * daily crons). To eliminate cold starts entirely, disable Neon scale-to-zero
 * (Neon Console → Project → Compute → turn off Suspend compute).
 *
 * Returns 200 with a timestamp if DB is reachable, 500 if not.
 * No auth required — this endpoint only runs `SELECT 1` (no user data).
 *
 * 🔒 AUDIT FIX V4 P5: Also returns the DB pooling config status so the
 * user can verify -pooler / connection_limit=1 / DIRECT_URL by hitting
 * /api/warmup in a browser. No secrets are exposed (passwords stripped).
 */
export async function GET() {
  const configStatus = getDatabaseConfigStatus()
  const start = Date.now()

  try {
    // Simplest possible query — just check the connection is alive
    await db.$queryRaw`SELECT 1`
    const durationMs = Date.now() - start

    // 🔒 V9 M12: Log cold-start frequency + latency for observability.
    // If durationMs > 2000, Neon was likely asleep (cold start).
    // This lets the founder monitor warmup effectiveness in Vercel logs.
    if (durationMs > 2000) {
      console.warn(`[warmup] SLOW: ${durationMs}ms — Neon may have been sleeping (cold start). Disable scale-to-zero to eliminate this.`)
    } else {
      console.log(`[warmup] OK: ${durationMs}ms`)
    }

    return NextResponse.json({
      ok: true,
      ts: Date.now(),
      durationMs,  // 🔒 V9 M12: expose latency for monitoring
      coldStart: durationMs > 2000,  // true if likely a cold start
      dbConfig: configStatus,
    })
  } catch (error) {
    console.error('[warmup] DB connection failed:', error)
    return NextResponse.json(
      {
        ok: false,
        error: 'Database connection failed',
        dbConfig: configStatus,
        // Include the failure reason — if the connection error mentions
        // "too many connections" or "Connection terminated", that's a
        // strong signal the pooling config is wrong.
        hint: configStatus.databaseUrlHasPooler
          ? 'Pooling host looks OK — check Neon "Scale to zero" setting (should be OFF).'
          : 'DATABASE_URL is NOT using the -pooler host. This is the most likely cause of cold-start failures.',
      },
      { status: 500 },
    )
  }
}
