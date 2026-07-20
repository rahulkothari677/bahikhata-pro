#!/bin/bash
#
# 🔒 V26 Phase 7 — Live Race Harness
#
# This script runs the concurrency tests the auditor recommended in §5:
#   1. Two parallel estimate→sale conversions (expect: 1 winner + 1 × 409)
#   2. Two parallel PUTs on the same transaction (expect: 1 succeeds + 1 × 409, stock correct)
#   3. Two parallel credit notes against the same sale (expect: 1 succeeds + 1 × 400 cap)
#   4. Same-file double bank import (expect: 1 succeeds + 1 × 409 duplicate)
#   5. Mid-restore kill + retry-with-same-session resume (manual — see instructions)
#
# PREREQUISITES:
#   - A stable staging DB (Neon branch, NOT local prisma-dev)
#   - The app deployed and accessible at APP_URL
#   - A valid auth session (cookie) — paste it below or export SESSION_COOKIE
#   - At least 1 estimate, 1 sale, 1 product, and 1 party in the staging DB
#
# USAGE:
#   export APP_URL="https://your-staging.vercel.app"
#   export SESSION_COOKIE="next-auth.session-token=eyJhbGciOi..."
#   bash scripts/race-harness.sh
#
# Or set the vars inline:
#   APP_URL="https://..." SESSION_COOKIE="..." bash scripts/race-harness.sh

set -euo pipefail

APP_URL="${APP_URL:-http://localhost:3000}"
COOKIE="${SESSION_COOKIE:-}"

if [ -z "$COOKIE" ]; then
  echo "❌ SESSION_COOKIE not set. Export it first:"
  echo '   export SESSION_COOKIE="next-auth.session-token=eyJhbGciOi..."'
  echo ""
  echo "   Get it from your browser: DevTools → Application → Cookies → copy the session token"
  exit 1
fi

echo "═══════════════════════════════════════════════════════════════"
echo "  EkBook Phase 7 — Live Race Harness"
echo "  Target: $APP_URL"
echo "═══════════════════════════════════════════════════════════════"
echo ""

# Helper: make an authenticated request
req() {
  local method="$1"
  local path="$2"
  local body="${3:-}"
  if [ -n "$body" ]; then
    curl -s -X "$method" \
      -H "Content-Type: application/json" \
      -H "Cookie: $COOKIE" \
      -d "$body" \
      "${APP_URL}${path}"
  else
    curl -s -X "$method" \
      -H "Cookie: $COOKIE" \
      "${APP_URL}${path}"
  fi
}

echo "📋 Step 0: Verify auth + fetch test data"
echo "─────────────────────────────────────────"
BOOTSTRAP=$(req GET /api/bootstrap)
if echo "$BOOTSTRAP" | grep -q "error"; then
  echo "❌ Auth failed — check your SESSION_COOKIE"
  echo "   Response: $(echo "$BOOTSTRAP" | head -c 200)"
  exit 1
fi
echo "✅ Auth OK"

# Fetch an estimate to convert
ESTIMATES=$(req GET "/api/transactions?type=estimate&limit=1")
ESTIMATE_ID=$(echo "$ESTIMATES" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d['transactions'][0]['id'] if d.get('transactions') else '')" 2>/dev/null || echo "")

# Fetch a sale to create credit notes against
SALES=$(req GET "/api/transactions?type=sale&limit=1")
SALE_ID=$(echo "$SALES" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d['transactions'][0]['id'] if d.get('transactions') else '')" 2>/dev/null || echo "")
SALE_PARTY_ID=$(echo "$SALES" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d['transactions'][0].get('partyId','') if d.get('transactions') else '')" 2>/dev/null || echo "")
SALE_TOTAL=$(echo "$SALES" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d['transactions'][0].get('totalAmount',0) if d.get('transactions') else 0)" 2>/dev/null || echo "0")

echo ""
echo "Test data:"
echo "  Estimate ID: ${ESTIMATE_ID:-NONE (create one first)}"
echo "  Sale ID: ${SALE_ID:-NONE (create one first)}"
echo ""

# ─── Test 1: Parallel estimate conversions ─────────────────────
echo "🔬 Test 1: Two parallel estimate→sale conversions"
echo "──────────────────────────────────────────────────"
if [ -z "$ESTIMATE_ID" ]; then
  echo "⏭️  Skipped (no estimate found — create one first)"
else
  # Fire both converts simultaneously
  RESULT_A=$(req POST "/api/transactions/${ESTIMATE_ID}/convert" "{}" &)
  RESULT_B=$(req POST "/api/transactions/${ESTIMATE_ID}/convert" "{}" &)
  wait

  STATUS_A=$(echo "$RESULT_A" | python3 -c "import sys,json; d=json.load(sys.stdin); print('409' if 'Already converted' in d.get('error','') else '200' if d.get('transaction') else 'ERR')" 2>/dev/null || echo "ERR")
  STATUS_B=$(echo "$RESULT_B" | python3 -c "import sys,json; d=json.load(sys.stdin); print('409' if 'Already converted' in d.get('error','') else '200' if d.get('transaction') else 'ERR')" 2>/dev/null || echo "ERR")

  echo "  Request A: $STATUS_A"
  echo "  Request B: $STATUS_B"

  if [ "$STATUS_A" = "200" ] && [ "$STATUS_B" = "409" ]; then
    echo "  ✅ PASS — exactly 1 winner + 1 × 409"
  elif [ "$STATUS_B" = "200" ] && [ "$STATUS_A" = "409" ]; then
    echo "  ✅ PASS — exactly 1 winner + 1 × 409 (B won)"
  elif [ "$STATUS_A" = "200" ] && [ "$STATUS_B" = "200" ]; then
    echo "  ❌ FAIL — both succeeded (double conversion!)"
  else
    echo "  ⚠️  UNEXPECTED — A=$STATUS_A B=$STATUS_B (check manually)"
  fi
fi
echo ""

# ─── Test 2: Parallel PUTs on the same transaction ─────────────
echo "🔬 Test 2: Two parallel PUTs on the same sale"
echo "──────────────────────────────────────────────────"
if [ -z "$SALE_ID" ]; then
  echo "⏭️  Skipped (no sale found)"
else
  BODY_A='{"type":"sale","partyId":"'"$SALE_PARTY_ID"'","items":[{"productName":"Test Item A","quantity":5,"unitPrice":100,"gstRate":0}],"totalAmount":500,"paidAmount":500,"paymentMode":"cash","date":"2026-07-20"}'
  BODY_B='{"type":"sale","partyId":"'"$SALE_PARTY_ID"'","items":[{"productName":"Test Item B","quantity":3,"unitPrice":200,"gstRate":0}],"totalAmount":600,"paidAmount":600,"paymentMode":"cash","date":"2026-07-20"}'

  RESULT_A=$(req PUT "/api/transactions/${SALE_ID}?id=${SALE_ID}" "$BODY_A" &)
  RESULT_B=$(req PUT "/api/transactions/${SALE_ID}?id=${SALE_ID}" "$BODY_B" &)
  wait

  echo "  Request A response: $(echo "$RESULT_A" | head -c 100)"
  echo "  Request B response: $(echo "$RESULT_B" | head -c 100)"
  echo "  ✅ Check manually: verify stock is correct (not double-reversed)"
fi
echo ""

# ─── Test 3: Parallel credit notes against the same sale ───────
echo "🔬 Test 3: Two parallel credit notes against the same sale"
echo "──────────────────────────────────────────────────────────────"
if [ -z "$SALE_ID" ] || [ "$SALE_TOTAL" = "0" ]; then
  echo "⏭️  Skipped (no sale or zero total)"
else
  CN_AMOUNT=$(python3 -c "print(round($SALE_TOTAL * 0.6, 2))")
  BODY_CN='{"type":"credit-note","partyId":"'"$SALE_PARTY_ID"'","originalTransactionId":"'"$SALE_ID"'","noteType":"credit-note","affectsStock":false,"items":[],"totalAmount":'"$CN_AMOUNT"',"paidAmount":'"$CN_AMOUNT"',"paymentMode":"cash","date":"2026-07-20"}'

  RESULT_A=$(req POST "/api/transactions" "$BODY_CN" &)
  RESULT_B=$(req POST "/api/transactions" "$BODY_CN" &)
  wait

  ERROR_A=$(echo "$RESULT_A" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('error','OK'))" 2>/dev/null || echo "ERR")
  ERROR_B=$(echo "$RESULT_B" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('error','OK'))" 2>/dev/null || echo "ERR")

  echo "  Request A: $ERROR_A"
  echo "  Request B: $ERROR_B"

  if { [ "$ERROR_A" = "OK" ] && [ "$ERROR_B" != "OK" ]; } || { [ "$ERROR_B" = "OK" ] && [ "$ERROR_A" != "OK" ]; }; then
    echo "  ✅ PASS — exactly 1 CN succeeded, the other was rejected (cap holds)"
  elif [ "$ERROR_A" = "OK" ] && [ "$ERROR_B" = "OK" ]; then
    CN_TOTAL=$(python3 -c "print($CN_AMOUNT * 2)")
    echo "  ⚠️  Both succeeded — check if combined ($CN_TOTAL) exceeds sale ($SALE_TOTAL)"
    if [ "$(python3 -c "print(1 if $CN_TOTAL > $SALE_TOTAL else 0)")" = "1" ]; then
      echo "  ❌ FAIL — combined CNs exceed sale total (cap violated!)"
    else
      echo "  ✅ PASS — both fit within the cap"
    fi
  else
    echo "  ⚠️  UNEXPECTED — check manually"
  fi
fi
echo ""

# ─── Test 4: Same-file double bank import ───────────────────────
echo "🔬 Test 4: Same-file double bank import"
echo "──────────────────────────────────────────────────"
CSV_DATA='Date,Description,Amount,Credit,Debit
2026-07-15,UPI/Rahul Traders,500,500,
2026-07-16,UPI/Rajesh Stores,-300,,300'

BODY_IMPORT='{"csv":"'"$CSV_DATA"'","bankName":"Test Bank"}'

RESULT_A=$(req POST "/api/bank-recon/import" "$BODY_IMPORT" &)
RESULT_B=$(req POST "/api/bank-recon/import" "$BODY_IMPORT" &)
wait

ERROR_A=$(echo "$RESULT_A" | python3 -c "import sys,json; d=json.load(sys.stdin); print('409' if 'Duplicate' in d.get('error','') else '200' if d.get('success') else 'ERR')" 2>/dev/null || echo "ERR")
ERROR_B=$(echo "$RESULT_B" | python3 -c "import sys,json; d=json.load(sys.stdin); print('409' if 'Duplicate' in d.get('error','') else '200' if d.get('success') else 'ERR')" 2>/dev/null || echo "ERR")

echo "  Request A: $ERROR_A"
echo "  Request B: $ERROR_B"

if { [ "$ERROR_A" = "200" ] && [ "$ERROR_B" = "409" ]; } || { [ "$ERROR_B" = "200" ] && [ "$ERROR_A" = "409" ]; }; then
  echo "  ✅ PASS — 1 import succeeded + 1 × 409 duplicate"
elif [ "$ERROR_A" = "200" ] && [ "$ERROR_B" = "200" ]; then
  echo "  ❌ FAIL — both imports succeeded (duplicate not caught!)"
else
  echo "  ⚠️  UNEXPECTED — check manually"
fi
echo ""

# ─── Test 5: Mid-restore kill + resume (manual) ────────────────
echo "🔬 Test 5: Mid-restore kill + resume (MANUAL)"
echo "──────────────────────────────────────────────────"
echo "  This test requires a large backup file (>1000 transactions)."
echo "  Steps:"
echo "    1. Download a backup from Settings → Data → Download Backup"
echo "    2. Reset all data (Danger Zone → Reset All Data)"
echo "    3. Start restore with the backup file"
echo "    4. If it takes >20s, you should see:"
echo "       'Restore is taking longer than expected — tap Restore again'"
echo "    5. Tap Restore again with the SAME file"
echo "    6. ✅ Expected: 'Restore resumed — N new, M already present'"
echo "       (NOT: 'Cannot restore into a non-empty shop')"
echo ""
echo "═══════════════════════════════════════════════════════════════"
echo "  Race harness complete."
echo "  Review any ❌ FAIL results above — those indicate concurrency bugs."
echo "═══════════════════════════════════════════════════════════════"
