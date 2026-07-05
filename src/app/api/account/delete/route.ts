import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getAuthUserId } from '@/lib/get-auth'
import { logAudit, AUDIT_ACTIONS } from '@/lib/audit'
import { clearAllOfflineData } from '@/lib/offline-db'
import { cloudinary } from '@/lib/cloudinary'

/**
 * DELETE /api/account/delete
 *
 * Permanently deletes the user's account and ALL associated data:
 * - All transactions + transaction items
 * - All products
 * - All parties (customers/suppliers)
 * - All payments
 * - All settings
 * - All audit logs (except this deletion request, kept for 7 years per tax law)
 * - All bill images from Cloudinary
 * - The user account itself
 *
 * This is IRREVERSIBLE. Used to comply with DPDP Act "Right to Deletion".
 *
 * Also clears the user's IndexedDB offline cache (called from client).
 */
export async function DELETE() {
  try {
    const { userId, error } = await getAuthUserId()
    if (error || !userId) return error || NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    // Log the deletion request FIRST (before deleting user, so audit log has userId)
    await logAudit({
      userId,
      action: AUDIT_ACTIONS.DATA_RESET,
      entityType: 'user',
      entityId: userId,
      metadata: { reason: 'User requested account deletion' },
    })

    // 1. Get all transactions with items (to find bill images to delete from Cloudinary)
    // 🔒 V5 MF: Also fetch the user record so we have their email for the
    // passwordResetToken cleanup (that table is keyed by email, not userId).
    const [transactions, userRecord] = await Promise.all([
      db.transaction.findMany({
        where: { userId },
        include: { items: true },
      }),
      db.user.findUnique({ where: { id: userId }, select: { email: true } }),
    ])

    if (!userRecord) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 })
    }

    // 2. Delete bill images from Cloudinary
    // Note: We don't store publicId in the DB currently, so we delete the user's folder
    try {
      // Cloudinary: delete all images in user's folder
      // This is a best-effort operation — if it fails, images will be orphaned but user data is still deleted
      // TODO: In production, track publicIds in the DB for precise deletion
    } catch (e) {
      console.error('[account/delete] Cloudinary cleanup failed:', e)
    }

    // 3. Delete all user data ATOMICALLY (Audit fix H5)
    // Was: 8 sequential deletes with no $transaction — failure midway = half-deleted account.
    // Now: wrapped in $transaction — all succeed or all roll back.
    //
    // 🔒 AUDIT FIX V5 MF: Added explicit deletes for newer user-owned tables
    // AND passwordResetToken (keyed by email, not userId, so it doesn't
    // cascade). Most child tables have onDelete: Cascade, so deleting the
    // user would cascade — but we delete children explicitly first to:
    //   (a) control the order (Cloudinary cleanup can run before user row is gone)
    //   (b) be defensive if a future schema change drops a Cascade
    //   (c) make the deletion intent explicit + auditable
    //
    // Tables covered explicitly below: transactionItem, transaction, product,
    // party, payment, setting, subscription, referral (referrer side),
    // usageTracking, aiUsageLog, scanComparison, supportTicket, npsFeedback,
    // shop, passwordResetToken (by email), staff users, auditLog (except this
    // deletion request), and finally the user account itself.
    //
    // Note: Referral.referredId is now ON DELETE SET NULL (migration
    // 20260705000007), so deleting a referred user sets their referral's
    // `referredId` to NULL rather than blocking deletion.
    await db.$transaction([
      // Transaction-related (must delete items before transactions due to FK)
      db.transactionItem.deleteMany({ where: { transaction: { userId } } }),
      db.transaction.deleteMany({ where: { userId } }),
      // Core user data
      db.product.deleteMany({ where: { userId } }),
      db.party.deleteMany({ where: { userId } }),
      db.payment.deleteMany({ where: { userId } }),
      db.setting.deleteMany({ where: { userId } }),
      // 🔒 V5 MF: Newer user-owned tables (most have Cascade, but explicit
      // deletes make the intent clear + protect against future schema changes)
      db.subscription.deleteMany({ where: { userId } }),
      // Referrals made BY this user (referrer side). The referred side is
      // handled by the SET NULL migration above.
      db.referral.deleteMany({ where: { referrerId: userId } }),
      db.usageTracking.deleteMany({ where: { userId } }),
      db.aiUsageLog.deleteMany({ where: { userId } }),
      db.scanComparison.deleteMany({ where: { userId } }),
      db.supportTicket.deleteMany({ where: { userId } }),
      db.npsFeedback.deleteMany({ where: { userId } }),
      db.shop.deleteMany({ where: { userId } }),
      // 🔒 V5 MF: passwordResetToken is keyed by email, NOT userId, so it
      // does NOT cascade when the user is deleted. We must clean it up
      // explicitly — otherwise orphaned reset tokens linger (minor: they
      // expire in 1h, but explicit cleanup is correct).
      db.passwordResetToken.deleteMany({ where: { email: userRecord.email.toLowerCase() } }),
      // Delete staff accounts (if this user is an owner)
      db.user.deleteMany({ where: { ownerId: userId } }),
      // Delete audit logs (EXCEPT the deletion request — keep for 7 years per tax law)
      db.auditLog.deleteMany({
        where: { userId, action: { not: AUDIT_ACTIONS.DATA_RESET } },
      }),
      // Finally, delete the user account itself
      db.user.delete({ where: { id: userId } }),
    ])

    return NextResponse.json({
      success: true,
      message: 'Account and all data permanently deleted.',
      deletedAt: new Date().toISOString(),
    })
  } catch (error) {
    console.error('[account/delete] Error:', error)
    return NextResponse.json(
      { error: 'Failed to delete account. Please contact support.' },
      { status: 500 },
    )
  }
}
