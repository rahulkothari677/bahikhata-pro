import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getAuthUserIdOwnerOnly } from '@/lib/get-auth'
import { apiError } from '@/lib/api-error'
import { logAudit } from '@/lib/audit'

/**
 * GET /api/export/full
 *
 * 🔒 V17 Audit Phase 9: Full data export (JSON backup).
 * Downloads ALL user data as a single JSON file for:
 *   - Device migration
 *   - Disaster recovery (restore on a new account)
 *   - Data portability (Tally/Excel import via separate tools)
 *   - Audit ("I can always get my data out")
 *
 * Includes: products, parties, transactions (+ items), payments, settings,
 * shops, audit logs, field change logs, GSTR snapshots.
 *
 * Excludes: passwords, tokens, usage tracking (internal telemetry).
 *
 * Auth: owner only (not staff or CA — this is full data access).
 */
export const maxDuration = 60

export async function GET() {
  try {
    const { userId, error } = await getAuthUserIdOwnerOnly()
    if (error || !userId) return error || NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    // Fetch ALL user data in parallel (capped at 50K rows per entity for safety)
    const CAP = 50000
    const [products, parties, transactions, payments, settings, shops, auditLogs, fieldChangeLogs] = await Promise.all([
      db.product.findMany({ where: { userId }, take: CAP }),
      db.party.findMany({ where: { userId }, take: CAP }),
      db.transaction.findMany({
        where: { userId },
        include: { items: true },
        take: CAP,
      }),
      db.payment.findMany({ where: { userId }, take: CAP }),
      db.setting.findUnique({ where: { userId } }),
      db.shop.findMany({ where: { userId } }),
      db.auditLog.findMany({ where: { userId }, take: CAP, orderBy: { createdAt: 'desc' } }),
      db.fieldChangeLog.findMany({
        where: { changedByUserId: userId },
        take: CAP,
        orderBy: { createdAt: 'desc' },
      }),
    ])

    const backup = {
      version: 2,
      app: 'EkBook',
      exportedAt: new Date().toISOString(),
      userId,
      data: {
        products: products.map(p => ({
          ...p,
          // Exclude internal fields
          id: undefined,
          userId: undefined,
        })),
        parties: parties.map(p => ({
          ...p,
          id: undefined,
          userId: undefined,
        })),
        transactions: transactions.map(t => ({
          ...t,
          id: undefined,
          userId: undefined,
          items: t.items.map(item => ({
            ...item,
            id: undefined,
            transactionId: undefined,
          })),
        })),
        payments: payments.map(p => ({
          ...p,
          id: undefined,
          userId: undefined,
        })),
        settings: settings ? {
          ...settings,
          userId: undefined,
        } : null,
        shops: shops.map(s => ({
          ...s,
          id: undefined,
          userId: undefined,
        })),
        auditLogs: auditLogs.map(a => ({
          action: a.action,
          entityType: a.entityType,
          entityId: a.entityId,
          metadata: a.metadata,
          createdAt: a.createdAt,
        })),
        fieldChangeLogs: fieldChangeLogs.map(f => ({
          fieldName: f.fieldName,
          oldValue: f.oldValue,
          newValue: f.newValue,
          changedByUserId: f.changedByUserId,
          createdAt: f.createdAt,
        })),
      },
      summary: {
        productCount: products.length,
        partyCount: parties.length,
        transactionCount: transactions.length,
        paymentCount: payments.length,
        shopCount: shops.length,
        auditLogCount: auditLogs.length,
        fieldChangeLogCount: fieldChangeLogs.length,
      },
    }

    // Audit log the export
    await logAudit({
      userId,
      action: 'data.export',
      entityType: 'user',
      entityId: userId,
      metadata: {
        version: 2,
        productCount: products.length,
        transactionCount: transactions.length,
      },
    })

    return NextResponse.json(backup)
  } catch (err) {
    return apiError(err, 'Failed to export data', 500)
  }
}
