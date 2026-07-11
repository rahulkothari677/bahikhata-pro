-- V17 Audit Phase 5: e-Invoicing (IRN/QR) + e-Way Bill fields on Transaction

-- IRN = Invoice Reference Number (64-char hash from NIC portal)
ALTER TABLE "Transaction" ADD COLUMN IF NOT EXISTS "irn" TEXT;

-- Signed QR code string (returned by NIC, contains invoice summary)
ALTER TABLE "Transaction" ADD COLUMN IF NOT EXISTS "signedQR" TEXT;

-- IRN lifecycle status: pending | generated | cancelled
ALTER TABLE "Transaction" ADD COLUMN IF NOT EXISTS "irnStatus" TEXT;

-- When the IRN was generated (for audit trail)
ALTER TABLE "Transaction" ADD COLUMN IF NOT EXISTS "irnGeneratedAt" TIMESTAMP(3);

-- e-Way Bill number (12-digit, for inter-state goods movement > ₹50,000)
ALTER TABLE "Transaction" ADD COLUMN IF NOT EXISTS "ewayBillNo" TEXT;

-- e-Way Bill expiry date (valid for ~3 days for <100km, 1 day per 200km)
ALTER TABLE "Transaction" ADD COLUMN IF NOT EXISTS "ewayBillExpiry" TIMESTAMP(3);

-- e-Way Bill generation date
ALTER TABLE "Transaction" ADD COLUMN IF NOT EXISTS "ewayBillDate" TIMESTAMP(3);

-- Index for filtering transactions by IRN status
CREATE INDEX IF NOT EXISTS "Transaction_userId_irnStatus_idx" ON "Transaction"("userId", "irnStatus");
