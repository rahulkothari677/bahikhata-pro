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
    return NextResponse.json({ setting: { shopName: 'My Shop' } })
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
        roundOffEnabled: body.roundOffEnabled,  // 🔒 V12
        scanLang: body.scanLang,
        voiceLang: body.voiceLang,
        stockPolicy: body.stockPolicy,  // 🔒 V11: 'block' | 'allow'
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
        roundOffEnabled: body.roundOffEnabled ?? false,  // 🔒 V12
        scanLang: body.scanLang || 'original',
        voiceLang: body.voiceLang || 'original',
        stockPolicy: body.stockPolicy || 'block',  // 🔒 V11: default block
      },
    })

    // 🔒 V8 M1: Invalidate the shop-state cache so the next sale uses the
    // updated state for inter/intra-state GST derivation. Without this, the
    // cached old state would persist for 5 minutes → wrong CGST/SGST vs IGST.
    if (body.state !== undefined) {
      const { invalidateShopStateCache } = await import('@/lib/gst')
      invalidateShopStateCache(userId)
    }

    return NextResponse.json({ setting })
  } catch (error) {
    console.error('Settings PUT error:', error)
    return NextResponse.json({ error: 'Failed to update settings' }, { status: 500 })
  }
}
