-- CreateTable: Add estimate conversion tracking fields to Transaction
-- 🔒 V26 F1: When an estimate is converted to a sale, these fields track
-- which sale it became and when. Prevents unlimited re-conversion.

ALTER TABLE "Transaction" ADD COLUMN "convertedToTransactionId" TEXT;
ALTER TABLE "Transaction" ADD COLUMN "convertedAt" TIMESTAMP(3);
