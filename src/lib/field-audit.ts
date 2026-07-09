/**
 * V17-Ext 5.1: Per-field audit trail helper.
 *
 * Every edit to a transaction/payment records who changed what field from
 * what to what. This lets you (and a court, or a CA) reconstruct what the
 * books said at any point in time. It's also your fraud defense against a
 * rogue staff member.
 *
 * Usage:
 *   import { logFieldChanges } from '@/lib/field-audit'
 *
 *   // After fetching the old record, before/after the DB update:
 *   await logFieldChanges({
 *     userId,
 *     entityType: 'transaction',
 *     entityId: id,
 *     oldValues: existing,       // the DB record before the edit
 *     newValues: updated,        // the DB record after the edit
 *     fieldsToTrack: TRACKED_TRANSACTION_FIELDS,
 *     changedByUserId: authCtx.actingUserId,
 *   })
 *
 * The helper diffs each field in `fieldsToTrack` between old and new.
 * For each changed field, it creates a FieldChangeLog row with the old
 * and new values (JSON-serialized for storage). Fire-and-forget — never
 * throws (same pattern as logAudit in src/lib/audit.ts).
 *
 * Design decisions:
 *   - Values are stored as TEXT (JSON-serialized), not typed columns. This
 *     handles numbers, strings, dates, and null uniformly. The UI
 *     deserializes for display.
 *   - changedByUserId is a plain String (no FK) to avoid modifying the User
 *     model. It captures who made the change (owner or staff).
 *   - Items are NOT tracked per-field (too granular). Instead, a single
 *     "items" field change is logged with a summary like "3 items -> 4 items".
 *   - The helper is fire-and-forget: it never throws, so a logging failure
 *     doesn't block the main operation (same as logAudit).
 */

import { db } from '@/lib/db'

/**
 * The money-critical fields to track on transaction edits.
 * These are the fields a CA or auditor would care about — changes to these
 * affect the financial picture. We deliberately DON'T track internal fields
 * like updatedAt, clientMutationId, or invoiceSequence.
 */
export const TRACKED_TRANSACTION_FIELDS = [
  'totalAmount',
  'subtotal',
  'discountAmount',
  'paidAmount',
  'cgst',
  'sgst',
  'igst',
  'roundOff',
  'grossProfit',
  'date',
  'type',
  'partyId',
  'paymentMode',
  'notes',
  'invoiceNo',
] as const

/**
 * The fields to track on payment edits (if we add a payment PUT in the future).
 * Currently payments can only be created or soft-deleted, not edited — but
 * this is here for future use.
 */
export const TRACKED_PAYMENT_FIELDS = [
  'amount',
  'type',
  'mode',
  'date',
  'notes',
] as const

interface LogFieldChangesInput {
  userId: string
  entityType: 'transaction' | 'payment'
  entityId: string
  oldValues: Record<string, any>
  newValues: Record<string, any>
  fieldsToTrack: readonly string[]
  changedByUserId?: string | null
}

/**
 * Compare old and new values for each tracked field, and create a
 * FieldChangeLog row for each field that changed.
 *
 * Values are serialized to JSON for storage. Dates are converted to ISO
 * strings. null and undefined are both stored as null.
 *
 * Fire-and-forget: logs errors to console but never throws.
 */
export async function logFieldChanges(input: LogFieldChangesInput): Promise<void> {
  try {
    const changes: Array<{
      userId: string
      entityType: string
      entityId: string
      fieldName: string
      oldValue: string | null
      newValue: string | null
      changedByUserId: string | null
    }> = []

    for (const field of input.fieldsToTrack) {
      const oldVal = serializeValue(input.oldValues[field])
      const newVal = serializeValue(input.newValues[field])

      // Only log if the value actually changed
      if (oldVal !== newVal) {
        changes.push({
          userId: input.userId,
          entityType: input.entityType,
          entityId: input.entityId,
          fieldName: field,
          oldValue: oldVal,
          newValue: newVal,
          changedByUserId: input.changedByUserId || null,
        })
      }
    }

    if (changes.length === 0) return // no changes detected

    // Batch insert all changes in one query
    await db.fieldChangeLog.createMany({
      data: changes,
    })
  } catch (error) {
    // Never throw on audit log failure — must not block the main operation
    console.error('[field-audit] Failed to log changes:', error)
  }
}

/**
 * Serialize a value for storage in the oldValue/newValue TEXT column.
 * - Dates → ISO string
 * - null/undefined → null (stored as SQL NULL)
 * - Numbers/strings/booleans → JSON.stringify (preserves type on deserialize)
 * - Objects → JSON.stringify
 */
function serializeValue(value: any): string | null {
  if (value === null || value === undefined) return null
  if (value instanceof Date) return JSON.stringify(value.toISOString())
  return JSON.stringify(value)
}

/**
 * Deserialize a value from the oldValue/newValue TEXT column for display.
 * Returns the original type (number, string, Date, boolean, null).
 */
export function deserializeValue(stored: string | null): any {
  if (stored === null) return null
  try {
    const parsed = JSON.parse(stored)
    // If it's an ISO date string, convert back to Date
    if (typeof parsed === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(parsed)) {
      return new Date(parsed)
    }
    return parsed
  } catch {
    return stored // fallback: return as-is
  }
}

/**
 * Get the audit trail for a specific entity (transaction or payment).
 * Returns changes newest-first (most recent edit on top).
 */
export async function getEntityAuditTrail(
  userId: string,
  entityType: string,
  entityId: string,
): Promise<Array<{
  id: string
  fieldName: string
  oldValue: string | null
  newValue: string | null
  changedByUserId: string | null
  createdAt: Date
}>> {
  return db.fieldChangeLog.findMany({
    where: { userId, entityType, entityId },
    orderBy: { createdAt: 'desc' },
    take: 200, // cap at 200 entries for UI performance
  })
}
