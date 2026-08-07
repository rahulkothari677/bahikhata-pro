-- Product.barcode — the manufacturer's code the camera reads.
--
-- Distinct from sku, which is the shop's own code. The app has had a barcode
-- scanner and nowhere to store what it scanned: ProductPicker and Inventory
-- both matched on `p.barcode`, a column that did not exist, so every scan
-- matched nothing.
--
-- Nullable with no default: loose goods have no barcode, and adding a NULL
-- column is a metadata-only change in Postgres — no table rewrite, no lock
-- held while rows are copied, safe on a live database.
--
-- Not UNIQUE, deliberately. Two rows can legitimately share a code (pack sizes
-- of the same brand, and re-used codes exist in the wild), and a unique index
-- would fail the migration on any shop that already has such a pair.
ALTER TABLE "Product" ADD COLUMN "barcode" TEXT;

-- Lookup is by exact code, per user. Partial index: only rows that HAVE a
-- barcode are worth indexing, which keeps it small for shops selling loose.
CREATE INDEX "Product_userId_barcode_idx" ON "Product" ("userId", "barcode") WHERE "barcode" IS NOT NULL;
