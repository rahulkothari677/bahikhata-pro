import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getAuthUserIdWithModule } from '@/lib/get-auth'
import { withCache, noStore } from '@/lib/cache'
import { apiError } from '@/lib/api-error'

// GET /api/settings
export async function GET() {
  try {
    const { userId, error } = await getAuthUserIdWithModule('settings')
    if (error || !userId) return error || NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const setting = await db.setting.findUnique({ where: { userId } })
    // 🔒 AUDIT V25 FIX BUG-031 (Batch 5): Was withCache({ maxAge: 120, swr: 600 }).
    // Settings contain shopName, GSTIN, address, phone — all displayed on invoices.
    // A stale GSTIN on an invoice PDF is a compliance issue. Now noStore (always fresh).
    return noStore({ setting: setting || { shopName: 'My Shop' } })
  } catch (error) {
    // 🔒 V19-025 FIX: Return 500 on error, not 200 with fake defaults.
    // Previously: returned 200 + { shopName: 'My Shop' } on DB failure →
    // client thinks settings loaded successfully, shows wrong shop name.
    return apiError(error, 'Failed to load settings', 500)
  }
}

// PUT /api/settings
export async function PUT(req: NextRequest) {
  try {
    const { userId, error } = await getAuthUserIdWithModule('settings')
    if (error || !userId) return error || NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const body = await req.json()

    // 🔒 V26 H5 FIX: Validate inputs before storing. Was: raw body taken
    // with no length limits, no GSTIN format, no email format, no enum check.
    // Now: sanitize each field with length limits + format validation.
    const MAX_NAME = 200
    const MAX_TEXT = 2000
    const GSTIN_REGEX = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/

    // 🔒 V26 R13 (Phase 5): Non-string fallthrough now rejects with 400.
    // Was: `typeof body.X === 'string' ? body.X.slice(0, N) : body.X` →
    // `{ shopName: 123 }` reached Prisma and 500'd. Now: return 400 with a
    // clear message so the client knows it sent a bad type.
    const sanitized: any = {}
    if (body.shopName !== undefined) {
      if (body.shopName !== null && typeof body.shopName !== 'string') {
        return NextResponse.json({ error: 'shopName must be text' }, { status: 400 })
      }
      sanitized.shopName = typeof body.shopName === 'string' ? body.shopName.slice(0, MAX_NAME) : body.shopName
    }
    if (body.ownerName !== undefined) {
      if (body.ownerName !== null && typeof body.ownerName !== 'string') {
        return NextResponse.json({ error: 'ownerName must be text' }, { status: 400 })
      }
      sanitized.ownerName = typeof body.ownerName === 'string' ? body.ownerName.slice(0, MAX_NAME) : body.ownerName
    }
    if (body.address !== undefined) {
      if (body.address !== null && typeof body.address !== 'string') {
        return NextResponse.json({ error: 'address must be text' }, { status: 400 })
      }
      sanitized.address = typeof body.address === 'string' ? body.address.slice(0, MAX_TEXT) : body.address
    }
    if (body.phone !== undefined) {
      if (body.phone !== null && typeof body.phone !== 'string') {
        return NextResponse.json({ error: 'phone must be text' }, { status: 400 })
      }
      sanitized.phone = typeof body.phone === 'string' ? body.phone.slice(0, 20) : body.phone
    }
    if (body.gstin !== undefined) {
      if (body.gstin !== null && body.gstin !== '' && typeof body.gstin !== 'string') {
        return NextResponse.json({ error: 'gstin must be text' }, { status: 400 })
      }
      if (body.gstin !== null && body.gstin !== '' && !GSTIN_REGEX.test(body.gstin)) {
        return NextResponse.json({ error: 'Invalid GSTIN format. Must be 15 characters (e.g. 27ABCDE1234F1Z5).' }, { status: 400 })
      }
      sanitized.gstin = body.gstin
    }
    if (body.state !== undefined) {
      if (body.state !== null && typeof body.state !== 'string') {
        return NextResponse.json({ error: 'state must be text' }, { status: 400 })
      }
      sanitized.state = typeof body.state === 'string' ? body.state.slice(0, 100) : body.state
    }
    if (body.email !== undefined) {
      if (body.email !== null && body.email !== '' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(body.email)) {
        return NextResponse.json({ error: 'Invalid email format' }, { status: 400 })
      }
      sanitized.email = body.email
    }
    if (body.hideProfit !== undefined) sanitized.hideProfit = !!body.hideProfit
    if (body.roundOffEnabled !== undefined) sanitized.roundOffEnabled = !!body.roundOffEnabled
    if (body.scanLang !== undefined) {
      if (typeof body.scanLang !== 'string') {
        return NextResponse.json({ error: 'scanLang must be text' }, { status: 400 })
      }
      sanitized.scanLang = body.scanLang.slice(0, 20)
    }
    if (body.voiceLang !== undefined) {
      if (typeof body.voiceLang !== 'string') {
        return NextResponse.json({ error: 'voiceLang must be text' }, { status: 400 })
      }
      sanitized.voiceLang = body.voiceLang.slice(0, 20)
    }
    if (body.stockPolicy !== undefined) {
      if (!['block', 'allow'].includes(body.stockPolicy)) {
        return NextResponse.json({ error: 'stockPolicy must be "block" or "allow"' }, { status: 400 })
      }
      sanitized.stockPolicy = body.stockPolicy
    }
    if (body.upiId !== undefined) {
      if (body.upiId !== null && body.upiId !== '' && typeof body.upiId !== 'string') {
        return NextResponse.json({ error: 'upiId must be text' }, { status: 400 })
      }
      if (body.upiId !== null && body.upiId !== '' && !/^[\w.\-]{2,256}@[a-zA-Z]{2,64}$/.test(body.upiId)) {
        return NextResponse.json({ error: 'Invalid UPI ID format (e.g. name@bank)' }, { status: 400 })
      }
      sanitized.upiId = body.upiId
    }

    const updateData: any = sanitized

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
      upiId: body.upiId,  // V17-Ext 5.4: UPI VPA for collection links
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

    // 🔒 V19-026 FIX: Invalidate the HTTP cache on the GET response.
    // The GET handler uses withCache({ maxAge: 120 }) — without invalidation,
    // the next GET within 2 minutes returns the OLD settings.
    // Since we can't easily purge the HTTP cache from here, we add a
    // Cache-Control: no-cache header to the response so the client knows
    // to refetch. The React Query invalidateQueries on the client side
    // handles the rest.
    return NextResponse.json(
      { setting },
      { headers: { 'Cache-Control': 'no-cache, no-store, must-revalidate' } }
    )
  } catch (error) {
    return apiError(error, 'Failed to update settings', 500)
  }
}
