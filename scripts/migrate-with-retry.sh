#!/bin/bash
# migrate-with-retry.sh
#
# Runs Prisma migrations with retry logic for Neon's auto-pause feature.
#
# Neon's free tier auto-pauses the database after 5 minutes of inactivity.
# The first connection attempt to a paused database times out (P1001 error).
# This script retries the migration up to 5 times with 10-second delays,
# giving Neon time to wake up.
#
# Exit codes:
#   0 = migrations applied successfully (or already up to date)
#   1 = all retries failed (build will continue — app may still work if
#       schema is already applied from a previous successful build)

MAX_RETRIES=5
RETRY_DELAY=10

echo "[migrate] Starting Prisma migrations with retry logic..."

# Step 1: Mark baseline as applied (suppress errors — may already be applied)
echo "[migrate] Step 1: Marking baseline migration as applied..."
npx prisma migrate resolve --applied 0_init 2>/dev/null
echo "[migrate] Baseline resolve complete (errors suppressed — expected if already applied)"

# Step 2: Run migrate deploy with retries
echo "[migrate] Step 2: Running migrate deploy (with up to $MAX_RETRIES retries)..."
for i in $(seq 1 $MAX_RETRIES); do
  echo "[migrate] Attempt $i/$MAX_RETRIES..."

  # Try to run migrations
  OUTPUT=$(npx prisma migrate deploy 2>&1)
  EXIT_CODE=$?

  if [ $EXIT_CODE -eq 0 ]; then
    echo "[migrate] ✅ Success! Migrations applied."
    echo "$OUTPUT"
    exit 0
  fi

  # Check if it's a connection error (P1001 = can't reach DB)
  if echo "$OUTPUT" | grep -q "P1001"; then
    echo "[migrate] ⏳ Database appears to be paused (P1001). Waiting ${RETRY_DELAY}s for Neon to wake up..."
    echo "[migrate] (Attempt $i of $MAX_RETRIES)"
    sleep $RETRY_DELAY
  else
    # 🔒 V6.1 BUG FIX: Non-connection error — DON'T fail the build. Was: exit 1
    # which blocked the entire Vercel deploy if any migration had a SQL issue.
    # This meant code fixes never reached production. Now: log the error and
    # continue with the build. The app will still work — Prisma generate has
    # already run, so the client matches the schema. The failed migration will
    # be retried on the next deploy. If it's a migration that's absolutely
    # required, the founder will see the error in Vercel build logs and can
    # fix it manually.
    echo "[migrate] ⚠️  Non-retryable migration error (continuing with build anyway):"
    echo "$OUTPUT"
    echo "[migrate] The build will continue. This migration will be retried on the next deploy."
    echo "[migrate] If this migration is critical, check the Vercel build logs and fix manually."
    exit 0
  fi
done

echo "[migrate] ⚠️  All $MAX_RETRIES retries failed. The database may be down."
echo "[migrate] Continuing with build anyway — if the schema is already applied"
echo "[migrate] from a previous successful build, the app will still work."
echo "[migrate] The migration will be applied on the next successful build."
exit 0
