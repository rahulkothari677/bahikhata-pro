-- Migration: Add PasswordResetToken table
-- Audit fix C1+C2: Move reset tokens from in-memory Map to DB with hashed tokens
--
-- Stores SHA-256 hash of reset tokens (never raw tokens) so password reset
-- works reliably on serverless (shared across instances, survives cold starts)
-- and is secure (only the hash is stored).
--
-- Token is single-use (usedAt is set on consumption), expires after 1 hour.

CREATE TABLE "PasswordResetToken" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PasswordResetToken_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PasswordResetToken_tokenHash_key" ON "PasswordResetToken"("tokenHash");
CREATE INDEX "PasswordResetToken_email_expiresAt_idx" ON "PasswordResetToken"("email", "expiresAt");
CREATE INDEX "PasswordResetToken_tokenHash_idx" ON "PasswordResetToken"("tokenHash");
