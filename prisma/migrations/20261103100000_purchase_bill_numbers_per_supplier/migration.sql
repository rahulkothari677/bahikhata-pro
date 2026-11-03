-- #354 (3 Nov 2026): a purchase's number is the SUPPLIER's bill number, so it is
-- unique per supplier, not per shop. One shop-wide rule refused a second
-- supplier's "INV-001", a supplier bill numbered like the shop's own sale
-- (INV-0001), and re-entering a supplier bill after deleting a wrong entry.
--
-- The shop's own documents keep the shop-wide rule, deleted ones included:
-- its own invoice numbers are a unique serial never reused (Rule 46(b)).
--
-- Safe on existing data: every row already met the stricter shop-wide rule.
DROP INDEX IF EXISTS "Transaction_userId_invoiceNo_key";

CREATE UNIQUE INDEX "Transaction_userId_invoiceNo_own_key"
  ON "Transaction" ("userId", "invoiceNo")
  WHERE "invoiceNo" IS NOT NULL AND "type" <> 'purchase';

-- A purchase with no supplier is one group (''), so the app's own PUR-#### series stays unique.
CREATE UNIQUE INDEX "Transaction_purchase_invoiceNo_supplier_key"
  ON "Transaction" ("userId", (COALESCE("partyId", '')), "invoiceNo")
  WHERE "invoiceNo" IS NOT NULL AND "type" = 'purchase' AND "deletedAt" IS NULL;

-- The lookup the dropped unique index also served (search by bill number).
CREATE INDEX IF NOT EXISTS "Transaction_userId_invoiceNo_idx" ON "Transaction" ("userId", "invoiceNo");
