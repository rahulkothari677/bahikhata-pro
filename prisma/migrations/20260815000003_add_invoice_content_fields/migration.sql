-- Phase 3 of docs/INVOICE-ENGINE-PLAN.md: what is ON the bill.
-- Numbering, terms, thank-you, due days, bank details, signature.
--
-- Additive only. Every column is nullable or has a default, so existing rows
-- need no backfill and no shop's invoice changes until they fill something in.
ALTER TABLE "Setting" ADD COLUMN "invoicePrefix" TEXT;
ALTER TABLE "Setting" ADD COLUMN "invoiceNextNumber" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "Setting" ADD COLUMN "invoiceTerms" TEXT;
ALTER TABLE "Setting" ADD COLUMN "invoiceThankYou" TEXT;
ALTER TABLE "Setting" ADD COLUMN "invoiceDueDays" INTEGER;
ALTER TABLE "Setting" ADD COLUMN "bankName" TEXT;
ALTER TABLE "Setting" ADD COLUMN "bankAccountName" TEXT;
ALTER TABLE "Setting" ADD COLUMN "bankAccountNumber" TEXT;
ALTER TABLE "Setting" ADD COLUMN "bankIfsc" TEXT;
ALTER TABLE "Setting" ADD COLUMN "bankBranch" TEXT;
ALTER TABLE "Setting" ADD COLUMN "signatureUrl" TEXT;
ALTER TABLE "Setting" ADD COLUMN "showSignatureBox" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "Setting" ADD COLUMN "showReceiverSignature" BOOLEAN NOT NULL DEFAULT false;
