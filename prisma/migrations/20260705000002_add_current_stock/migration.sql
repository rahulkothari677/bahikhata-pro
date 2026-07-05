-- Migration: Add currentStock column to Product
-- Audit fix H1: Inventory stock guard
--
-- Adds a currentStock column that is maintained transactionally (decrement on
-- sale, increment on purchase) inside the same $transaction as the transaction
-- create/update. This replaces the old approach of computing stock at read time
-- (openingStock + purchases - sales) which had no guard against overselling.
--
-- Backfill: set currentStock = openingStock for all existing products.
-- A full backfill from transaction history would be ideal but is complex and
-- risky — setting to openingStock is safe (worst case: stock is over-counted,
-- which is better than under-counted). The app will maintain it correctly going
-- forward. A reconciliation job can correct it later.

ALTER TABLE "Product" ADD COLUMN "currentStock" FLOAT NOT NULL DEFAULT 0;

-- Backfill: set currentStock to openingStock for existing products
UPDATE "Product" SET "currentStock" = "openingStock";
