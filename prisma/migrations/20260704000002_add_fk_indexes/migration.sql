-- Migration: Add missing indexes on foreign keys
-- Audit fix Phase 5: Performance indexes for scale
--
-- TransactionItem had NO indexes at all — every `include: { items: true }`
-- on Transaction did a FULL TABLE SCAN. Now indexed on transactionId (the FK)
-- and productId (for product-sales lookups).
--
-- Payment had NO indexes — every payment query did a full table scan.
-- Now indexed on (userId, date) and (partyId, date) for the hot query patterns.
--
-- These indexes are safe to add on a live table — Postgres creates them
-- concurrently (though CONCURRENTLY can't be used inside a transaction,
-- Prisma migrate deploy wraps migrations in a transaction, so we use
-- regular CREATE INDEX which briefly locks the table. On small tables
-- this is instant; on large tables it may take a few seconds).

-- TransactionItem indexes (foreign keys)
CREATE INDEX "TransactionItem_transactionId_idx" ON "TransactionItem"("transactionId");
CREATE INDEX "TransactionItem_productId_idx" ON "TransactionItem"("productId");

-- Payment indexes (hot query patterns)
CREATE INDEX "Payment_userId_date_idx" ON "Payment"("userId", "date");
CREATE INDEX "Payment_partyId_date_idx" ON "Payment"("partyId", "date");
