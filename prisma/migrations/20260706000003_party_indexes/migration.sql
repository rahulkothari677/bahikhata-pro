-- 🔒 V11 §2.2: Add indexes to the Party table.
--
-- WHY: The Party table had ZERO database indexes. Every Parties page load
-- (`db.party.findMany({ where: { userId, deletedAt: null } })`) and every
-- dashboard load (the receivable/payable query joins Party to Transaction
-- with `WHERE p."userId" = ...`) did a FULL TABLE SCAN of the entire Party
-- table (all tenants). With 30 parties this is invisible. At scale (millions
-- of users × dozens of parties = tens of millions of Party rows) every
-- parties-list load and every dashboard load scans the whole table.
--
-- Transaction, Product, and Payment already have proper composite indexes
-- (added in earlier audit phases). Party was simply forgotten.
--
-- Two indexes matching the actual query patterns:
--   1. (userId, deletedAt) — the Parties list page and most join filters
--      use `WHERE userId = ? AND deletedAt IS NULL`. This composite index
--      covers both columns in a single index lookup.
--   2. (userId, name) — the Parties list page orders by name
--      (`orderBy: { name: 'asc' }`). Without an index on (userId, name),
--      Postgres must sort the filtered rows in memory. With the index,
--      it can use an index scan that returns rows already sorted.

-- NOTE: CONCURRENTLY removed — Postgres forbids it inside a transaction, and
-- Prisma runs every migration in one. It made this migration fail instantly
-- (P3009) on 2026-07-06 and silently block all later migrations. Party is a
-- small table; a plain CREATE INDEX takes a sub-second lock, which is fine.

CREATE INDEX IF NOT EXISTS "Party_userId_deletedAt_idx"
  ON "Party" ("userId", "deletedAt");

CREATE INDEX IF NOT EXISTS "Party_userId_name_idx"
  ON "Party" ("userId", "name");
