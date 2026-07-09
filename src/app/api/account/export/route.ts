import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getAuthUserIdOwnerOnly } from '@/lib/get-auth'
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
    const { userId, error } = await getAuthUserIdOwnerOnly()
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
        // 🔒 V8 D4 + V17-Ext §2.2: Note about soft-deleted records in the export.
        // Payments became soft-deletable in V15 M-3 — without the isDeleted flag,
        // a CA reconciling the export against the app wouldn't know which
        // payments were voided.
        softDeleteNote: 'Transactions, parties, and payments with a non-null "deletedAt" field have been soft-deleted (voided) but are included in this export for completeness. Use the "isDeleted" flag on each record to distinguish active from voided entries.',
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
      // 🔒 V17-Ext §2.2: Mark soft-deleted payments — same pattern as parties
      // and transactions. Payments became soft-deletable in V15 M-3, but the
      // export wasn't updated to flag them. A CA reconciling the export
      // against the app would see voided payments as active and the numbers
      // wouldn't match.
      payments: payments?.map(p => ({
        ...p,
        isDeleted: p.deletedAt !== null,
      })),
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
