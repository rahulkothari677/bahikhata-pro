-- Phase 5: custom fields and columns.
--
-- Additive only. One new table plus three nullable JSONB columns; nothing is
-- renamed and nothing is removed, so a shop that never defines a field sees a
-- byte-identical bill.
--
-- The definitions live in the table; the VALUES live in the JSONB columns on
-- the records themselves. See src/lib/custom-fields.ts — the short reason is
-- that drawing one bill is the hot path, and a values table would put a join
-- on it for every render.

CREATE TABLE IF NOT EXISTS "CustomFieldDef" (
    "id"            TEXT NOT NULL,
    "userId"        TEXT NOT NULL,
    "entity"        TEXT NOT NULL,
    "key"           TEXT NOT NULL,
    "label"         TEXT NOT NULL,
    "type"          TEXT NOT NULL DEFAULT 'text',
    "showOnInvoice" BOOLEAN NOT NULL DEFAULT true,
    "required"      BOOLEAN NOT NULL DEFAULT false,
    "order"         INTEGER NOT NULL DEFAULT 0,
    "createdAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"     TIMESTAMP(3) NOT NULL,
    "deletedAt"     TIMESTAMP(3),

    CONSTRAINT "CustomFieldDef_pkey" PRIMARY KEY ("id")
);

-- One shop cannot define the same key twice on the same entity.
CREATE UNIQUE INDEX IF NOT EXISTS "CustomFieldDef_userId_entity_key_key"
    ON "CustomFieldDef"("userId", "entity", "key");

-- The only read this table gets: "which fields does this shop have for this
-- entity". Covered end to end, including the soft-delete filter.
CREATE INDEX IF NOT EXISTS "CustomFieldDef_userId_entity_deletedAt_idx"
    ON "CustomFieldDef"("userId", "entity", "deletedAt");

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'CustomFieldDef_userId_fkey'
    ) THEN
        ALTER TABLE "CustomFieldDef"
            ADD CONSTRAINT "CustomFieldDef_userId_fkey"
            FOREIGN KEY ("userId") REFERENCES "User"("id")
            ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;

-- Snapshotted values, on the records they belong to.
ALTER TABLE "Party"           ADD COLUMN IF NOT EXISTS "customFields" JSONB;
ALTER TABLE "Transaction"     ADD COLUMN IF NOT EXISTS "customFields" JSONB;
ALTER TABLE "TransactionItem" ADD COLUMN IF NOT EXISTS "customCols"   JSONB;
