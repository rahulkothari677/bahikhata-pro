import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getAuthUserId } from '@/lib/get-auth'
import { logAudit, AUDIT_ACTIONS } from '@/lib/audit'

/**
 * GET /api/account/export
 *
 * Exports ALL user data in JSON format (DPDP Act "Right to Data Portability").
 * Returns a downloadable JSON file containing:
 * - User profile
 * - Settings
 * - All products
 * - All parties (customers/suppliers)
 * - All transactions + items
 * - All payments
 * - Audit logs (user's own actions)
 *
 * The response has Content-Disposition: attachment to trigger download.
 */
export async function GET() {
  try {
    const { userId, error } = await getAuthUserId()
    if (error || !userId) return error || NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    // Log the export request
    await logAudit({
      userId,
      action: AUDIT_ACTIONS.DATA_EXPORT,
      entityType: 'user',
      entityId: userId,
    })

    // Fetch all user data in parallel
    const [user, setting, products, parties, transactions, payments, auditLogs] = await Promise.all([
      db.user.findUnique({
        where: { id: userId },
        select: {
          id: true,
          email: true,
          name: true,
          role: true,
          createdAt: true,
          updatedAt: true,
          // Exclude password for security
        },
      }),
      db.setting.findUnique({ where: { userId } }),
      db.product.findMany({ where: { userId } }),
      db.party.findMany({ where: { userId } }),
      db.transaction.findMany({
        where: { userId },
        include: { items: true, party: true },
      }),
      db.payment.findMany({ where: { userId } }),
      db.auditLog.findMany({
        where: { userId },
        select: {
          action: true,
          entityType: true,
          entityId: true,
          ip: true,
          createdAt: true,
          metadata: true,
        },
      }),
    ])

    const exportData = {
      exportInfo: {
        exportedAt: new Date().toISOString(),
        appVersion: '1.0',
        format: 'JSON',
        note: 'This is a complete export of your data from EkBook, per DPDP Act 2023 Right to Data Portability.',
        // 🔒 V8 D4: Note about soft-deleted records in the export
        softDeleteNote: 'Transactions with a non-null "deletedAt" field have been soft-deleted (voided) but are included in this export for completeness. Parties with a non-null "deletedAt" are similarly soft-deleted.',
      },
      user,
      setting,
      products,
      // 🔒 V8 D4: Mark soft-deleted parties — include all but flag them
      parties: parties?.map(p => ({
        ...p,
        isDeleted: p.deletedAt !== null,
      })),
      // 🔒 V8 D4: Mark soft-deleted transactions — include all but flag them
      transactions: transactions?.map(t => ({
        ...t,
        isDeleted: t.deletedAt !== null,
      })),
      payments,
      auditLogs,
    }

    const filename = `ekbook-export-${new Date().toISOString().split('T')[0]}.json`

    return new NextResponse(JSON.stringify(exportData, null, 2), {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Cache-Control': 'no-store', // sensitive data, never cache
      },
    })
  } catch (error) {
    console.error('[account/export] Error:', error)
    return NextResponse.json(
      { error: 'Failed to export data. Please contact support.' },
      { status: 500 },
    )
  }
}
