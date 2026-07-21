-- 🔒 V26 Phase 8 DI-1: Add purchaseSeq to InvoiceCounter.
-- Purchases were using the sales counter (seq), producing INV-XXXX numbers
-- that ate gaps in the GST sales invoice series. Now purchases get their own
-- PUR-XXXX series, mirroring the credit-note (CN-) and debit-note (DN-) pattern.
-- Idempotent: ADD COLUMN IF NOT EXISTS.
ALTER TABLE "InvoiceCounter" ADD COLUMN IF NOT EXISTS "purchaseSeq" INTEGER NOT NULL DEFAULT 0;
