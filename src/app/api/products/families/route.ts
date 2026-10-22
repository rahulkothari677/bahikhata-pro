import { NextRequest, NextResponse } from 'next/server'
import { db, withConnectionRetry } from '@/lib/db'
import { getAuthUserIdWithModule } from '@/lib/get-auth'
import { apiError } from '@/lib/api-error'
import { validateBody, createFamiliesSchema } from '@/lib/validation'
import { suggestFamilies } from '@/lib/product-sizes'
import { familyNamed, putSizesInFamily, FamilyError } from '@/lib/product-families-server'

/**
 * Phase 7b (#293) — brands with sizes.
 *
 * GET: the shop's brands (with how many sizes each), and the groups EkBook
 * suggests from item names — suggestions only; nothing is saved by looking.
 * POST: group — one suggestion or many in one tap ("Group all"). Each group
 * names a brand (an existing one of that name is reused) and its sizes.
 * Everything in one transaction: all of it is saved, or none.
 */
export async function GET() {
  try {
    const { userId, error } = await getAuthUserIdWithModule('inventory')
    if (error || !userId) return error || NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const [families, items] = await withConnectionRetry(() => Promise.all([
      db.productFamily.findMany({
        where: { userId },
        select: { id: true, name: true, _count: { select: { products: true } } },
        orderBy: { name: 'asc' },
      }),
      db.product.findMany({ where: { userId }, select: { id: true, name: true, familyId: true } }),
    ]))
    return NextResponse.json({
      families: families.map((f) => ({ id: f.id, name: f.name, sizes: f._count.products })),
      suggestions: suggestFamilies(items),
    }, { headers: { 'Cache-Control': 'no-store, max-age=0' } })
  } catch (err) {
    return apiError(err, 'Could not load brands')
  }
}

export async function POST(req: NextRequest) {
  try {
    const { userId, error } = await getAuthUserIdWithModule('inventory')
    if (error || !userId) return error || NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const body = validateBody(createFamiliesSchema, await req.json().catch(() => null))
    if (!body.success) return NextResponse.json({ error: body.error }, { status: 400 })
    const result = await db.$transaction(async (tx) => {
      const out: { id: string; name: string; sizes: number }[] = []
      for (const g of body.data.groups) {
        const fam = await familyNamed(tx, userId, g.name)
        const sizes = await putSizesInFamily(tx, userId, fam.id, g.members)
        out.push({ id: fam.id, name: fam.name, sizes })
      }
      return out
    })
    return NextResponse.json({ families: result })
  } catch (err) {
    if (err instanceof FamilyError) return NextResponse.json({ error: err.message }, { status: err.status })
    return apiError(err, 'Could not group these items')
  }
}
