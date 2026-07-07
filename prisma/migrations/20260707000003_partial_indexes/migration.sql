-- 🔒 FIX M15: Add partial indexes on Transaction for active-only queries.
--
-- WHY: Every dashboard/report/insights query filters `userId + deletedAt IS NULL
-- + date range`. The existing indexes (userId, date) / (userId, type, date) work,
-- but Postgres has to read the heap row to check deletedAt. For shops with many
-- soft-deleted records, this is suboptimal.
--
-- Partial indexes only index active (non-deleted) rows, so Postgres can use
-- them directly without the post-filter. Smaller index size, faster scans.
--
-- Uses CREATE INDEX CONCURRENTLY (safe for production — no table lock).
-- IF NOT EXISTS for idempotency.

CREATE INDEX CONCURRENTLY IF NOT EXISTS "Transaction_userId_date_active_idx"
  ON "Transaction" ("userId", "date")
  WHERE "deletedAt" IS NULL;

CREATE INDEX CONCURRENTLY IF NOT EXISTS "Transaction_userId_type_date_active_idx"
  ON "Transaction" ("userId", "type", "date")
  WHERE "deletedAt" IS NULL;
