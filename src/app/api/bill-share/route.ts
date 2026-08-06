/**
 * POST   /api/bill-share  — mint (or return) a shareable link for one bill
 * DELETE /api/bill-share  — revoke every link for one bill
 *
 * 📄 Phase 4 of docs/DOCUMENT-ENGINE-PLAN.md.
 *
 * The link this creates opens a page with NO LOGIN, because the person opening
 * it is a customer with no account. So this route is the gate: it is the only
 * place a token is minted, and it mints one only for a bill the CALLER owns.
 */

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getAuthUserIdWithModule } from '@/lib/get-auth'
import { apiError } from '@/lib/api-error'
import { mintShareToken, defaultExpiry, isShareLinkUsable } from '@/lib/bill-share'

// 'sales' rather than a module of its own: sharing a bill is something anyone
// who can see the bill may do, and staff permissions are already expressed per
// module. A new key would be a permission every existing shop had to grant.

export async function POST(req: NextRequest) {
  try {
    const { userId, error } = await getAuthUserIdWithModule('sales')
    if (error || !userId) return error || NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const body = await req.json().catch(() => ({}))
    const transactionId = body?.transactionId
    if (typeof transactionId !== 'string' || !transactionId) {
      return NextResponse.json({ error: 'transactionId is required' }, { status: 400 })
    }

    /*
     * ⚠️ OWNERSHIP IS CHECKED BEFORE A TOKEN EXISTS.
     *
     * Scoping the lookup by userId — rather than fetching the bill and
     * comparing afterwards — means a caller passing someone else's
     * transactionId gets a 404 and no token is ever created. Minting first and
     * checking second would leave a live capability behind on every failed
     * attempt.
     */
    const txn = await db.transaction.findFirst({
      // 🔒 `deletedAt: null` matters here, not just as house style. Without it a
      // shopkeeper could mint a public link for a bill they had DELETED, and
      // that link would keep serving it. Caught by the V16 C5 soft-delete sweep.
      where: { id: transactionId, userId, deletedAt: null },
      select: { id: true },
    })
    if (!txn) return NextResponse.json({ error: 'Bill not found' }, { status: 404 })

    // Reuse a live link rather than minting a second one for the same bill.
    // Every extra token is another key to the same door, and a shopkeeper who
    // taps share twice should send the same link, not two.
    const existing = await db.billShare.findFirst({
      where: { transactionId, userId, revokedAt: null },
      orderBy: { createdAt: 'desc' },
    })
    if (existing && isShareLinkUsable(existing)) {
      return NextResponse.json({ token: existing.token, expiresAt: existing.expiresAt })
    }

    const share = await db.billShare.create({
      data: {
        token: mintShareToken(),
        userId,
        transactionId,
        expiresAt: defaultExpiry(),
      },
      select: { token: true, expiresAt: true },
    })

    return NextResponse.json(share, { status: 201 })
  } catch (error) {
    return apiError(error, 'Could not create the bill link', 500)
  }
}

/**
 * Revokes every live link for a bill.
 *
 * Marked rather than deleted: the audit trail should still show that a link
 * existed and was withdrawn, which is the question asked after a bill reaches
 * somewhere it should not have.
 */
export async function DELETE(req: NextRequest) {
  try {
    const { userId, error } = await getAuthUserIdWithModule('sales')
    if (error || !userId) return error || NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const transactionId = req.nextUrl.searchParams.get('transactionId')
    if (!transactionId) {
      return NextResponse.json({ error: 'transactionId is required' }, { status: 400 })
    }

    // Scoped by userId: a caller cannot revoke another shop's links.
    const result = await db.billShare.updateMany({
      where: { transactionId, userId, revokedAt: null },
      data: { revokedAt: new Date() },
    })

    return NextResponse.json({ revoked: result.count })
  } catch (error) {
    return apiError(error, 'Could not revoke the bill link', 500)
  }
}
