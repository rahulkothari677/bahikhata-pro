-- 🔒 V13 L4: Add createdByUserId to Transaction for staff accountability.
--
-- WHY: In a multi-user shop, the owner needs to know which staff member
-- created each transaction. This enables:
--   - Audit trail ("who entered this sale?")
--   - Fraud investigation ("who gave a ₹5,000 discount?")
--   - Accountability in disputes
--
-- The field is nullable (String?) so existing transactions get NULL
-- (they were created before this field existed). New transactions get
-- the session user's ID (owner or staff) set automatically in the POST handler.
--
-- Uses onDelete: SetNull so deleting a user doesn't cascade-delete their
-- transactions — the transactions remain, just with createdByUserId = NULL.

ALTER TABLE "Transaction" ADD COLUMN IF NOT EXISTS "createdByUserId" TEXT;

-- Add a foreign key constraint with ON DELETE SET NULL
DO $$ BEGIN
  ALTER TABLE "Transaction"
    ADD CONSTRAINT "Transaction_createdByUserId_fkey"
    FOREIGN KEY ("createdByUserId") REFERENCES "User"("id")
    ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN
  -- Constraint already exists — skip
END $$;

-- Index for querying "all transactions created by user X"
CREATE INDEX IF NOT EXISTS "Transaction_createdByUserId_idx"
  ON "Transaction" ("createdByUserId");
