-- #21: a shop can be put away without being destroyed.
--
-- A shop created by mistake, or one that has closed, had no exit. It sat in the
-- picker forever. The only alternative on offer was deleting the whole account.
--
-- Written by hand rather than generated, because this machine has no database
-- credentials. ADDITIVE ONLY — one nullable column, nothing changed, nothing
-- dropped — so it cannot damage existing data, and the deploy applies it.
--
-- Rolling back is `ALTER TABLE "Shop" DROP COLUMN "archivedAt";`. Nothing else
-- breaks: every existing query ignores the column, and NULL is the state every
-- current row is in — an unarchived shop, exactly as before.

ALTER TABLE "Shop" ADD COLUMN "archivedAt" TIMESTAMP(3);

-- The shop picker asks for "this user's shops that are not archived" on every
-- load. Without the column in the index that becomes a scan-then-filter.
CREATE INDEX "Shop_userId_archivedAt_idx" ON "Shop"("userId", "archivedAt");
