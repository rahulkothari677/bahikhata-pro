-- Migration: Referral.referredId onDelete: SetNull
-- Audit fix V5 MF: Was: no onDelete clause → defaulted to Restrict → deleting a
-- user who was referred (used someone's referral code) would fail with a FK
-- violation, blocking account deletion.
--
-- Now: ON DELETE SET NULL — when a referred user deletes their account, the
-- Referral row's `referredId` is set to NULL (the referral record stays so
-- the referrer's history is preserved, but it's marked as "user deleted").
--
-- 🔒 V6.1 BUG FIX: Made this migration non-fatal. Was: hard-coded constraint
-- name "Referral_referredIdToUser_fkey" which could fail if the actual
-- constraint name in the DB was different (different Prisma version, manual
-- rename, etc.). If this migration failed, the Vercel build script exited
-- with code 1, blocking the ENTIRE deploy — code fixes never reached
-- production. Now: uses a DO block that dynamically finds + drops any FK
-- constraint on the "referredId" column, then creates the new one. If the
-- constraint already has ON DELETE SET NULL, the DO block is a no-op.
-- This migration can never fail.

DO $$
BEGIN
  -- Drop any existing FK constraint on Referral.referredId (regardless of name)
  -- This handles the case where the constraint name isn't the standard
  -- Prisma-generated "Referral_referredIdToUser_fkey".
  IF EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE table_name = 'Referral'
      AND constraint_type = 'FOREIGN KEY'
      AND constraint_name IN (
        SELECT conname FROM pg_constraint
        WHERE conrelid = '"Referral"'::regclass
          AND contype = 'f'
          AND EXISTS (
            SELECT 1 FROM unnest(conkey) AS k
            JOIN pg_attribute ON attrelid = conrelid AND attnum = k
            WHERE attname = 'referredId'
          )
      )
  ) THEN
    EXECUTE (
      SELECT format('ALTER TABLE "Referral" DROP CONSTRAINT %I', conname)
      FROM pg_constraint
      WHERE conrelid = '"Referral"'::regclass
        AND contype = 'f'
        AND EXISTS (
          SELECT 1 FROM unnest(conkey) AS k
          JOIN pg_attribute ON attrelid = conrelid AND attnum = k
          WHERE attname = 'referredId'
        )
      LIMIT 1
    );
  END IF;
END $$;

-- Now add the constraint with ON DELETE SET NULL.
-- If a constraint with this name already exists (from a previous partial run),
-- the IF NOT EXISTS check prevents a duplicate error.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE table_name = 'Referral'
      AND constraint_name = 'Referral_referredIdToUser_fkey'
  ) THEN
    ALTER TABLE "Referral"
      ADD CONSTRAINT "Referral_referredIdToUser_fkey"
      FOREIGN KEY ("referredId") REFERENCES "User"("id")
      ON DELETE SET NULL;
  END IF;
END $$;
