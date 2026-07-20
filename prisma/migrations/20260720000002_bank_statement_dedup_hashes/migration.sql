-- 🔒 V26 R6 (Phase 5): Add csvHash + rowHash unique constraints for bank import dedup.
--
-- Phase 5 audit (R6 🟠): bank import dedup was largely fictional:
--   1. Dead code: first dedup query's result was never used.
--   2. "Exact" dedup = first-200-chars prefix match (false positives on banks
--      with fixed header blocks; false negatives on overlapping date ranges —
--      every overlapping row imported twice, doubling recon workload).
--   3. No per-row dedup at all.
--   4. Check-then-act race (double-click / concurrent tab / queue replay).
--
-- Fix: sha256-based hashes with @unique constraints. The DB enforces dedup,
-- not check-then-act application code. P2002 on the unique constraint → 409.
--
-- Step 1: add the columns (nullable first so existing rows don't violate).
ALTER TABLE "BankStatement" ADD COLUMN IF NOT EXISTS "csvHash" TEXT;
ALTER TABLE "BankTransaction" ADD COLUMN IF NOT EXISTS "rowHash" TEXT;

-- Step 2: backfill existing rows with empty strings (so the @unique constraint
-- can be added without NULL ambiguity — Postgres treats multiple NULLs as
-- distinct, which would defeat the purpose for our default-empty strategy).
UPDATE "BankStatement" SET "csvHash" = '' WHERE "csvHash" IS NULL;
UPDATE "BankTransaction" SET "rowHash" = '' WHERE "rowHash" IS NULL;

-- Step 3: make the columns NON-NULL with a default of '' (so the @unique
-- constraint fires on the default, not NULL).
ALTER TABLE "BankStatement" ALTER COLUMN "csvHash" SET DEFAULT '';
ALTER TABLE "BankStatement" ALTER COLUMN "csvHash" SET NOT NULL;
ALTER TABLE "BankTransaction" ALTER COLUMN "rowHash" SET DEFAULT '';
ALTER TABLE "BankTransaction" ALTER COLUMN "rowHash" SET NOT NULL;

-- Step 4: add the composite unique constraints. (userId, csvHash) and
-- (userId, rowHash) — multiple users can have the same hash, but one user
-- can't import the same statement/row twice.
CREATE UNIQUE INDEX IF NOT EXISTS "BankStatement_userId_csvHash_key"
  ON "BankStatement" ("userId", "csvHash");
CREATE UNIQUE INDEX IF NOT EXISTS "BankTransaction_userId_rowHash_key"
  ON "BankTransaction" ("userId", "rowHash");

-- Note: existing rows have csvHash='' and rowHash=''. The unique constraint
-- allows ONE row per user with an empty hash (the existing data). New imports
-- always compute a real sha256, so they'll never collide with the empty string.
-- If the user imports twice with the same CSV after this migration, the second
-- import P2002s → 409 (caught by the route).
