import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getAuthUserIdWithModule } from '@/lib/get-auth'
import { apiError } from '@/lib/api-error'
import { validateBody, updateFamilySchema } from '@/lib/validation'
import { sizeRank } from '@/lib/product-sizes'
import { putSizesInFamily, takeSizesOut, FamilyError } from '@/lib/product-families-server'

/**
 * Phase 7b (#293) — one brand: rename it, add or take out sizes, correct a
 * size's label (PATCH); or ungroup it (DELETE). Items are never deleted here;
 * ungrouped, each is an item on its own again, as it was before grouping.
 *
 * A rename also touches its sizes' updatedAt, so the item list's version tag
 * (lib/catalog-etag.ts) changes and every phone fetches the new name.
 */
type Ctx = { params: Promise<{ id: string }> }

async function ownFamily(userId: string, id: string) {
  return db.productFamily.findFirst({ where: { id, userId }, select: { id: true, name: true } })
}

export async function PATCH(req: NextRequest, ctx: Ctx) {
  try {
    const { userId, error } = await getAuthUserIdWithModule('inventory')
    if (error || !userId) return error || NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const { id } = await ctx.params
    if (!(await ownFamily(userId, id))) return NextResponse.json({ error: 'Brand not found' }, { status: 404 })
    const body = validateBody(updateFamilySchema, await req.json().catch(() => null))
    if (!body.success) return NextResponse.json({ error: body.error }, { status: 400 })
    const { name, add, remove, sizes } = body.data
    const result = await db.$transaction(async (tx) => {
      if (name) {
        const clash = await tx.productFamily.findFirst({
          where: { userId, id: { not: id }, name: { equals: name.trim(), mode: 'insensitive' } }, select: { id: true },
        })
        if (clash) throw new FamilyError(`Another brand is already called ${name.trim()}.`, 409)
        await tx.productFamily.update({ where: { id }, data: { name: name.trim().replace(/\s+/g, ' ') } })
        await tx.product.updateMany({ where: { userId, familyId: id }, data: { familyId: id } }) // bumps updatedAt
      }
      const added = add?.length ? await putSizesInFamily(tx, userId, id, add) : 0
      const removed = remove?.length ? await takeSizesOut(tx, userId, id, remove) : 0
      for (const s of sizes ?? []) {
        const r = await tx.product.updateMany({
          where: { userId, familyId: id, id: s.productId },
          data: { sizeLabel: s.sizeLabel, sizeRank: sizeRank(s.sizeLabel) },
        })
        if (!r.count) throw new FamilyError('That size is not in this brand any more. Refresh and try again.', 404)
      }
      const left = await tx.product.count({ where: { userId, familyId: id } })
      return { added, removed, sizes: left }
    })
    return NextResponse.json({ id, ...result })
  } catch (err) {
    if (err instanceof FamilyError) return NextResponse.json({ error: err.message }, { status: err.status })
    return apiError(err, 'Could not change this brand')
  }
}

export async function DELETE(_req: NextRequest, ctx: Ctx) {
  try {
    const { userId, error } = await getAuthUserIdWithModule('inventory')
    if (error || !userId) return error || NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const { id } = await ctx.params
    if (!(await ownFamily(userId, id))) return NextResponse.json({ error: 'Brand not found' }, { status: 404 })
    const ungrouped = await db.$transaction(async (tx) => {
      // Explicitly, not by the foreign key's SET NULL: this also clears the sizes'
      // labels and bumps their updatedAt, so every phone's list changes too.
      const r = await tx.product.updateMany({
        where: { userId, familyId: id },
        data: { familyId: null, sizeLabel: null, sizeRank: null },
      })
      await tx.productFamily.delete({ where: { id } })
      return r.count
    })
    return NextResponse.json({ id, ungrouped })
  } catch (err) {
    return apiError(err, 'Could not ungroup this brand')
  }
}
