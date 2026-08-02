-- 🔒 AUDIT C5: PaymentAllocation — links a Payment to the bill(s) it settles.
--
-- THE DEFECT THIS FIXES: a "Settle" payment reduced the PARTY balance, but no
-- bill knew about it. An invoice kept showing its original amount as due
-- forever, so party outstanding and the sum of bill dues disagreed permanently
-- from the first partial payment onward. Worse, the stale "Due" invited the
-- shopkeeper to collect that amount a second time — and nothing would have
-- stopped them, because settling a bill for exactly what it claims to owe
-- looks entirely correct.
--
-- A bill's true due becomes:
--     totalAmount − paidAmount − SUM(allocations)
--
-- SAFETY NOTES (this project has been burned before):
--   * ONE new table. No changes to any existing table, so nothing that reads
--     Transaction or Payment today can be affected by this migration.
--   * No CREATE INDEX CONCURRENTLY — it cannot run inside the transaction
--     Prisma wraps each migration in. That exact combination caused the V12
--     outage; the indexes here are plain CREATE INDEX on an empty table, which
--     is instant.
--   * The table ships EMPTY and no backfill is performed. An unallocated
--     payment behaves exactly as it does today (reduces the party balance,
--     settles no specific bill), so this migration is a no-op for existing
--     data and cannot change a single number on its own.

CREATE TABLE "PaymentAllocation" (
    "id"            TEXT NOT NULL,
    "userId"        TEXT NOT NULL,
    "paymentId"     TEXT NOT NULL,
    "transactionId" TEXT NOT NULL,
    -- paise, matching every other money column in this schema
    "amount"        INTEGER NOT NULL,
    "createdAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PaymentAllocation_pkey" PRIMARY KEY ("id")
);

-- One row per (payment, bill). Re-allocating UPDATEs rather than inserting a
-- duplicate, which also makes an offline replay idempotent.
CREATE UNIQUE INDEX "PaymentAllocation_paymentId_transactionId_key"
    ON "PaymentAllocation"("paymentId", "transactionId");

-- "What has been settled against this bill?" — the hot read behind every due
-- calculation, and tenant-scoped so it can never scan across users.
CREATE INDEX "PaymentAllocation_userId_transactionId_idx"
    ON "PaymentAllocation"("userId", "transactionId");

-- "What did this payment settle?" — used when displaying or reversing one.
CREATE INDEX "PaymentAllocation_paymentId_idx"
    ON "PaymentAllocation"("paymentId");

-- Deleting a payment removes its allocations: the money never arrived, so the
-- bills it was covering must go back to being due.
ALTER TABLE "PaymentAllocation"
    ADD CONSTRAINT "PaymentAllocation_paymentId_fkey"
    FOREIGN KEY ("paymentId") REFERENCES "Payment"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

-- Transactions are SOFT-deleted, never hard-deleted, so RESTRICT rather than
-- CASCADE. The allocation must survive to keep the audit trail answerable —
-- "you say I paid; against what?" needs an answer even for a voided bill.
ALTER TABLE "PaymentAllocation"
    ADD CONSTRAINT "PaymentAllocation_transactionId_fkey"
    FOREIGN KEY ("transactionId") REFERENCES "Transaction"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;
