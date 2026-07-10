-- Credit/Debit Notes Step 1: Add fields to Transaction + InvoiceCounter
-- V17-Ext Tier 3: GST-correct credit/debit notes instead of editing filed invoices.
-- Idempotent. All statements use valid PostgreSQL syntax.

ALTER TABLE "Transaction" ADD COLUMN IF NOT EXISTS "originalTransactionId" TEXT;
ALTER TABLE "Transaction" ADD COLUMN IF NOT EXISTS "noteType" TEXT;
ALTER TABLE "Transaction" ADD COLUMN IF NOT EXISTS "noteReason" TEXT;
ALTER TABLE "Transaction" ADD COLUMN IF NOT EXISTS "affectsStock" BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS "Transaction_originalTransactionId_idx"
    ON "Transaction" ("originalTransactionId")
    WHERE "originalTransactionId" IS NOT NULL;

ALTER TABLE "InvoiceCounter" ADD COLUMN IF NOT EXISTS "creditNoteSeq" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "InvoiceCounter" ADD COLUMN IF NOT EXISTS "debitNoteSeq" INTEGER NOT NULL DEFAULT 0;
