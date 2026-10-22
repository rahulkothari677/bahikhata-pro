-- Phase 7b (#293): brands with sizes.
--
-- ProductFamily: "Parle-G"; each of its sizes stays its own Product (price,
-- MRP, barcode, stock, name), so no bill, GST figure or report changes.
-- Product.familyId / sizeLabel / sizeRank: nullable and NOT backfilled — every
-- existing item stays exactly as it is, an item on its own, until the shop
-- groups it. ON DELETE SET NULL: removing a family ungroups, never deletes.
--
-- Only additions. IF NOT EXISTS, and constraints guarded, so a retried deploy
-- cannot fail on the second run.
CREATE TABLE IF NOT EXISTS "ProductFamily" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ProductFamily_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "ProductFamily_userId_name_key" ON "ProductFamily"("userId", "name");

DO $$ BEGIN
  ALTER TABLE "ProductFamily" ADD CONSTRAINT "ProductFamily_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE "Product" ADD COLUMN IF NOT EXISTS "familyId" TEXT;
ALTER TABLE "Product" ADD COLUMN IF NOT EXISTS "sizeLabel" TEXT;
ALTER TABLE "Product" ADD COLUMN IF NOT EXISTS "sizeRank" DOUBLE PRECISION;
CREATE INDEX IF NOT EXISTS "Product_userId_familyId_idx" ON "Product"("userId", "familyId");

DO $$ BEGIN
  ALTER TABLE "Product" ADD CONSTRAINT "Product_familyId_fkey"
    FOREIGN KEY ("familyId") REFERENCES "ProductFamily"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
