-- CreateTable: Add password-reset fields to AdminUser
-- 🔒 V26 A1/N1: The admin app's forgot-password route stores SHA-256 token
-- hashes + expiry here. The main app owns this migration (it migrates the
-- shared DB on deploy). The admin app mirrors the schema for client types
-- but must NOT db push.

ALTER TABLE "AdminUser" ADD COLUMN "passwordResetTokenHash" TEXT;
ALTER TABLE "AdminUser" ADD COLUMN "passwordResetExpiresAt" TIMESTAMP(3);
