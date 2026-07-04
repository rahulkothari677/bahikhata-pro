import { NextResponse } from 'next/server'
import { db } from '@/lib/db'

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
  } catch {
    // Fail silently — no announcements if table doesn't exist
    return NextResponse.json({ announcements: [] })
  }
}
