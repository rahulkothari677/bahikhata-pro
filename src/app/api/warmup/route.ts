import { NextResponse } from 'next/server'
import { db } from '@/lib/db'

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
 */
export async function GET() {
  try {
    // Simplest possible query — just check the connection is alive
    await db.$queryRaw`SELECT 1`
    return NextResponse.json({ ok: true, ts: Date.now() })
  } catch (error) {
    console.error('[warmup] DB connection failed:', error)
    return NextResponse.json(
      { ok: false, error: 'Database connection failed' },
      { status: 500 },
    )
  }
}
