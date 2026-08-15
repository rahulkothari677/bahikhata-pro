-- Paper size for printed and shared invoices: A4 or A5.
-- See docs/INVOICE-ENGINE-PLAN.md and src/lib/invoice-paper.ts.
--
-- Additive only. Existing rows take 'a4', which is the size every invoice was
-- already produced at, so no shop's output changes as a result of this.
ALTER TABLE "Setting" ADD COLUMN "invoicePaperSize" TEXT NOT NULL DEFAULT 'a4';
