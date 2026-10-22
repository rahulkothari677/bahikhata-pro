/**
 * Phase 7d (#299) — one clean list of groups; doubles found for one-tap merging.
 */
import { describe, test, expect } from '@jest/globals'
import { findDoubles, groupChoices, groupWords, STANDARD_GROUPS } from '@/lib/item-groups'
import { readCode } from '@/test-support/read-source'

describe('the wiring (7d)', () => {
  test('groups are counted by the database; a merge moves only this shop\'s items, "No group" stored as null', () => {
    const r = readCode('src/app/api/products/groups/route.ts')
    expect(r).toContain("db.product.groupBy({\n      by: ['category'],\n      where: { userId },")
    expect(r).toContain('where: { userId, OR: [{ category: { in: fromNamed } }')
    expect(r).toContain("data: { category: into === NO_GROUP ? null : into }")
    const get = r.slice(r.indexOf('export async function GET'), r.indexOf('export async function POST'))
    expect(get).not.toMatch(/updateMany|\.update\(/) // looking saves nothing
  })
  test('the item form offers the one list; Items offers the tidy-up', () => {
    expect(readCode('src/components/inventory/ProductDialog.tsx')).toContain('groupChoices(shopGroups, form.category)')
    expect(readCode('src/components/inventory/Inventory.tsx')).toContain('<GroupTidy onChanged={refreshItems} />')
  })
  test('#302: deleting the last size of a brand removes the empty brand, in the same transaction', () => {
    const p = readCode('src/app/api/products/route.ts')
    const del = p.slice(p.indexOf('export async function DELETE'))
    expect(del).toContain('await db.$transaction(async (tx) => {')
    expect(del).toContain('if (existing.familyId && (await tx.product.count({ where: { userId, familyId: existing.familyId } })) === 0) {')
    expect(del).toContain('await tx.productFamily.deleteMany({ where: { id: existing.familyId, userId } })')
  })
})

describe('the words of a group', () => {
  test('case, "&"/"and", plurals and shop words do not make a different group', () => {
    expect(groupWords('Personal Care')).toEqual(groupWords('personal care'))
    expect(groupWords('Biscuits & cookies')).toEqual(groupWords('Biscuit and Cookie'))
    expect(groupWords('Flour')).toEqual(groupWords('Atta')) // a shop word: flour = atta
  })
})

describe('doubles, as the local copy actually had them', () => {
  const groups = [
    { name: 'Tea & coffee', items: 18 }, { name: 'Tea', items: 1 },
    { name: 'Personal care', items: 31 }, { name: 'Personal Care', items: 2 },
    { name: 'Oil & ghee', items: 13 }, { name: 'Oil', items: 1 },
    { name: 'Atta & flour', items: 14 }, { name: 'Flour', items: 1 },
    { name: 'Spices', items: 120 }, { name: 'Uncategorized', items: 1 },
  ]
  const d = findDoubles(groups)
  test('spelling variants go into the bigger one; a small group into the one bigger group holding its words', () => {
    expect(d).toEqual(expect.arrayContaining([
      { from: 'Personal Care', into: 'Personal care', fromItems: 2, intoItems: 31, why: 'spelling' },
      { from: 'Tea', into: 'Tea & coffee', fromItems: 1, intoItems: 18, why: 'inside' },
      { from: 'Oil', into: 'Oil & ghee', fromItems: 1, intoItems: 13, why: 'inside' },
      // flour = atta (a shop word), so "Atta & flour" and "Flour" are one group spelt two ways
      { from: 'Flour', into: 'Atta & flour', fromItems: 1, intoItems: 14, why: 'spelling' },
    ]))
    expect(d).toHaveLength(4)
  })
  test('"No group" and groups with nothing to merge are left alone', () => {
    expect(d.find((x) => x.from === 'Spices' || x.from === 'Uncategorized')).toBeUndefined()
  })
  test('never a guess: a group that two bigger groups hold is not suggested', () => {
    const amb = findDoubles([{ name: 'Salt', items: 1 }, { name: 'Salt & spices', items: 5 }, { name: 'Sugar & salt', items: 6 }])
    expect(amb).toEqual([])
  })
})

describe('choices while a group is typed', () => {
  test('the shop\'s own groups first, then the standard list, with no doubles between them', () => {
    const c = groupChoices(['Tea & coffee', 'My Specials'])
    expect(c.slice(0, 2)).toEqual(['Tea & coffee', 'My Specials'])
    expect(c.filter((g) => /^tea/i.test(g))).toEqual(['Tea & coffee']) // the standard "Tea & coffee" not repeated
    expect(c).toHaveLength(STANDARD_GROUPS.length + 1)
  })
  test('typing narrows by word starts: "bis" → Biscuits; "atta" also finds the flour group', () => {
    expect(groupChoices([], 'bis')).toEqual(['Biscuits & cookies'])
    expect(groupChoices([], 'atta')).toEqual(['Atta & flour'])
  })
})
