-- Migration: Add invoiceSequence + unique constraint on (userId, invoiceNo)
-- Audit fix M6: GST-compliant invoice numbering
--
-- Adds an invoiceSequence column for auto-generated sequential invoice numbers
-- per user. Adds a unique constraint on (userId, invoiceNo) so no two
-- transactions for the same user can share the same invoice number.
--
-- Note: the unique constraint only applies where invoiceNo is NOT NULL.
-- NULL values are allowed (multiple transactions can have NULL invoiceNo).
-- This is standard SQL behavior — NULL != NULL in unique constraints.

ALTER TABLE "Transaction" ADD COLUMN "invoiceSequence" INTEGER;

-- Create unique index on (userId, invoiceNo) — only applies to non-NULL invoiceNo
CREATE UNIQUE INDEX "Transaction_userId_invoiceNo_key" ON "Transaction"("userId", "invoiceNo") WHERE "invoiceNo" IS NOT NULL;
