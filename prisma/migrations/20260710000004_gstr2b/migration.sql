-- GSTR-2B Step 1: Create Gstr2bImport + Gstr2bInvoice tables + Party GSTIN index
-- V17-Ext Tier 3: GSTR-2B / ITC reconciliation.
-- Idempotent. All statements use valid PostgreSQL syntax.

CREATE TABLE IF NOT EXISTS "Gstr2bImport" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "monthYear" TEXT NOT NULL,
    "filingPeriod" TEXT,
    "supplierGstin" TEXT,
    "importedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "rawJson" JSONB,
    "invoiceCount" INTEGER NOT NULL DEFAULT 0,
    "taxableTotal" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "igstTotal" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "cgstTotal" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "sgstTotal" DOUBLE PRECISION NOT NULL DEFAULT 0,
    CONSTRAINT "Gstr2bImport_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "Gstr2bImport_userId_fkey"
        FOREIGN KEY ("userId") REFERENCES "User"("id")
        ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "Gstr2bImport_userId_monthYear_key"
    ON "Gstr2bImport" ("userId", "monthYear");

CREATE TABLE IF NOT EXISTS "Gstr2bInvoice" (
    "id" TEXT NOT NULL,
    "gstr2bImportId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "supplierGstin" TEXT NOT NULL,
    "invoiceNumber" TEXT NOT NULL,
    "invoiceDate" TEXT,
    "taxableValue" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "igst" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "cgst" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "sgst" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "totalAmount" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "isReverseCharge" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Gstr2bInvoice_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "Gstr2bInvoice_gstr2bImportId_fkey"
        FOREIGN KEY ("gstr2bImportId") REFERENCES "Gstr2bImport"("id")
        ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "Gstr2bInvoice_gstr2bImportId_idx"
    ON "Gstr2bInvoice" ("gstr2bImportId");

CREATE INDEX IF NOT EXISTS "Gstr2bInvoice_userId_supplierGstin_invoiceNumber_idx"
    ON "Gstr2bInvoice" ("userId", "supplierGstin", "invoiceNumber");

CREATE INDEX IF NOT EXISTS "Gstr2bInvoice_userId_monthYear_idx"
    ON "Gstr2bInvoice" ("userId");

CREATE INDEX IF NOT EXISTS "Party_userId_gstin_idx"
    ON "Party" ("userId", "gstin")
    WHERE "gstin" IS NOT NULL;
