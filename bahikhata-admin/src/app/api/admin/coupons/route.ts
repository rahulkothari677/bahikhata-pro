import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireAdmin } from '@/lib/admin-auth'

/**
 * GET /api/admin/coupons — list all coupon codes
 * POST /api/admin/coupons — create coupon code
 * Body: { code, discountPercent, maxUses, expiresAt }
 * DELETE /api/admin/coupons?id=xxx — delete coupon
 *
 * NOTE: Coupons stored as FeatureFlag entries with key 'coupon_CODE'
 * For production, create a dedicated Coupon model. This is a simple workaround.
 */

// In-memory coupon store (in production, use a DB table)
const coupons = new Map<string, { code: string, discountPercent: number, maxUses: number, uses: number, expiresAt: Date | null, active: boolean }>()

export async function GET() {
  const auth = await requireAdmin()
  if (!auth.ok) return auth.error

  const couponList = Array.from(coupons.values())
  return NextResponse.json({ coupons: couponList })
}

export async function POST(req: NextRequest) {
  const auth = await requireAdmin()
  if (!auth.ok) return auth.error

  try {
    const { code, discountPercent, maxUses, expiresAt } = await req.json()

    if (!code || !discountPercent) {
      return NextResponse.json({ error: 'code and discountPercent required' }, { status: 400 })
    }

    const upperCode = code.toUpperCase()
    const coupon = {
      code: upperCode,
      discountPercent: parseInt(discountPercent),
      maxUses: maxUses ? parseInt(maxUses) : 999999,
      uses: 0,
      expiresAt: expiresAt ? new Date(expiresAt) : null,
      active: true,
    }

    coupons.set(upperCode, coupon)

    await db.auditLog.create({
      data: {
        userId: auth.userId,
        action: 'admin.coupon.create',
        entityType: 'coupon',
        entityId: upperCode,
        metadata: coupon,
      },
    }).catch(() => {})

    return NextResponse.json({ coupon, message: `Coupon ${upperCode} created — ${discountPercent}% off` })
  } catch (error) {
    return NextResponse.json({ error: 'Failed' }, { status: 500 })
  }
}

export async function DELETE(req: NextRequest) {
  const auth = await requireAdmin()
  if (!auth.ok) return auth.error

  const { searchParams } = new URL(req.url)
  const code = searchParams.get('id')

  if (!code) return NextResponse.json({ error: 'code required' }, { status: 400 })

  coupons.delete(code.toUpperCase())
  return NextResponse.json({ success: true })
}

// Export for use in payment processing (when Razorpay is connected)
export { coupons }
