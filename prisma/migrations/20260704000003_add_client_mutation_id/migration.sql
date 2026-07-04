-- Migration: Add clientMutationId to Transaction for offline idempotency
-- Audit fix N1: Prevents duplicate transactions from offline sync replays
--
-- When a merchant records a sale offline, the request is queued. If the
-- network flickers and both the original request AND the queue replay go
-- through, the sale would be recorded twice. This column stores a
-- client-generated UUID that the server uses to deduplicate — if a
-- transaction with the same clientMutationId already exists, the server
-- returns the existing one instead of creating a duplicate.
--
-- Nullable because existing transactions (created before this fix) don't
-- have a clientMutationId. New transactions will always have one.
-- @unique constraint enforces deduplication at the database level.

ALTER TABLE "Transaction" ADD COLUMN "clientMutationId" TEXT;
CREATE UNIQUE INDEX "Transaction_clientMutationId_key" ON "Transaction"("clientMutationId");
