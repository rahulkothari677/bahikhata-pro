/**
 * Phase 7b (#293) — the one place that puts items into a brand or takes them
 * out. Every families route calls these, inside its transaction.
 *
 * Rules, each enforced here (never trusted from the phone):
 *  - every item is THIS shop's (userId in the WHERE, not after the fact);
 *  - an item is in at most one brand: one already in another brand is refused
 *    by name, never silently moved;
 *  - a size label is the one given, else read from the item's name
 *    (lib/product-sizes.ts), else the item's name — and its order number is
 *    always worked out here, from the label.
 */
import type { Prisma } from '@prisma/client'
import { parseSize, sizeRank } from './product-sizes'

export class FamilyError extends Error {
  constructor(message: string, readonly status: number) { super(message) }
}

type Tx = Prisma.TransactionClient

export async function putSizesInFamily(
  tx: Tx,
  userId: string,
  familyId: string,
  members: { productId: string; sizeLabel?: string }[],
): Promise<number> {
  if (!members.length) return 0
  const ids = [...new Set(members.map((m) => m.productId))]
  const items = await tx.product.findMany({
    where: { userId, id: { in: ids } },
    select: { id: true, name: true, familyId: true, family: { select: { name: true } } },
  })
  if (items.length !== ids.length) throw new FamilyError('Some items are not in this shop any more. Refresh and try again.', 404)
  const elsewhere = items.filter((i) => i.familyId && i.familyId !== familyId)
  if (elsewhere.length) {
    throw new FamilyError(`Already sizes of another brand: ${elsewhere.map((i) => `${i.name} (${i.family?.name ?? 'another brand'})`).join(', ')}`, 409)
  }
  const byId = new Map(items.map((i) => [i.id, i]))
  for (const m of members) {
    const item = byId.get(m.productId)!
    const label = (m.sizeLabel?.trim() || parseSize(item.name)?.label || item.name).slice(0, 30)
    await tx.product.update({
      where: { id: item.id },
      data: { familyId, sizeLabel: label, sizeRank: sizeRank(label) },
    })
  }
  return members.length
}

/** Take sizes out of a brand: they become items on their own again; nothing else about them changes. */
export async function takeSizesOut(tx: Tx, userId: string, familyId: string, productIds: string[]): Promise<number> {
  if (!productIds.length) return 0
  const r = await tx.product.updateMany({
    where: { userId, familyId, id: { in: productIds } },
    data: { familyId: null, sizeLabel: null, sizeRank: null },
  })
  return r.count
}

/** The shop's brand of this name (any capitals), or a new one. One "Parle-G" per shop. */
export async function familyNamed(tx: Tx, userId: string, name: string): Promise<{ id: string; name: string }> {
  const clean = name.trim().replace(/\s+/g, ' ')
  const found = await tx.productFamily.findFirst({
    where: { userId, name: { equals: clean, mode: 'insensitive' } },
    select: { id: true, name: true },
  })
  if (found) return found
  return tx.productFamily.create({ data: { userId, name: clean }, select: { id: true, name: true } })
}
