import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getAuthContext } from '@/lib/get-auth'
import { canAccessModule } from '@/lib/staff-permissions'
import { apiError } from '@/lib/api-error'

/**
 * DELETE /api/payments/[id]
 *
 * Delete a payment record. Scoped by userId for tenant isolation.
 */
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const authCtx = await getAuthContext()
    if (authCtx.error || !authCtx.userId) return authCtx.error || NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const userId = authCtx.userId

    if (!canAccessModule(authCtx.role, authCtx.permissions, 'parties')) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const { id } = await params

    // Verify ownership
    const existing = await db.payment.findFirst({ where: { id, userId } })
    if (!existing) {
      return NextResponse.json({ error: 'Payment not found' }, { status: 404 })
    }

    await db.payment.delete({ where: { id } })

    return NextResponse.json({ success: true, message: 'Payment deleted' })
  } catch (error) {
    return apiError(error, 'Failed to delete payment', 500)
  }
}
