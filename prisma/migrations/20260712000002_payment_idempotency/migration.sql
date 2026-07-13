-- V19-007: Add clientMutationId to Payment for idempotency
-- Prevents duplicate payments from offline sync replays.
ALTER TABLE "Payment" ADD COLUMN "clientMutationId" TEXT;
CREATE UNIQUE INDEX "Payment_clientMutationId_key" ON "Payment"("clientMutationId");
