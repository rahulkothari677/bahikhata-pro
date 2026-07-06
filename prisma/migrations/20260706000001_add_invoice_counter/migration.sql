-- Migration: Add InvoiceCounter table for atomic invoice numbering
-- V9 2.7: Eliminates the race condition in invoice number generation.
-- Was: findFirst(orderBy desc) + 1 → two concurrent sales could collide.
-- Now: upsert with increment is atomic at the row level.

-- Step 1: Create the InvoiceCounter table
CREATE TABLE "InvoiceCounter" (
    "userId" TEXT NOT NULL,
    "seq" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "InvoiceCounter_pkey" PRIMARY KEY ("userId")
);

-- Step 2: Add foreign key constraint
ALTER TABLE "InvoiceCounter"
    ADD CONSTRAINT "InvoiceCounter_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Step 3: Backfill — for each user who has transactions with invoiceSequence,
-- set their counter to the current max sequence (so the next invoice gets max+1)
INSERT INTO "InvoiceCounter" ("userId", "seq")
SELECT "userId", COALESCE(MAX("invoiceSequence"), 0)
FROM "Transaction"
WHERE "invoiceSequence" IS NOT NULL
GROUP BY "userId"
ON CONFLICT ("userId") DO NOTHING;

-- Step 4: For users who have NO transactions yet, the counter will be created
-- on first use via the upsert (create: { userId, seq: 1 }).
