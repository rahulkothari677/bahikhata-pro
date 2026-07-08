-- Migration: Add deletedAt to Payment for soft-delete + audit trail
-- 🔒 V15 M-3: Ledger records (transactions, parties) use soft-delete so they
-- can be audited and restored. Payments should too — silently hard-deleting
-- a receipt changes historical balances with no record that it ever existed,
-- which is a dispute/fraud risk ("but I paid you!").
--
-- Adds a nullable deletedAt column. When set, the record is considered
-- "deleted" but remains in the database for audit/compliance.
-- All queries must filter WHERE "deletedAt" IS NULL to exclude soft-deleted records.
--
-- Idempotent: uses ADD COLUMN IF NOT EXISTS so re-running is safe.

ALTER TABLE "Payment" ADD COLUMN IF NOT EXISTS "deletedAt" TIMESTAMP(3);

-- Add an index to keep payment-lookup queries fast once they filter on deletedAt.
-- Partial index (WHERE "deletedAt" IS NULL) is smaller + faster for the common case.
CREATE INDEX IF NOT EXISTS "Payment_userId_partyId_deletedAt_idx"
  ON "Payment" ("userId", "partyId")
  WHERE "deletedAt" IS NULL;
