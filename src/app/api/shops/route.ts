import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getAuthUserId } from '@/lib/get-auth'
import { checkEntityLimit } from '@/lib/usage-limits'

// GET /api/shops — list all shops for the current user
export async function GET() {
  try {
    const { userId, error } = await getAuthUserId()
    if (error || !userId) return error || NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const shops = await db.shop.findMany({
      where: { userId },
      orderBy: { createdAt: 'asc' },
    })

    // If no shops exist, create a default one from existing settings
    if (shops.length === 0) {
      const setting = await db.setting.findUnique({ where: { userId } })
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
    }

    return NextResponse.json({ shops })
  } catch (error) {
    console.error('Shops GET error:', error)
    return NextResponse.json({ error: 'Failed to fetch shops' }, { status: 500 })
  }
}

// POST /api/shops — create a new shop
export async function POST(req: NextRequest) {
  try {
    const { userId, error } = await getAuthUserId()
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
    console.error('Shops POST error:', error)
    return NextResponse.json({ error: 'Failed to create shop' }, { status: 500 })
  }
}
