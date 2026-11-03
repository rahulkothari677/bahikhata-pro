-- 9a-1: 2B rows say what they are (a bill, or a supplier credit/debit note) and,
-- for a corrected one, which number it replaces. Additive: existing rows are bills.
ALTER TABLE "Gstr2bInvoice" ADD COLUMN "docType" TEXT NOT NULL DEFAULT 'invoice';
ALTER TABLE "Gstr2bInvoice" ADD COLUMN "originalNumber" TEXT;
