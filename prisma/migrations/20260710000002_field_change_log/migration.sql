-- Migration: Create FieldChangeLog table for per-field audit trail
-- V17-Ext 5.1: Every edit to a transaction/payment records who changed
-- what field from what to what. This lets you (and a court, or a CA)
-- reconstruct what the books said at any point in time.
-- Idempotent: uses CREATE TABLE IF NOT EXISTS.

CREATE TABLE IF NOT EXISTS "FieldChangeLog" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "fieldName" TEXT NOT NULL,
    "oldValue" TEXT,
    "newValue" TEXT,
    "changedByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "FieldChangeLog_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "FieldChangeLog_userId_entityType_entityId_createdAt_idx"
    ON "FieldChangeLog" ("userId", "entityType", "entityId", "createdAt");

CREATE INDEX IF NOT EXISTS "FieldChangeLog_entityId_createdAt_idx"
    ON "FieldChangeLog" ("entityId", "createdAt");

ALTER TABLE "FieldChangeLog"
    ADD CONSTRAINT IF NOT EXISTS "FieldChangeLog_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
