-- GSTR-3B Step 1: Add isReverseCharge to Transaction + create GstReturn snapshot table
-- V17-Ext Tier 3: Complete GSTR-3B with RCM (reverse charge) support.
-- Idempotent. All statements use valid PostgreSQL syntax.

ALTER TABLE "Transaction" ADD COLUMN IF NOT EXISTS "isReverseCharge" BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE IF NOT EXISTS "GstReturn" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "monthYear" TEXT NOT NULL,
    "periodStart" TIMESTAMP(3) NOT NULL,
    "periodEnd" TIMESTAMP(3) NOT NULL,
    "filingStatus" TEXT NOT NULL DEFAULT 'draft',
    "filedAt" TIMESTAMP(3),
    "filedByUserId" TEXT,
    "outwardTaxableValue" FLOAT NOT NULL DEFAULT 0,
    "outwardCgst" FLOAT NOT NULL DEFAULT 0,
    "outwardSgst" FLOAT NOT NULL DEFAULT 0,
    "outwardIgst" FLOAT NOT NULL DEFAULT 0,
    "rcmTaxableValue" FLOAT NOT NULL DEFAULT 0,
    "rcmCgst" FLOAT NOT NULL DEFAULT 0,
    "rcmSgst" FLOAT NOT NULL DEFAULT 0,
    "rcmIgst" FLOAT NOT NULL DEFAULT 0,
    "nilRatedValue" FLOAT NOT NULL DEFAULT 0,
    "exemptValue" FLOAT NOT NULL DEFAULT 0,
    "nonGstValue" FLOAT NOT NULL DEFAULT 0,
    "itcTaxableValue" FLOAT NOT NULL DEFAULT 0,
    "itcCgst" FLOAT NOT NULL DEFAULT 0,
    "itcSgst" FLOAT NOT NULL DEFAULT 0,
    "itcIgst" FLOAT NOT NULL DEFAULT 0,
    "exemptInwardValue" FLOAT NOT NULL DEFAULT 0,
    "interstateB2cTaxableValue" FLOAT NOT NULL DEFAULT 0,
    "interstateB2cIgst" FLOAT NOT NULL DEFAULT 0,
    "netTaxPayable" FLOAT NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "GstReturn_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "GstReturn_userId_fkey"
        FOREIGN KEY ("userId") REFERENCES "User"("id")
        ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "GstReturn_userId_monthYear_key"
    ON "GstReturn" ("userId", "monthYear");

CREATE INDEX IF NOT EXISTS "GstReturn_userId_periodStart_idx"
    ON "GstReturn" ("userId", "periodStart");
