-- V17 Audit Phase 3: gstTreatment on Product + CDN columns on GstReturn

-- 4.2: Add gstTreatment to Product (taxable | nil | exempt | nonGst)
-- Default 'taxable' so existing products keep their current behavior.
-- Used by GSTR-3B 3.1(c) to break out nil-rated vs exempt vs non-GST outward.
ALTER TABLE "Product" ADD COLUMN IF NOT EXISTS "gstTreatment" TEXT NOT NULL DEFAULT 'taxable';

-- 4.3: Add Credit/Debit Note breakdown columns to GstReturn
-- These are computed at file time but weren't stored. Now persisted for audit.
ALTER TABLE "GstReturn" ADD COLUMN IF NOT EXISTS "creditNoteTaxableValue" DOUBLE PRECISION NOT NULL DEFAULT 0;
ALTER TABLE "GstReturn" ADD COLUMN IF NOT EXISTS "creditNoteCgst" DOUBLE PRECISION NOT NULL DEFAULT 0;
ALTER TABLE "GstReturn" ADD COLUMN IF NOT EXISTS "creditNoteSgst" DOUBLE PRECISION NOT NULL DEFAULT 0;
ALTER TABLE "GstReturn" ADD COLUMN IF NOT EXISTS "creditNoteIgst" DOUBLE PRECISION NOT NULL DEFAULT 0;
ALTER TABLE "GstReturn" ADD COLUMN IF NOT EXISTS "debitNoteTaxableValue" DOUBLE PRECISION NOT NULL DEFAULT 0;
ALTER TABLE "GstReturn" ADD COLUMN IF NOT EXISTS "debitNoteCgst" DOUBLE PRECISION NOT NULL DEFAULT 0;
ALTER TABLE "GstReturn" ADD COLUMN IF NOT EXISTS "debitNoteSgst" DOUBLE PRECISION NOT NULL DEFAULT 0;
ALTER TABLE "GstReturn" ADD COLUMN IF NOT EXISTS "debitNoteIgst" DOUBLE PRECISION NOT NULL DEFAULT 0;
