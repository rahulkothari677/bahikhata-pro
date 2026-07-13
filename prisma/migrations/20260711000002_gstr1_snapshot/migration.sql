-- V17 Audit Phase 3: GSTR-1 — TransactionItem.hsn + csamt + Gstr1Snapshot model

-- TransactionItem: HSN snapshot at time of transaction (was: only Product.hsn existed)
ALTER TABLE "TransactionItem" ADD COLUMN IF NOT EXISTS "hsn" TEXT;

-- TransactionItem: CESS amount (rare for kirana but GST portal requires the field)
ALTER TABLE "TransactionItem" ADD COLUMN IF NOT EXISTS "csamt" DOUBLE PRECISION NOT NULL DEFAULT 0;

-- Backfill hsn from Product for existing items
-- (If the product's HSN changed since the sale, the backfilled value may be wrong.
--  This is acceptable — going forward, new transactions snapshot the HSN at write time.)
UPDATE "TransactionItem" ti
SET "hsn" = p."hsn"
FROM "Product" p
WHERE ti."productId" = p.id
  AND ti."hsn" IS NULL
  AND p."hsn" IS NOT NULL;

-- Gstr1Snapshot model
CREATE TABLE IF NOT EXISTS "Gstr1Snapshot" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "monthYear" TEXT NOT NULL,
    "periodStart" TIMESTAMP(3) NOT NULL,
    "periodEnd" TIMESTAMP(3) NOT NULL,
    "filingStatus" TEXT NOT NULL DEFAULT 'draft',
    "filedAt" TIMESTAMP(3),
    "filedByUserId" TEXT,
    "rawJson" JSONB,
    "totalTaxableValue" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "totalOutputTax" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "totalInvoiceCount" INTEGER NOT NULL DEFAULT 0,
    "totalCreditNotes" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Gstr1Snapshot_pkey" PRIMARY KEY ("id")
);

-- Unique constraint: one snapshot per user per month
CREATE UNIQUE INDEX IF NOT EXISTS "Gstr1Snapshot_userId_monthYear_key"
  ON "Gstr1Snapshot"("userId", "monthYear");

-- Index for period-based queries
CREATE INDEX IF NOT EXISTS "Gstr1Snapshot_userId_periodStart_idx"
  ON "Gstr1Snapshot"("userId", "periodStart");

-- Foreign key to User
ALTER TABLE "Gstr1Snapshot"
  ADD CONSTRAINT "Gstr1Snapshot_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id")
  ON DELETE CASCADE;
