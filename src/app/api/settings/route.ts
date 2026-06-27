import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getAuthUserId } from '@/lib/get-auth'
import { withCache } from '@/lib/cache'

// GET /api/settings
export async function GET() {
  try {
    const { userId, error } = await getAuthUserId()
    if (error || !userId) return error || NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const setting = await db.setting.findUnique({ where: { userId } })
    return withCache({ setting: setting || { shopName: 'My Shop' } }, { maxAge: 120, swr: 600 })
  } catch (error) {
    return NextResponse.json({ error: 'Failed to fetch settings' }, { status: 500 })
  }
}

// PUT /api/settings
export async function PUT(req: NextRequest) {
  try {
    const { userId, error } = await getAuthUserId()
    if (error || !userId) return error || NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const body = await req.json()
    const setting = await db.setting.upsert({
      where: { userId },
      update: {
        shopName: body.shopName,
        ownerName: body.ownerName,
        address: body.address,
        phone: body.phone,
        gstin: body.gstin,
        state: body.state,
        email: body.email,
        hideProfit: body.hideProfit,
      },
      create: {
        userId,
        shopName: body.shopName || 'My Shop',
        ownerName: body.ownerName,
        address: body.address,
        phone: body.phone,
        gstin: body.gstin,
        state: body.state,
        email: body.email,
        hideProfit: body.hideProfit ?? false,
      },
    })
    return NextResponse.json({ setting })
  } catch (error) {
    console.error('Settings PUT error:', error)
    return NextResponse.json({ error: 'Failed to update settings' }, { status: 500 })
  }
}
