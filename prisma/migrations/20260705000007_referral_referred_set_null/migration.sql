-- Migration: Referral.referredId onDelete: SetNull
-- Audit fix V5 MF: Was: no onDelete clause → defaulted to Restrict → deleting a
-- user who was referred (used someone's referral code) would fail with a FK
-- violation, blocking account deletion.
--
-- Now: ON DELETE SET NULL — when a referred user deletes their account, the
-- Referral row's `referredId` is set to NULL (the referral record stays so
-- the referrer's history is preserved, but it's marked as "user deleted").
--
-- This is a one-line ALTER TABLE on the FK constraint.
-- Prisma can't auto-generate this because it requires dropping + recreating
-- the FK constraint with the new ON DELETE behavior.

-- Drop the existing FK constraint (name varies by Prisma version, so we use
-- the standard Prisma-generated name pattern).
ALTER TABLE "Referral" DROP CONSTRAINT IF EXISTS "Referral_referredIdToUser_fkey";

-- Recreate with ON DELETE SET NULL.
-- Note: referredId is already nullable (String?), so SET NULL is allowed.
ALTER TABLE "Referral"
  ADD CONSTRAINT "Referral_referredIdToUser_fkey"
  FOREIGN KEY ("referredId") REFERENCES "User"("id")
  ON DELETE SET NULL;
