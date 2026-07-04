-- Migration: Add deletedAt to Transaction + Party for soft delete
-- Audit fix M7: Ledger records should not be hard-deleted (GST/tax/disputes)
--
-- Adds a nullable deletedAt column. When set, the record is considered
-- "deleted" but remains in the database for audit/compliance.
-- All queries must filter WHERE deletedAt IS NULL to exclude soft-deleted records.

ALTER TABLE "Transaction" ADD COLUMN "deletedAt" TIMESTAMP(3);
ALTER TABLE "Party" ADD COLUMN "deletedAt" TIMESTAMP(3);
