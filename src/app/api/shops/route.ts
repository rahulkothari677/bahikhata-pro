import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getAuthUserIdOwnerOnly } from '@/lib/get-auth'
import { checkEntityLimit } from '@/lib/usage-limits'
import { apiError } from '@/lib/api-error'
import { validateBody, createShopSchema } from '@/lib/validation'

// GET /api/shops — list all shops for the current user
export async function GET() {
  try {
    const { userId, error } = await getAuthUserIdOwnerOnly()
    if (error || !userId) return error || NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const shops = await db.shop.findMany({
      where: { userId },
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
