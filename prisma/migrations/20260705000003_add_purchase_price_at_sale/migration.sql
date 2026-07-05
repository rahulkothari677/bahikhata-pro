-- Migration: Add purchasePriceAtSale to TransactionItem
-- Audit fix M4: COGS snapshot for accurate historical profit
--
-- Snapshots the product's purchasePrice at the time of sale so that
-- historical profit calculations are immutable. Was: profit used the
-- product's CURRENT purchasePrice, which distorted historical profit
-- when the price changed.
--
-- Default 0 for existing items (we don't backfill — historical profit
-- will use 0 for old items, which is acceptable since we can't know
-- the purchase price at the time of old sales).

ALTER TABLE "TransactionItem" ADD COLUMN "purchasePriceAtSale" FLOAT NOT NULL DEFAULT 0;
