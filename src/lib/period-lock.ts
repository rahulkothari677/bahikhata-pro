/**
 * 🔒 V17-Ext §5.1: Period lock (financial-year lock) helper.
 *
 * Once a shopkeeper files GST for a period, that period must become read-only.
 * Without this, any past transaction is editable forever — a compliance and
 * dispute time-bomb. The lock is a single date on the shop's Setting record:
 * `lockedUntil`. When set, NO writes (create/edit/delete/restore) are allowed
 * to transactions or payments dated on or before `lockedUntil`.
 *
 * Design decisions:
 *   - The lock is per-shop (lives on Setting, one per user). Each shop owner
 *     controls their own lock. Staff cannot set or remove the lock (gated by
 *     canAccessModule('settings') in the settings PUT route).
 *   - The owner CAN unlock (set lockedUntil back to null). They're the boss.
 *     The lock is a protection against accidental edits + staff fraud, not a
 *     hard irreversible commit. (A future "filed GST" status could make it
 *     truly irreversible, but that's out of scope for now.)
 *   - The comparison is `date <= lockedUntil` (inclusive). If you lock until
 *     March 31, a transaction dated March 31 is also locked.
 *   - The lock applies to the TRANSACTION/PAYMENT DATE, not the current date.
 *     A backdated transaction (dated last month, entered today) is blocked if
 *     last month is locked.
 *
 * Usage in route handlers:
 *   import { assertPeriodNotLocked, PeriodLockedError } from '@/lib/period-lock'
 *
 *   // Before any write:
 *   try {
 *     await assertPeriodNotLocked(userId, transactionDate)
 *   } catch (e) {
 *     if (e instanceof PeriodLockedError) {
 *       return NextResponse.json({ error: e.message }, { status: 403 })
 *     }
 *     throw e
 *   }
 *
 * The error has a clear, user-facing message with the lock date so the
 * shopkeeper knows exactly why the operation was blocked.
 */

import { db } from '@/lib/db'

/**
 * Custom error class for period-lock violations. Route handlers catch this
 * and return a 403 with the message. Other errors (DB failures, etc.) bubble
 * up to the generic apiError handler.
 */
export class PeriodLockedError extends Error {
  code = 'PERIOD_LOCKED' as const
  lockedUntil: Date
  attemptedDate: Date

  constructor(lockedUntil: Date, attemptedDate: Date) {
    const lockStr = lockedUntil.toLocaleDateString('en-IN', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
    })
    const dateStr = attemptedDate.toLocaleDateString('en-IN', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
    })
    super(
      `This period is locked. Transactions dated on or before ${lockStr} cannot be edited, deleted, or created. ` +
      `The attempted date was ${dateStr}. ` +
      `To make changes, the shop owner must unlock the period in Settings → Period Lock.`
    )
    this.name = 'PeriodLockedError'
    this.lockedUntil = lockedUntil
    this.attemptedDate = attemptedDate
  }
}

/**
 * Assert that a write to a transaction/payment dated `date` is allowed.
 * Throws PeriodLockedError if the period is locked (date <= lockedUntil).
 * Does nothing if no lock is set (lockedUntil is null) or if the date is
 * after the lock.
 *
 * @param userId  The shop owner's user ID (for looking up their Setting).
 * @param date    The date of the transaction/payment being written.
 *
 * @throws PeriodLockedError if the period is locked.
 * @throws (any) on DB error — caller should let these bubble to apiError.
 */
export async function assertPeriodNotLocked(
  userId: string,
  date: Date | string,
): Promise<void> {
  // Look up the shop's lock setting. Single PK lookup on Setting (~1-2ms).
  // We only need lockedUntil — use select to keep the payload tiny.
  const setting = await db.setting.findUnique({
    where: { userId },
    select: { lockedUntil: true },
  })

  // No setting record = no lock configured (treat as unlocked).
  // lockedUntil null = explicitly unlocked.
  if (!setting?.lockedUntil) return

  const lockedUntilDate = setting.lockedUntil
  const attemptedDate = new Date(date)

  // Defensive: if the caller passed an invalid date, don't block the write
  // (let the downstream validation handle it). Blocking on NaN could
  // accidentally lock users out of legitimate operations if a date parsing
  // bug elsewhere sends a bad value.
  if (isNaN(attemptedDate.getTime())) return

  // 🔒 The lock is inclusive: date <= lockedUntil means locked.
  // A transaction dated exactly on the lock boundary is also locked.
  if (attemptedDate <= lockedUntilDate) {
    throw new PeriodLockedError(lockedUntilDate, attemptedDate)
  }
}

/**
 * Get the shop's current lock status (for display in the UI).
 * Returns { locked: boolean, lockedUntil: Date | null }.
 */
export async function getPeriodLockStatus(
  userId: string,
): Promise<{ locked: boolean; lockedUntil: Date | null }> {
  const setting = await db.setting.findUnique({
    where: { userId },
    select: { lockedUntil: true },
  })
  return {
    locked: !!setting?.lockedUntil,
    lockedUntil: setting?.lockedUntil ?? null,
  }
}
