import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getAuthUserIdWithModule } from '@/lib/get-auth'
import { withCache } from '@/lib/cache'

// GET /api/settings
export async function GET() {
  try {
    const { userId, error } = await getAuthUserIdWithModule('settings')
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
    const { userId, error } = await getAuthUserIdWithModule('settings')
    if (error || !userId) return error || NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const body = await req.json()

    // 🔒 V17-Ext §5.1: Build the update object conditionally for lockedUntil.
    // Same "only update if explicitly provided" pattern as parties PUT (H6 fix).
    // The UI sends lockedUntil as:
    //   - An ISO date string → set the lock to that date
    //   - null → explicitly unlock (remove the lock)
    //   - undefined → don't touch the lock (a settings save from a UI section
    //     that doesn't know about period lock shouldn't wipe it)
    // We validate the date format here — if it's a non-null string that can't
    // be parsed as a date, return 400 (don't silently store garbage).
    const updateData: any = {
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
    }

    if (body.lockedUntil !== undefined) {
      if (body.lockedUntil === null) {
        // Explicit unlock — set to null
        updateData.lockedUntil = null
      } else {
        // Set lock — validate the date
        const lockDate = new Date(body.lockedUntil)
        if (isNaN(lockDate.getTime())) {
          return NextResponse.json({
            error: 'Invalid lock date',
            message: 'The period lock date could not be parsed. Please select a valid date.',
          }, { status: 400 })
        }
        updateData.lockedUntil = lockDate
      }
    }

    // Build create data — includes lockedUntil only if explicitly provided
    // (same conditional logic, so a first-time settings save doesn't lock).
    const createData: any = {
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
    }
    if (body.lockedUntil !== undefined) {
      createData.lockedUntil = body.lockedUntil === null ? null : new Date(body.lockedUntil)
    }

    const setting = await db.setting.upsert({
      where: { userId },
      update: updateData,
      create: createData,
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
