-- V17 Audit Phase 10: Add enteredQuantity + enteredUnit to TransactionItem
-- These snapshot the user's original input (before unit normalization)
-- so credit notes can load "500ml" instead of "0.5ltr".

ALTER TABLE "TransactionItem" ADD COLUMN IF NOT EXISTS "enteredQuantity" DOUBLE PRECISION;
ALTER TABLE "TransactionItem" ADD COLUMN IF NOT EXISTS "enteredUnit" TEXT;

-- Backfill: set enteredQuantity = quantity, enteredUnit = unit for existing items
-- (for existing transactions, the entered value is unknown — use the stored value as best guess)
UPDATE "TransactionItem" SET "enteredQuantity" = "quantity" WHERE "enteredQuantity" IS NULL;
UPDATE "TransactionItem" SET "enteredUnit" = "unit" WHERE "enteredUnit" IS NULL;
