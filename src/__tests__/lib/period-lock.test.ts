/**
 * 🔒 V17-Ext §5.1 — Period lock tests.
 *
 * Tests the assertPeriodNotLocked helper + PeriodLockedError class.
 * Uses jest.spyOn on the real db object (same approach as the behavioral
 * balance reconciliation test) — sets a dummy DATABASE_URL so PrismaClient
 * doesn't throw on instantiation, then mocks db.setting.findUnique to return
 * fixture data.
 *
 * Covers:
 *   - No lock set (lockedUntil null) → all writes allowed
 *   - No setting record → all writes allowed (treated as unlocked)
 *   - Date before lock → blocked with PeriodLockedError
 *   - Date exactly on lock boundary → blocked (inclusive)
 *   - Date after lock → allowed
 *   - Invalid date input → allowed (defensive, let downstream validation handle)
 *   - Error message contains the lock date + attempted date
 *   - getPeriodLockStatus returns correct state
 */

// Set dummy DATABASE_URL BEFORE any imports — PrismaClient validates the URL
// format at instantiation time.
process.env.DATABASE_URL = 'postgresql://dummy:dummy@localhost:5432/dummy'
process.env.DIRECT_URL = 'postgresql://dummy:dummy@localhost:5432/dummy'

import { jest } from '@jest/globals'
import { db } from '@/lib/db'
import {
  assertPeriodNotLocked,
  getPeriodLockStatus,
  PeriodLockedError,
} from '@/lib/period-lock'

const USER_ID = 'user1'
const LOCK_DATE = new Date('2026-03-31T23:59:59.999Z')

describe('🔒 V17-Ext §5.1 — Period lock', () => {
  afterEach(() => {
    jest.restoreAllMocks()
  })

  describe('assertPeriodNotLocked', () => {
    it('allows all writes when no lock is set (lockedUntil is null)', async () => {
      jest.spyOn(db.setting, 'findUnique').mockResolvedValue({
        lockedUntil: null,
      } as any)

      // A date before the (non-existent) lock should still pass
      await expect(
        assertPeriodNotLocked(USER_ID, '2026-01-01'),
      ).resolves.toBeUndefined()
    })

    it('allows all writes when no setting record exists', async () => {
      jest.spyOn(db.setting, 'findUnique').mockResolvedValue(null as any)

      await expect(
        assertPeriodNotLocked(USER_ID, '2026-01-01'),
      ).resolves.toBeUndefined()
    })

    it('🔒 blocks a write dated BEFORE the lock date', async () => {
      jest.spyOn(db.setting, 'findUnique').mockResolvedValue({
        lockedUntil: LOCK_DATE,
      } as any)

      // Jan 15 is before March 31 → blocked
      await expect(
        assertPeriodNotLocked(USER_ID, '2026-01-15'),
      ).rejects.toThrow(PeriodLockedError)
    })

    it('🔒 blocks a write dated EXACTLY ON the lock date (inclusive)', async () => {
      jest.spyOn(db.setting, 'findUnique').mockResolvedValue({
        lockedUntil: LOCK_DATE,
      } as any)

      // March 31 (same as lock) → blocked (inclusive comparison: date <= lockedUntil)
      await expect(
        assertPeriodNotLocked(USER_ID, '2026-03-31'),
      ).rejects.toThrow(PeriodLockedError)
    })

    it('allows a write dated AFTER the lock date', async () => {
      jest.spyOn(db.setting, 'findUnique').mockResolvedValue({
        lockedUntil: LOCK_DATE,
      } as any)

      // April 1 is after March 31 → allowed
      await expect(
        assertPeriodNotLocked(USER_ID, '2026-04-01'),
      ).resolves.toBeUndefined()
    })

    it('allows a write dated today when lock is in the past', async () => {
      jest.spyOn(db.setting, 'findUnique').mockResolvedValue({
        lockedUntil: LOCK_DATE,
      } as any)

      // Today (July 2026) is after March 31 → allowed
      await expect(
        assertPeriodNotLocked(USER_ID, new Date()),
      ).resolves.toBeUndefined()
    })

    it('defensively allows writes when the date is invalid (NaN)', async () => {
      jest.spyOn(db.setting, 'findUnique').mockResolvedValue({
        lockedUntil: LOCK_DATE,
      } as any)

      // Invalid date — don't block (let downstream validation handle it).
      // Blocking on NaN could accidentally lock users out if a date parsing
      // bug elsewhere sends a bad value.
      await expect(
        assertPeriodNotLocked(USER_ID, 'not-a-date'),
      ).resolves.toBeUndefined()
    })

    it('accepts Date objects, ISO strings, and date-only strings', async () => {
      jest.spyOn(db.setting, 'findUnique').mockResolvedValue({
        lockedUntil: null,
      } as any)

      // All three formats should work without throwing
      await expect(assertPeriodNotLocked(USER_ID, new Date('2026-01-01'))).resolves.toBeUndefined()
      await expect(assertPeriodNotLocked(USER_ID, '2026-01-01T00:00:00.000Z')).resolves.toBeUndefined()
      await expect(assertPeriodNotLocked(USER_ID, '2026-01-01')).resolves.toBeUndefined()
    })
  })

  describe('PeriodLockedError', () => {
    it('has the correct error code', async () => {
      jest.spyOn(db.setting, 'findUnique').mockResolvedValue({
        lockedUntil: LOCK_DATE,
      } as any)

      try {
        await assertPeriodNotLocked(USER_ID, '2026-01-15')
        fail('Should have thrown')
      } catch (e) {
        expect(e).toBeInstanceOf(PeriodLockedError)
        expect((e as PeriodLockedError).code).toBe('PERIOD_LOCKED')
      }
    })

    it('contains the lock date and attempted date in the message', async () => {
      jest.spyOn(db.setting, 'findUnique').mockResolvedValue({
        lockedUntil: LOCK_DATE,
      } as any)

      try {
        await assertPeriodNotLocked(USER_ID, '2026-01-15')
        fail('Should have thrown')
      } catch (e) {
        expect(e).toBeInstanceOf(PeriodLockedError)
        const msg = (e as Error).message
        // Message should mention the lock date (March 31)
        expect(msg).toMatch(/31.*Mar.*2026|Mar.*31.*2026/)
        // Message should mention the attempted date (January 15)
        expect(msg).toMatch(/15.*Jan.*2026|Jan.*15.*2026/)
        // Message should mention how to unlock
        expect(msg).toMatch(/Settings/i)
        expect(msg).toMatch(/unlock/i)
      }
    })

    it('stores lockedUntil and attemptedDate on the error instance', async () => {
      jest.spyOn(db.setting, 'findUnique').mockResolvedValue({
        lockedUntil: LOCK_DATE,
      } as any)

      const attemptedDate = new Date('2026-01-15')
      try {
        await assertPeriodNotLocked(USER_ID, attemptedDate)
        fail('Should have thrown')
      } catch (e) {
        expect(e).toBeInstanceOf(PeriodLockedError)
        const err = e as PeriodLockedError
        expect(err.lockedUntil).toEqual(LOCK_DATE)
        expect(err.attemptedDate.getTime()).toBe(attemptedDate.getTime())
      }
    })
  })

  describe('getPeriodLockStatus', () => {
    it('returns locked: false when lockedUntil is null', async () => {
      jest.spyOn(db.setting, 'findUnique').mockResolvedValue({
        lockedUntil: null,
      } as any)

      const status = await getPeriodLockStatus(USER_ID)
      expect(status.locked).toBe(false)
      expect(status.lockedUntil).toBeNull()
    })

    it('returns locked: false when no setting record exists', async () => {
      jest.spyOn(db.setting, 'findUnique').mockResolvedValue(null as any)

      const status = await getPeriodLockStatus(USER_ID)
      expect(status.locked).toBe(false)
      expect(status.lockedUntil).toBeNull()
    })

    it('returns locked: true with the date when a lock is set', async () => {
      jest.spyOn(db.setting, 'findUnique').mockResolvedValue({
        lockedUntil: LOCK_DATE,
      } as any)

      const status = await getPeriodLockStatus(USER_ID)
      expect(status.locked).toBe(true)
      expect(status.lockedUntil).toEqual(LOCK_DATE)
    })
  })

  describe('🔒 Reconciliation: the lock boundary is inclusive (date <= lockedUntil)', () => {
    // These tests document the inclusive-boundary decision so it's not
    // accidentally changed. The UI's persistPeriodLock function sets the lock
    // to END-OF-DAY (e.g. "2026-03-31T23:59:59.999Z") so the entire day of
    // March 31 is locked. These tests verify that boundary behavior.
    it('a transaction at 23:59:59.999 on the lock date is blocked (lock is end-of-day)', async () => {
      // Lock set to end-of-day March 31 (what the UI sends)
      jest.spyOn(db.setting, 'findUnique').mockResolvedValue({
        lockedUntil: new Date('2026-03-31T23:59:59.999Z'),
      } as any)

      // A transaction at 23:59:59.999 on March 31 is == lockedUntil → blocked (inclusive)
      await expect(
        assertPeriodNotLocked(USER_ID, '2026-03-31T23:59:59.999Z'),
      ).rejects.toThrow(PeriodLockedError)
    })

    it('a transaction at 00:00:00.000 the day AFTER the lock is allowed', async () => {
      jest.spyOn(db.setting, 'findUnique').mockResolvedValue({
        lockedUntil: new Date('2026-03-31T23:59:59.999Z'),
      } as any)

      await expect(
        assertPeriodNotLocked(USER_ID, '2026-04-01T00:00:00.000Z'),
      ).resolves.toBeUndefined()
    })

    it('a transaction at noon on the lock date is blocked (lock is end-of-day)', async () => {
      // Lock set to end-of-day March 31
      jest.spyOn(db.setting, 'findUnique').mockResolvedValue({
        lockedUntil: new Date('2026-03-31T23:59:59.999Z'),
      } as any)

      // A transaction at noon on March 31 is < lockedUntil → blocked
      await expect(
        assertPeriodNotLocked(USER_ID, '2026-03-31T12:00:00.000Z'),
      ).rejects.toThrow(PeriodLockedError)
    })
  })
})
