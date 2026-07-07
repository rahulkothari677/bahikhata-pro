-- 🔒 V12: Units, GST-inclusive pricing, and invoice round-off.
--
-- WHY:
--  1. TransactionItem had no `unit` column — the unit was dropped on save, so
--     every historical line was ambiguous ("500 of Tomato": grams or kilos?).
--     This also enabled the "500 gm × ₹20/kg = ₹10,000" bug and stock
--     corruption (decrement by the raw number, unit-blind).
--  2. Product had no `priceIncludesGst` — Indian retail runs on MRP, which is
--     legally GST-inclusive; the app always added GST on top, producing wrong
--     invoices for MRP-priced goods.
--  3. Transaction had no `roundOff` and Setting no `roundOffEnabled` — Indian
--     invoices customarily round the grand total to the nearest rupee with an
--     explicit round-off line.

-- 1. TransactionItem.unit — snapshot of the unit at transaction time.
ALTER TABLE "TransactionItem" ADD COLUMN IF NOT EXISTS "unit" TEXT NOT NULL DEFAULT 'pcs';

-- Backfill existing items from their linked product's unit where available.
-- (Lines with no product keep the 'pcs' default — the safest neutral value.)
UPDATE "TransactionItem" ti
SET "unit" = p."unit"
FROM "Product" p
WHERE ti."productId" = p."id"
  AND p."unit" IS NOT NULL
  AND p."unit" <> '';

-- 2. Product.priceIncludesGst — MRP / GST-inclusive pricing flag.
ALTER TABLE "Product" ADD COLUMN IF NOT EXISTS "priceIncludesGst" BOOLEAN NOT NULL DEFAULT false;

-- 3. Transaction.roundOff — the round-off adjustment applied to the grand total.
ALTER TABLE "Transaction" ADD COLUMN IF NOT EXISTS "roundOff" DOUBLE PRECISION NOT NULL DEFAULT 0;

-- 4. Setting.roundOffEnabled — per-user toggle for grand-total round-off.
ALTER TABLE "Setting" ADD COLUMN IF NOT EXISTS "roundOffEnabled" BOOLEAN NOT NULL DEFAULT false;
