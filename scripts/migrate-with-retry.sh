#!/bin/bash
# migrate-with-retry.sh
#
# Runs Prisma migrations before the Next.js build, with retry logic for Neon's
# auto-pause feature.
#
# 🔒 V12.1 CRITICAL FIX — FAIL LOUD, NEVER SHIP SCHEMA-AHEAD CODE.
#
# Neon's free tier auto-pauses after 5 min of inactivity; the first connection
# to a paused DB times out (P1001). We retry those.
#
# BUT: the previous version exited 0 (success) on EVERY failure — including real
# SQL errors and "failed migration" states — "so code fixes still reach prod."
# That reasoning is backwards and caused a full production outage (V12): the
# Prisma client was generated with new columns (TransactionItem.unit,
# Product.priceIncludesGst, Transaction.roundOff, Setting.roundOffEnabled) but
# the migration never applied, so every query for those columns 500'd.
#
# The correct rule:
#   - Migrations applied (or nothing pending) → exit 0 → build + deploy.
#   - A real migration error (bad SQL, or a failed-migration state / P3009)
#     → exit 1 → FAIL THE BUILD. Vercel keeps the last good deployment.
#       Shipping code that expects an unapplied migration is what breaks prod.
#   - DB unreachable (P1001) → retry; if still unreachable after all retries
#     → exit 1 → FAIL THE BUILD (do NOT deploy code that may need a migration
#       that never ran).
#
# A pure code fix with NO new migration always reports "No pending migrations"
# → exit 0 → deploys fine. So failing loud only blocks deploys that genuinely
# need a migration that couldn't be applied — which is exactly when you must
# block.

set -uo pipefail

MAX_RETRIES=5
RETRY_DELAY=10

echo "[migrate] Starting Prisma migrations (fail-loud mode)..."

# Step 1: Mark baseline as applied (suppress errors — may already be applied).
# This is safe: if the baseline is already applied, resolve is a no-op.
echo "[migrate] Step 1: Marking baseline migration as applied (no-op if already applied)..."
npx prisma migrate resolve --applied 0_init 2>/dev/null || true
echo "[migrate] Baseline resolve complete."

# Step 2: migrate deploy with retries (retry ONLY on P1001 / connectivity).
echo "[migrate] Step 2: Running migrate deploy (up to $MAX_RETRIES attempts)..."
for i in $(seq 1 "$MAX_RETRIES"); do
  echo "[migrate] Attempt $i/$MAX_RETRIES..."

  OUTPUT=$(npx prisma migrate deploy 2>&1)
  EXIT_CODE=$?
  echo "$OUTPUT"

  if [ $EXIT_CODE -eq 0 ]; then
    echo "[migrate] ✅ Success — database schema is up to date."
    exit 0
  fi

  # P3009 = one or more migrations are recorded as FAILED in the target DB.
  # deploy refuses to proceed until resolved. This is NOT retryable and must
  # stop the build so we never ship code ahead of the schema.
  if echo "$OUTPUT" | grep -q "P3009"; then
    echo "[migrate] ❌ FAILED-MIGRATION STATE (P3009) in the database."
    echo "[migrate] A previous migration is recorded as failed and is blocking all further migrations."
    echo "[migrate] FIX (run against the production DB, using DIRECT_URL):"
    echo "[migrate]   1. npx prisma migrate status        # see which migration failed"
    echo "[migrate]   2. Inspect/repair the DB if the migration partially applied, then:"
    echo "[migrate]   3. npx prisma migrate resolve --rolled-back <failed_migration_name>"
    echo "[migrate]      (or --applied <name> if it actually did apply fully)"
    echo "[migrate] Failing the build so production keeps its last good deploy."
    exit 1
  fi

  # P1001 = can't reach the DB (Neon paused / cold). Retryable.
  if echo "$OUTPUT" | grep -q "P1001"; then
    if [ "$i" -lt "$MAX_RETRIES" ]; then
      echo "[migrate] ⏳ Database unreachable (P1001) — likely Neon cold start. Waiting ${RETRY_DELAY}s..."
      sleep "$RETRY_DELAY"
      continue
    else
      echo "[migrate] ❌ Database still unreachable (P1001) after $MAX_RETRIES attempts."
      echo "[migrate] Failing the build — refusing to deploy code that may depend on an unapplied migration."
      echo "[migrate] Check: is DIRECT_URL set in Vercel env? Is the Neon project awake / not over quota?"
      exit 1
    fi
  fi

  # Any other error (bad SQL, permissions, advisory-lock failure from running
  # migrations over the pooled pgbouncer connection instead of DIRECT_URL, etc.)
  # is NOT retryable and must stop the build.
  echo "[migrate] ❌ Migration failed with a non-retryable error:"
  echo "[migrate] ---------------------------------------------------------------"
  echo "$OUTPUT"
  echo "[migrate] ---------------------------------------------------------------"
  echo "[migrate] Common cause on Vercel+Neon: migrations run over the POOLED"
  echo "[migrate] connection. Ensure DIRECT_URL (the non -pooler host) is set in"
  echo "[migrate] Vercel env — Prisma uses it via 'directUrl' in schema.prisma."
  echo "[migrate] Failing the build so production keeps its last good deploy."
  exit 1
done

# Unreachable, but be explicit.
echo "[migrate] ❌ Exhausted all attempts without success. Failing the build."
exit 1
