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

# 🔒 V15 FIX: Bumped from 5×10s (50s) to 8×15s (120s) budget. Neon cold
# starts can take 30-60s, and on very cold projects even longer. The old
# 50s budget failed ~1 in every 10 Vercel deploys when the GitHub Actions
# warmup ping happened to miss its 5-min window. 120s is still well within
# Vercel's 45-min build timeout, and only the FIRST deploy after a long
# idle period pays the full budget — once Neon is warm, migrate deploy
# succeeds on attempt 1 and the loop exits immediately.
MAX_RETRIES=8
RETRY_DELAY=15

echo "[migrate] Starting Prisma migrations (fail-loud mode)..."
echo "[migrate] Retry budget: $MAX_RETRIES attempts × ${RETRY_DELAY}s = $((MAX_RETRIES * RETRY_DELAY))s max wait."

# Step 0: Pre-warm Neon with a TCP probe BEFORE attempting migrations.
# This triggers Neon's auto-wake via a cheap TCP SYN (no SQL, no DDL),
# giving Neon a 60-90s head start before Prisma tries to acquire an
# advisory lock and run DDL. The probe itself does not fail the build —
# it just tries to give Neon a head start. If it fails, the migrate
# retry loop below will still try.
echo "[migrate] Step 0: Pre-warming Neon via TCP probe (up to 90s)..."
node "$(dirname "$0")/warmup-neon.mjs" || {
  echo "[migrate] ⚠️  Pre-warm probe did not succeed — continuing anyway; the migrate retry loop will try."
}
echo "[migrate] Pre-warm step complete."

# Step 1: Mark baseline as applied (suppress errors — may already be applied).
# This is safe: if the baseline is already applied, resolve is a no-op.
echo "[migrate] Step 1: Marking baseline migration as applied (no-op if already applied)..."
npx prisma migrate resolve --applied 0_init 2>/dev/null || true
echo "[migrate] Baseline resolve complete."

# Step 1.5: Heal P3009 from the old failed migration.
# When the migration was in _disabled_add_document_vault directory, Vercel
# tried to apply it and failed (DIRECT_URL wasn't set). This left a 'failed'
# record in _prisma_migrations with the name '_disabled_add_document_vault'.
# Now the migration is back at '20260716000000_add_document_vault' but Prisma
# still sees the old failed record → P3009 → blocks all new migrations.
# Fix: mark the OLD failed migration name as rolled-back.
echo "[migrate] Step 1.5: Healing P3009 from old _disabled_add_document_vault..."
npx prisma migrate resolve --rolled-back _disabled_add_document_vault 2>/dev/null || true
echo "[migrate] Old failed migration resolve complete."

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
  # P3018 = a migration failed to apply. New migrations cannot be applied
  #         before the error is recovered from.
  #
  # Both have the same fix: mark the failed migration as rolled-back, then
  # retry deploy. The failed migration name is extracted from the error output.
  #
  # 🔒 V12.2 SELF-HEAL: All our migrations are idempotent (CREATE INDEX IF NOT
  # EXISTS / ADD COLUMN IF NOT EXISTS) and Prisma runs each file in a
  # transaction, so re-applying a previously-failed migration is safe: either
  # it fully applies this time or it fails atomically again. So on P3009/P3018
  # we mark the failed migration rolled-back and retry deploy ONCE. If it
  # fails again, we fail the build (production keeps its last good deploy).
  #
  # (This exact state happened on 2026-07-06: party_indexes used CREATE INDEX
  # CONCURRENTLY, which Postgres forbids inside a transaction. It failed
  # instantly, the old script swallowed it, and it silently blocked every
  # later migration until the V12 outage exposed it.)
  if echo "$OUTPUT" | grep -qE "P3009|P3018"; then
    FAILED_MIGRATION=$(echo "$OUTPUT" | grep -oE "\`[0-9]{14}[a-zA-Z0-9_]*\`" | head -1 | tr -d '\`')
    # If no backtick-wrapped name found, try extracting from "Migration name:" line (P3018 format)
    if [ -z "$FAILED_MIGRATION" ]; then
      FAILED_MIGRATION=$(echo "$OUTPUT" | grep -oE "Migration name: [0-9]{14}[a-zA-Z0-9_]*" | head -1 | sed 's/Migration name: //')
    fi
    ERROR_CODE=$(echo "$OUTPUT" | grep -oE "P3009|P3018" | head -1)
    echo "[migrate] ⚠️  FAILED-MIGRATION STATE ($ERROR_CODE). Failed migration: ${FAILED_MIGRATION:-unknown}"
    if [ -n "$FAILED_MIGRATION" ] && [ "${P3009_HEALED:-0}" = "0" ]; then
      P3009_HEALED=1
      echo "[migrate] Self-heal: marking '$FAILED_MIGRATION' as rolled back and retrying deploy once..."
      if npx prisma migrate resolve --rolled-back "$FAILED_MIGRATION"; then
        echo "[migrate] Resolve succeeded — retrying migrate deploy..."
        continue
      else
        echo "[migrate] ❌ Could not resolve the failed migration automatically."
      fi
    fi
    echo "[migrate] ❌ $ERROR_CODE persists. Manual fix (run against the production DB, using DIRECT_URL):"
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
      echo ""
      echo "[migrate] ═══════════════════════════════════════════════════════════════════"
      echo "[migrate] RECOVERY STEPS (do these in order):"
      echo "[migrate] ═══════════════════════════════════════════════════════════════════"
      echo "[migrate] 1. Disable Neon 'Scale to zero' (PERMANENT FIX — ~$19/mo):"
      echo "[migrate]      Neon Console → your project → Settings → Compute"
      echo "[migrate]      → 'Suspend compute after inactivity' → OFF (Always-on)."
      echo "[migrate]      This is the #1 cause of P1001 during Vercel builds."
      echo ""
      echo "[migrate] 2. Check Neon compute-hour quota (free tier = 120 hrs/month):"
      echo "[migrate]      Neon Console → Billing → Usage."
      echo "[migrate]      If exhausted, the DB force-suspends until next month."
      echo ""
      echo "[migrate] 3. Verify DIRECT_URL is set in Vercel env vars:"
      echo "[migrate]      Vercel → Project → Settings → Environment Variables."
      echo "[migrate]      DIRECT_URL must be the NON-pooler host (no '-pooler' in hostname)."
      echo "[migrate]      DATABASE_URL must be the -pooler host (with &pgbouncer=true)."
      echo ""
      echo "[migrate] 4. Manually wake Neon, then retry the Vercel deploy:"
      echo "[migrate]      curl https://bahikhata-pro.vercel.app/api/warmup"
      echo "[migrate]      (wait 30s, then trigger redeploy on Vercel)"
      echo ""
      echo "[migrate] 5. Check GitHub Actions warmup workflow is enabled:"
      echo "[migrate]      GitHub repo → Actions tab → 'Neon Warmup Ping' workflow."
      echo "[migrate]      Should run every 5 min. If disabled, enable it."
      echo "[migrate] ═══════════════════════════════════════════════════════════════════"
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
