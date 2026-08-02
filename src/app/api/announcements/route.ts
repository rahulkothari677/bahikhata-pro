import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { apiError } from '@/lib/api-error'

/**
 * GET /api/announcements
 *
 * Returns active announcements to show as banner in the app.
 * Public endpoint (no auth needed).
 * Only returns announcements that are:
 * - isActive = true
 * - startsAt <= now
 * - endsAt is null OR endsAt >= now
 */
export async function GET() {
  try {
    const now = new Date()
    const announcements = await db.announcement.findMany({
      where: {
        isActive: true,
        startsAt: { lte: now },
        OR: [
          { endsAt: null },
          { endsAt: { gte: now } },
        ],
      },
      orderBy: { createdAt: 'desc' },
      take: 3, // max 3 active announcements at a time
    })

    return NextResponse.json({ announcements })
  } catch (error) {
    // 🔒 AUDIT PASS-1 L5: still fail SOFT, but no longer fail SILENT.
    //
    // Degrading to an empty banner list is the right call — a broken
    // announcements table must never block the dashboard. But the bare
    // `catch {}` swallowed the error object entirely, so a genuine outage
    // (Neon asleep, connection pool exhausted, a migration mid-flight) was
    // indistinguishable from "the shopkeeper has no announcements today".
    // Nothing reached Sentry, because nothing was ever thrown or logged.
    //
    // console.error is picked up by the Sentry transport configured in
    // sentry.server.config.ts, so this now surfaces as a real signal while the
    // user-facing behaviour is unchanged.
    console.error('[announcements] failed to load, degrading to empty list:', error)
    return NextResponse.json({ announcements: [] })
  }
}
