import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getDatabaseConfigStatus } from '@/lib/verify-db-config'

/**
 * GET /api/warmup
 *
 * Pings the database to wake up Neon (free tier auto-pauses after 5 min).
 * Called by:
 *   1. Vercel Cron Job (every 4 minutes) — keeps Neon warm
 *   2. Client-side on page load (before real API calls) — ensures DB is awake
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

  try {
    // Simplest possible query — just check the connection is alive
    await db.$queryRaw`SELECT 1`
    return NextResponse.json({
      ok: true,
      ts: Date.now(),
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
