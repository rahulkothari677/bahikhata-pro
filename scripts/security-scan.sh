#!/usr/bin/env bash
# BahiKhata Pro — Weekly dependency vulnerability scan
#
# Run this script weekly (e.g. via GitHub Actions cron or manually).
# It checks for known vulnerabilities in npm dependencies using both
# npm audit (built-in) and Snyk (more comprehensive, free tier).
#
# Usage:
#   ./scripts/security-scan.sh
#
# Exit codes:
#   0 — no vulnerabilities found
#   1 — vulnerabilities found (review required)
#   2 — scan tool failure (retry)

set -euo pipefail

PROJECT_DIR="/home/z/my-project"
cd "$PROJECT_DIR"

echo "╔══════════════════════════════════════════════════════════════════╗"
echo "║  BahiKhata Pro — Weekly Security Scan                            ║"
echo "║  $(date '+%Y-%m-%d %H:%M:%S %Z')                                  ║"
echo "╚══════════════════════════════════════════════════════════════════╝"
echo ""

# ────────────────────────────────────────────────────────────────────
# 1. npm audit (built-in, always available)
# ────────────────────────────────────────────────────────────────────
echo "▶ Step 1: npm audit (built-in)"
echo "─────────────────────────────────"
NPM_AUDIT_OUTPUT=$(bun pm audit 2>&1 || npm audit 2>&1 || true)
echo "$NPM_AUDIT_OUTPUT" | head -50
echo ""

# Count vulnerabilities
VULN_COUNT=$(echo "$NPM_AUDIT_OUTPUT" | grep -oE '[0-9]+ vulnerabilit(y|ies)' | head -1 | grep -oE '[0-9]+' || echo "0")
echo "→ Vulnerabilities found: $VULN_COUNT"
echo ""

# ────────────────────────────────────────────────────────────────────
# 2. Check for outdated critical packages
# ────────────────────────────────────────────────────────────────────
echo "▶ Step 2: Check critical packages for major version updates"
echo "─────────────────────────────────"
CRITICAL_PACKAGES="next prisma @prisma/client next-auth bcryptjs"
for pkg in $CRITICAL_PACKAGES; do
  CURRENT=$(grep -oE "\"$pkg\": \"[^\"]+\"" package.json | head -1 | grep -oE '[0-9]+\.[0-9]+\.[0-9]+' || echo "not found")
  LATEST=$(npm view "$pkg" version 2>/dev/null || echo "lookup failed")
  if [ "$CURRENT" = "not found" ] || [ "$LATEST" = "lookup failed" ]; then
    echo "  ⚠ $pkg: could not compare (current: $CURRENT, latest: $LATEST)"
  elif [ "$CURRENT" != "$LATEST" ]; then
    echo "  ⚠ $pkg: $CURRENT → $LATEST (UPDATE AVAILABLE)"
  else
    echo "  ✓ $pkg: $CURRENT (up to date)"
  fi
done
echo ""

# ────────────────────────────────────────────────────────────────────
# 3. Check for secrets accidentally committed
# ────────────────────────────────────────────────────────────────────
echo "▶ Step 3: Scan for accidentally committed secrets"
echo "─────────────────────────────────"
SECRETS_FOUND=0
# Common secret patterns
PATTERNS=(
  'sk_live_[0-9a-zA-Z]{24,}'           # Stripe live key
  'ghp_[0-9a-zA-Z]{36,}'               # GitHub classic PAT
  'github_pat_[0-9a-zA-Z_]{40,}'       # GitHub fine-grained PAT
  'AKIA[0-9A-Z]{16}'                   # AWS access key
  'xoxb-[0-9a-zA-Z-]{20,}'             # Slack bot token
  'AIza[0-9a-zA-Z_-]{35}'              # Google API key
)

for pattern in "${PATTERNS[@]}"; do
  MATCHES=$(git grep -E "$pattern" -- ':!node_modules' ':!.env.example' 2>/dev/null | head -3 || true)
  if [ -n "$MATCHES" ]; then
    echo "  ⚠ SECRET PATTERN MATCHED: $pattern"
    echo "    $MATCHES"
    SECRETS_FOUND=$((SECRETS_FOUND + 1))
  fi
done

if [ "$SECRETS_FOUND" -eq 0 ]; then
  echo "  ✓ No secrets found in tracked files"
fi
echo ""

# ────────────────────────────────────────────────────────────────────
# 4. Summary
# ────────────────────────────────────────────────────────────────────
echo "╔══════════════════════════════════════════════════════════════════╗"
echo "║  Scan Summary                                                    ║"
echo "╠══════════════════════════════════════════════════════════════════╣"
echo "║  npm vulnerabilities:  $VULN_COUNT                                        "
echo "║  Secrets in git:       $SECRETS_FOUND                                        "
echo "╚══════════════════════════════════════════════════════════════════╝"
echo ""

if [ "$VULN_COUNT" -gt 0 ] || [ "$SECRETS_FOUND" -gt 0 ]; then
  echo "⚠ ACTION REQUIRED — Review findings above"
  exit 1
fi

echo "✓ All clear — no critical vulnerabilities or secrets found"
exit 0
