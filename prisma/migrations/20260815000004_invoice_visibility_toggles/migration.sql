-- Phase 4: what else the shop chooses to print on its bill.
--
-- Additive only. Four boolean columns, every one defaulting to false, so an
-- existing shop's invoice is byte-for-byte what it was before this ran.
--
-- The list these columns store answers for lives in
-- src/lib/invoice-visibility.ts. A test proves the two stay in step.

ALTER TABLE "Setting" ADD COLUMN IF NOT EXISTS "showPartyBalance"    BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Setting" ADD COLUMN IF NOT EXISTS "showItemDescription" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Setting" ADD COLUMN IF NOT EXISTS "showAlternateUnit"   BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Setting" ADD COLUMN IF NOT EXISTS "showInvoiceTime"     BOOLEAN NOT NULL DEFAULT false;
