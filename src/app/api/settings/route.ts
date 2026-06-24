import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'

// GET /api/settings
export async function GET() {
  try {
    const setting = await db.setting.findUnique({ where: { id: 'default' } })
    return NextResponse.json({ setting: setting || { shopName: 'My Shop' } })
  } catch (error) {
    return NextResponse.json({ error: 'Failed to fetch settings' }, { status: 500 })
  }
}

// PUT /api/settings
export async function PUT(req: NextRequest) {
  try {
    const body = await req.json()
    const setting = await db.setting.upsert({
      where: { id: 'default' },
      update: {
        shopName: body.shopName,
        ownerName: body.ownerName,
        address: body.address,
        phone: body.phone,
        gstin: body.gstin,
        state: body.state,
        email: body.email,
      },
      create: {
        id: 'default',
        shopName: body.shopName || 'My Shop',
        ownerName: body.ownerName,
        address: body.address,
        phone: body.phone,
        gstin: body.gstin,
        state: body.state,
        email: body.email,
      },
    })
    return NextResponse.json({ setting })
  } catch (error) {
    console.error('Settings PUT error:', error)
    return NextResponse.json({ error: 'Failed to update settings' }, { status: 500 })
  }
}
