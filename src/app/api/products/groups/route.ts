import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { db, withConnectionRetry } from '@/lib/db'
import { getAuthUserIdWithModule } from '@/lib/get-auth'
import { apiError } from '@/lib/api-error'
import { validateBody } from '@/lib/validation'
import { findDoubles, NO_GROUP } from '@/lib/item-groups'

/**
 * Phase 7d (#299) — the shop's groups (categories).
 *
 * GET: every group with how many items it holds — counted by the database
 * (groupBy), not by rows on a phone — and the doubles lib/item-groups.ts
 * finds ("Tea" next to "Tea & coffee"). Looking saves nothing.
 * POST: merge — the items of `from` move to `into`, in one statement scoped
 * to this shop. Their updatedAt moves, so every phone's item list (and its
 * version tag) follows. An item never leaves the shop; only its group changes.
 */
const mergeSchema = z.object({
  from: z.array(z.string().trim().min(1).max(200)).min(1).max(50),
  into: z.string().trim().min(1, 'Name the group').max(200),
})

export async function GET() {
  try {
    const { userId, error } = await getAuthUserIdWithModule('inventory')
    if (error || !userId) return error || NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const rows = await withConnectionRetry(() => db.product.groupBy({
      by: ['category'],
      where: { userId },
      _count: { _all: true },
    }))
    const groups = rows
      .map((r) => ({ name: r.category || NO_GROUP, items: r._count._all }))
      .sort((a, b) => a.name.localeCompare(b.name))
    return NextResponse.json({ groups, doubles: findDoubles(groups) }, { headers: { 'Cache-Control': 'no-store, max-age=0' } })
  } catch (err) {
    return apiError(err, 'Could not load groups')
  }
}

export async function POST(req: NextRequest) {
  try {
    const { userId, error } = await getAuthUserIdWithModule('inventory')
    if (error || !userId) return error || NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const body = validateBody(mergeSchema, await req.json().catch(() => null))
    if (!body.success) return NextResponse.json({ error: body.error }, { status: 400 })
    const into = body.data.into.replace(/\s+/g, ' ')
    const from = body.data.from.filter((f) => f !== into)
    if (!from.length) return NextResponse.json({ moved: 0, into })
    // "No group" is stored as null, never as the word.
    const fromNamed = from.filter((f) => f !== NO_GROUP)
    const r = await db.product.updateMany({
      where: { userId, OR: [{ category: { in: fromNamed } }, ...(from.includes(NO_GROUP) ? [{ category: null }] : [])] },
      data: { category: into === NO_GROUP ? null : into },
    })
    return NextResponse.json({ moved: r.count, into })
  } catch (err) {
    return apiError(err, 'Could not merge these groups')
  }
}
