-- Phase 1c (#165): is the shop registered under GST?
-- FALSE (not registered) is the default: such a shop may not collect tax
-- (Section 32(1) CGST Act). Shops that already had a GSTIN or a composition
-- category are registered. Idempotent: ADD COLUMN IF NOT EXISTS, and the
-- UPDATE sets a constant from other columns, so a re-run changes nothing.
ALTER TABLE "Setting" ADD COLUMN IF NOT EXISTS "gstRegistered" BOOLEAN NOT NULL DEFAULT false;

UPDATE "Setting" SET "gstRegistered" = true
WHERE ("gstin" IS NOT NULL AND "gstin" <> '') OR "compositionCategory" IS NOT NULL;
