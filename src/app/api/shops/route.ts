import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getAuthUserIdOwnerOnly } from '@/lib/get-auth'
import { checkEntityLimit } from '@/lib/usage-limits'
import { apiError } from '@/lib/api-error'
import { validateBody, createShopSchema, renameShopSchema } from '@/lib/validation'

// GET /api/shops — list all shops for the current user
export async function GET(_req: NextRequest) {
  try {
    const { userId, error } = await getAuthUserIdOwnerOnly()
    if (error || !userId) return error || NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    /*
     * 🔒 #21 (2026-08-13): archived shops are left out.
     *
     * Archiving that still showed the shop in the picker would not be
     * archiving. `?includeArchived=1` is there for a future "closed shops"
     * screen and for anything that needs to resolve an old shopId to its name.
     *
     * The last active shop cannot be archived (see DELETE), so this list can
     * never come back empty for an established account — which matters,
     * because the branch below treats "no shops" as a brand new user and
     * creates one.
     */
    const includeArchived = new URL(_req.url).searchParams.get('includeArchived') === '1'
    const shops = await db.shop.findMany({
      where: { userId, ...(includeArchived ? {} : { archivedAt: null }) },
      orderBy: { createdAt: 'asc' },
    })

    // 🔒 V26 M10 FIX: If no shops exist, create a default one from existing settings.
    // Was: plain create → race condition (two concurrent first-loads both create).
    // Now: use upsert with a unique constraint on (userId, isDefault) to prevent
    // duplicates. If the upsert finds an existing default shop, it returns that.
    if (shops.length === 0) {
      const setting = await db.setting.findUnique({ where: { userId } })
      // Use findFirst + create with a catch for P2002 (unique violation) to
      // handle the race: if another request created the shop between our
      // findMany and create, re-fetch instead of erroring.
      try {
        const defaultShop = await db.shop.create({
          data: {
            userId,
            name: setting?.shopName || 'My Shop',
            gstin: setting?.gstin || null,
            address: setting?.address || null,
            phone: setting?.phone || null,
            state: setting?.state || null,
            isDefault: true,
          },
        })
        return NextResponse.json({ shops: [defaultShop] })
      } catch (createErr: any) {
        // P2002 = unique constraint violation — another concurrent request
        // created the shop. Re-fetch instead of erroring.
        if (createErr?.code === 'P2002') {
          const refetched = await db.shop.findMany({
            where: { userId },
            orderBy: { createdAt: 'asc' },
          })
          return NextResponse.json({ shops: refetched })
        }
        throw createErr
      }
    }

    return NextResponse.json({ shops })
  } catch (error) {
    console.error('Shops GET error:', error)
    return NextResponse.json({ shops: [] })
  }
}

// POST /api/shops — create a new shop
export async function POST(req: NextRequest) {
  try {
    const { userId, error } = await getAuthUserIdOwnerOnly()
    if (error || !userId) return error || NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    // 🔒 AUDIT FIX H2: Enforce plan limit on shop count (was: no check)
    const limitCheck = await checkEntityLimit(userId, 'shops')
    if (!limitCheck.allowed) {
      return NextResponse.json({
        error: 'plan_limit_reached',
        message: limitCheck.upgradeMessage,
        used: limitCheck.used,
        limit: limitCheck.limit,
      }, { status: 402 })
    }

    const body = await req.json()
    // 🔒 V26 R13 (Phase 5): First-pass zod validation (was: no schema).
    const validation = validateBody(createShopSchema, body)
    if (!validation.success) {
      return NextResponse.json({ error: validation.error }, { status: 400 })
    }
    const { name, gstin, address, phone, state } = body

    if (!name?.trim()) {
      return NextResponse.json({ error: 'Shop name is required' }, { status: 400 })
    }

    const shop = await db.shop.create({
      data: {
        userId,
        name: name.trim(),
        gstin: gstin || null,
        address: address || null,
        phone: phone || null,
        state: state || null,
      },
    })

    return NextResponse.json({ shop })
  } catch (error) {
    return apiError(error, 'Failed to create shop', 500)
  }
}

/*
 * PATCH /api/shops — rename a shop.
 *
 * 🔒 Added 2026-08-03 (audit). A shop could be created and never changed:
 * this route exported GET and POST only, and the only code in the codebase
 * that touched a Shop row afterwards was "delete my entire account". A shop
 * owner could not correct a typo in their own shop's name.
 *
 * The visible symptom was staler than that. The default shop is seeded once
 * from Setting.shopName (see GET above). Change your business name in
 * Settings afterwards and the Manage Shops card kept showing the ORIGINAL
 * name indefinitely, with no way to correct it — the app disagreed with
 * itself about what the shop was called. PUT /api/settings now carries the
 * new name across to the default shop, and this route covers every other
 * case.
 *
 * Rename only. GSTIN/address/state drive GST derivation and appear on
 * filings; changing those is a separate action with separate consequences.
 */
export async function PATCH(req: NextRequest) {
  try {
    const { userId, error } = await getAuthUserIdOwnerOnly()
    if (error || !userId) return error || NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const body = await req.json()
    const validation = validateBody(renameShopSchema, body)
    if (!validation.success) {
      return NextResponse.json({ error: validation.error }, { status: 400 })
    }
    const { id, name } = validation.data

    // Scope the WHERE by userId so one shop owner cannot rename another's
    // shop by guessing an id. updateMany (not update) because update() matches
    // on the primary key alone and would ignore the userId guard.
    const updated = await db.shop.updateMany({
      where: { id, userId },
      data: { name: name.trim() },
    })

    if (updated.count === 0) {
      return NextResponse.json({ error: 'Shop not found' }, { status: 404 })
    }

    const shop = await db.shop.findFirst({ where: { id, userId } })
    return NextResponse.json({ shop })
  } catch (error) {
    return apiError(error, 'Failed to rename shop', 500)
  }
}

/**
 * DELETE /api/shops?id=…            — remove a shop that holds nothing
 * DELETE /api/shops?id=…&archive=1  — put a shop away, keeping its books
 *
 * 🔒 #21 (audit 2026-08-13). A shop created by mistake, or one that has closed,
 * had no exit at all. It sat in the picker forever, and the only way out on
 * offer was deleting the entire account.
 *
 * TWO DIFFERENT ACTIONS, because they answer two different situations:
 *
 *   ARCHIVE  the shop traded. It has bills, customers, stock. Those are books,
 *            and books are kept — GST and income-tax retention are not ours to
 *            waive, and a shopkeeper who closed a branch still needs last
 *            year's figures. Archiving hides it from the picker and nothing
 *            else. It is reversible.
 *
 *   DELETE   the shop holds nothing at all. Nothing was ever recorded against
 *            it, so there is nothing to keep and nothing to lose. This is the
 *            typo case: "Shrama Kirana", created and immediately regretted.
 *
 * A shop with so much as one product is refused, and told exactly what it
 * holds. Deleting a traded shop would take real invoices with it, and no
 * confirmation dialog makes that safe — the shopkeeper cannot know what they
 * are agreeing to, and neither can we.
 */
export async function DELETE(req: NextRequest) {
  try {
    const { userId, error } = await getAuthUserIdOwnerOnly()
    if (error || !userId) return error || NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const url = new URL(req.url)
    const id = url.searchParams.get('id')
    const archive = url.searchParams.get('archive') === '1'
    if (!id) return NextResponse.json({ error: 'Shop id is required' }, { status: 400 })

    // Scoped by userId: one shop owner must not be able to touch another's
    // shop by guessing an id.
    const shop = await db.shop.findFirst({ where: { id, userId } })
    if (!shop) return NextResponse.json({ error: 'Shop not found' }, { status: 404 })

    /*
     * The last ACTIVE shop cannot leave, by either route. Without this the
     * shopkeeper can archive their way to zero shops, and GET then silently
     * creates a fresh "My Shop" — which looks exactly like their books having
     * been wiped.
     */
    const activeCount = await db.shop.count({ where: { userId, archivedAt: null } })
    if (activeCount <= 1 && !shop.archivedAt) {
      return NextResponse.json({
        error: 'This is your only shop',
        message: 'You cannot remove your last shop. Create another one first, then this one can go.',
      }, { status: 400 })
    }

    if (archive) {
      await db.shop.updateMany({ where: { id, userId }, data: { archivedAt: new Date() } })
      return NextResponse.json({
        success: true,
        archived: true,
        message: `"${shop.name}" has been put away. Its bills and customers are all still there — you can bring it back any time.`,
      })
    }

    /*
     * Counted in one round trip. Anything at all means this shop traded, and
     * the answer is archive rather than delete.
     *
     * SOFT-DELETED ROWS ARE COUNTED ON PURPOSE — no `deletedAt: null` here.
     * A deleted bill is not gone; it can be restored. Ignoring them would let
     * a shop whose every bill had been deleted look empty, be destroyed, and a
     * later restore would resurrect an invoice pointing at a shop that no
     * longer exists. Counting everything means the worst case is a refusal.
     *
     * The soft-delete sweep flags this file for exactly that reason; the
     * exception and its argument are recorded in
     * src/__tests__/lib/soft-delete-sweep.test.ts.
     */
    const [products, parties, transactions, documents] = await Promise.all([
      db.product.count({ where: { userId, shopId: id } }),
      db.party.count({ where: { userId, shopId: id } }),
      db.transaction.count({ where: { userId, shopId: id } }),
      db.document.count({ where: { userId, shopId: id } }),
    ])
    const held = [
      transactions && `${transactions} bill(s)`,
      parties && `${parties} customer(s)`,
      products && `${products} product(s)`,
      documents && `${documents} document(s)`,
    ].filter(Boolean) as string[]

    if (held.length > 0) {
      return NextResponse.json({
        error: 'This shop has records',
        code: 'SHOP_NOT_EMPTY',
        message:
          `"${shop.name}" holds ${held.join(', ')}. Those are your books, so the shop cannot be deleted. ` +
          `You can put it away instead — it disappears from the list and everything in it is kept.`,
        counts: { transactions, parties, products, documents },
      }, { status: 409 })
    }

    await db.shop.deleteMany({ where: { id, userId } })
    return NextResponse.json({
      success: true,
      archived: false,
      message: `"${shop.name}" was empty, so it has been removed.`,
    })
  } catch (error) {
    return apiError(error, 'Failed to remove shop', 500)
  }
}
