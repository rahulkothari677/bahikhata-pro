-- Invoice template: the STRUCTURE of a bill, chosen separately from its colour.
-- See docs/INVOICE-ENGINE-PLAN.md Phase 2 and src/lib/invoice-templates.ts.
--
-- Additive only. Existing rows take 'standard', which resolves to the exact
-- metrics the PDF renderer hardcoded before templates existed, so no shop's
-- invoice changes as a result of this migration.
ALTER TABLE "Setting" ADD COLUMN "invoiceTemplate" TEXT NOT NULL DEFAULT 'standard';
