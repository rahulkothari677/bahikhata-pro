-- 🔒 FIX M15: Add partial indexes on Transaction for active-only queries.
--
-- WHY: Every dashboard/report/insights query filters `userId + deletedAt IS NULL
-- + date range`. The existing indexes (userId, date) / (userId, type, date) work,
-- but Postgres has to read the heap row to check deletedAt. Partial indexes
-- only index active (non-deleted) rows, so Postgres can use them directly.
--
-- NOTE: Cannot use CREATE INDEX CONCURRENTLY — Prisma migrations run inside a
-- transaction block, and CONCURRENTLY cannot run inside a transaction. For a
-- pre-launch app with no real users, plain CREATE INDEX is fine (brief lock).
-- Use IF NOT EXISTS for idempotency.

CREATE INDEX IF NOT EXISTS "Transaction_userId_date_active_idx"
  ON "Transaction" ("userId", "date")
  WHERE "deletedAt" IS NULL;

CREATE INDEX IF NOT EXISTS "Transaction_userId_type_date_active_idx"
  ON "Transaction" ("userId", "type", "date")
  WHERE "deletedAt" IS NULL;
