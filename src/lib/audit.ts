/**
 * Audit logging utility.
 *
 * Log every important action for security forensics and compliance (DPDP Act).
 * Uses fire-and-forget pattern — never blocks the main request flow.
 *
 * Usage:
 *   import { logAudit } from '@/lib/audit'
 *   await logAudit({
 *     userId,
 *     action: 'transaction.create',
 *     entityType: 'transaction',
 *     entityId: txn.id,
 *     req,                  // for IP + userAgent
 *     metadata: { type: 'sale', totalAmount: txn.totalAmount },
 *   })
 */

import { db } from '@/lib/db'

interface AuditLogInput {
  userId?: string | null
  action: string
  entityType?: string
  entityId?: string
  req?: Request | any
  metadata?: any
}

export async function logAudit(input: AuditLogInput): Promise<void> {
  try {
    let ip: string | null = null
    let userAgent: string | null = null

    if (input.req) {
      const headers = input.req.headers instanceof Headers
        ? input.req.headers
        : new Headers(input.req.headers || {})
      const forwarded = headers.get('x-forwarded-for')
      ip = forwarded ? forwarded.split(',')[0].trim() : headers.get('x-real-ip')
      userAgent = headers.get('user-agent')
    }

    await db.auditLog.create({
      data: {
        userId: input.userId || null,
        action: input.action,
        entityType: input.entityType || null,
        entityId: input.entityId || null,
        ip,
        userAgent,
        metadata: input.metadata || undefined,
      },
    })
  } catch (error) {
    // Never throw on audit log failure — it must not block the main operation
    console.error('[audit] Failed to log:', input.action, error)
  }
}

/**
 * Standard action names (for consistency across the codebase).
 */
export const AUDIT_ACTIONS = {
  // Auth
  LOGIN_SUCCESS: 'auth.login.success',
  LOGIN_FAILURE: 'auth.login.failure',
  LOGOUT: 'auth.logout',
  SIGNUP: 'auth.signup',

  // Data mutations
  PRODUCT_CREATE: 'product.create',
  PRODUCT_UPDATE: 'product.update',
  PRODUCT_DELETE: 'product.delete',
  PARTY_CREATE: 'party.create',
  PARTY_UPDATE: 'party.update',
  PARTY_DELETE: 'party.delete',
  TRANSACTION_CREATE: 'transaction.create',
  TRANSACTION_UPDATE: 'transaction.update',
  TRANSACTION_DELETE: 'transaction.delete',
  SETTINGS_UPDATE: 'settings.update',

  // Sensitive operations
  DATA_EXPORT: 'data.export',
  DATA_RESET: 'data.reset',
  STAFF_CREATE: 'staff.create',
  STAFF_DELETE: 'staff.delete',
  ROLE_CHANGE: 'role.change',

  // AI usage
  AI_SCAN: 'ai.scan_bill',
  AI_VOICE: 'ai.voice_parse',
} as const
