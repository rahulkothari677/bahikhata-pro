import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireAdmin } from '@/lib/admin-auth'

/**
 * GET /api/admin/announcements — list all announcements
 * POST /api/admin/announcements — create announcement
 * PUT /api/admin/announcements — update (activate/deactivate)
 * DELETE /api/admin/announcements — delete announcement
 */

export async function GET() {
  const auth = await requireAdmin()
  if (!auth.ok) return auth.error

  try {
    const announcements = await db.announcement.findMany({
      orderBy: { createdAt: 'desc' },
    })
    return NextResponse.json({ announcements })
  } catch {
    return NextResponse.json({ announcements: [] })
  }
}

export async function POST(req: NextRequest) {
  const auth = await requireAdmin()
  if (!auth.ok) return auth.error

  try {
    const { title, message, type, link, endsAt } = await req.json()

    if (!title || !message) {
      return NextResponse.json({ error: 'title and message required' }, { status: 400 })
    }

    const announcement = await db.announcement.create({
      data: {
        title,
        message,
        type: type || 'info',
        link: link || null,
        endsAt: endsAt ? new Date(endsAt) : null,
        createdBy: auth.userId,
      },
    })

    // Log
    await db.auditLog.create({
      data: {
        userId: auth.userId,
        action: 'admin.announcement.create',
        entityType: 'announcement',
        entityId: announcement.id,
        metadata: { title },
      },
    }).catch(() => {})

    return NextResponse.json({ announcement })
  } catch (error) {
    console.error('[admin/announcements] POST error:', error)
    return NextResponse.json({ error: 'Failed' }, { status: 500 })
  }
}

export async function PUT(req: NextRequest) {
  const auth = await requireAdmin()
  if (!auth.ok) return auth.error

  try {
    const { id, isActive } = await req.json()
    if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })

    const announcement = await db.announcement.update({
      where: { id },
      data: { isActive },
    })

    return NextResponse.json({ announcement })
  } catch {
    return NextResponse.json({ error: 'Failed' }, { status: 500 })
  }
}

export async function DELETE(req: NextRequest) {
  const auth = await requireAdmin()
  if (!auth.ok) return auth.error

  try {
    const { searchParams } = new URL(req.url)
    const id = searchParams.get('id')
    if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })

    await db.announcement.delete({ where: { id } })
    return NextResponse.json({ success: true })
  } catch {
    return NextResponse.json({ error: 'Failed' }, { status: 500 })
  }
}
