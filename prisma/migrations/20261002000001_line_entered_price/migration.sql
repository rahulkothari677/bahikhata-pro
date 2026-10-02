-- Each bill line keeps the price as typed and whether it included GST (#130).
--
-- Screens that refill a line from a saved bill (return, repeat last sale, edit,
-- estimate -> sale) passed the stored EX-GST unitPrice back while the line took
-- the product's "price includes GST" flag, so GST came out twice. These two
-- columns let a refilled line reproduce the bill exactly.
--
-- Nullable and not backfilled: rows written before this have no record of what
-- was typed, and callers fall back to the ex-GST price with the flag off.
-- IF NOT EXISTS so a retried deploy cannot fail on the second run.
ALTER TABLE "TransactionItem" ADD COLUMN IF NOT EXISTS "enteredPrice" INTEGER;
ALTER TABLE "TransactionItem" ADD COLUMN IF NOT EXISTS "priceIncludesGst" BOOLEAN;
