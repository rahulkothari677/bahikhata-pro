# V21 Performance Fix — Founder Setup Guide

> **🔒 V21-007**: The auditor's §2.1 finding identified the root cause of the
> 25-30s load times: ~14 authenticated API requests queuing on a connection
> pool with `connection_limit=1`. The code-side fixes are deployed (bootstrap
> consolidation, warmup-first, graceful fallbacks). This document covers the
> **infrastructure-side** fixes that require Vercel/Neon dashboard access.

## The Problem (from the auditor's V21 report)

Your screenshot showed:
- `dashboard` API: **30.27s**
- `subscription/status`: **26.45s → 500**
- `parties`: **22.80s**
- `DOMContentLoaded`: **165ms** (the bundle is NOT the problem)

The 30s is **server-side**: ~14 authenticated API calls fire at once, each
needs a DB connection, but `connection_limit=1` forces them to serialize.

## Code-Side Fixes (already deployed)

| Fix | Commit | What it does |
|-----|--------|-------------|
| V21-006 | `ff16825` | Fire warmup FIRST and ALONE, then release other queries |
| V21-007 | `2a45ede` | `/api/bootstrap` consolidates 3 requests into 1 |
| V21-002 | `38060be` | subscription/status returns degraded response instead of 500 |
| V21-003 | `135ed18` | Standardize settings query key (eliminate redundant fetches) |

These reduce the boot fan-out from ~14 requests to ~11, and ensure they
fire AFTER warmup (DB is awake). But with `connection_limit=1`, even 11
requests serialize.

## Infrastructure Fixes (founder tasks)

### Task 1: Raise `connection_limit` (5 minutes — biggest win)

**Current:** `DATABASE_URL` likely has `connection_limit=1` (recommended by
`src/lib/verify-db-config.ts` for Neon serverless).

**Problem:** With `connection_limit=1`, ALL requests serialize — only 1 DB
query can run at a time. 11 requests × 2s each = 22s.

**Fix:** Raise to `connection_limit=10` (or higher). Neon's PgBouncer pooler
supports far more than 1-2.

**Steps:**
1. Go to Vercel → Settings → Environment Variables
2. Find `DATABASE_URL`
3. Change the query string from `?connection_limit=1` to `?connection_limit=10`
   - Full URL pattern: `postgresql://user:pass@ep-xxx-pooler.region.aws.neon.tech/dbname?sslmode=require&connection_limit=10&pool_timeout=60`
4. Save → Redeploy

**Expected impact:** 11 requests can now run in parallel (up to 10 at a time).
Load time drops from ~22s to ~2-4s.

### Task 2: Disable Neon scale-to-zero (optional but recommended)

**Current:** Neon free tier auto-pauses the DB after 5 min of inactivity.

**Problem:** First request after pause = cold start (3-5s). The warmup
endpoint handles this, but it's still a delay.

**Steps:**
1. Go to Neon Console → your project → Compute → Settings
2. Turn OFF "Suspend compute" (scale-to-zero)
3. The DB stays warm 24/7 (uses Neon free tier compute hours — should be
   fine for a single small DB)

**Alternative:** Keep scale-to-zero but ensure the GitHub Actions warmup
cron (`.github/workflows/neon-warmup.yml`) runs every 5 min (it already does).

### Task 3: Verify the fixes

After deploying Task 1 + 2:

1. Open the app in an incognito window (no cache)
2. Login
3. Open browser DevTools → Network tab
4. Observe the boot sequence:
   - `warmup` fires FIRST (1 request)
   - `bootstrap` fires next (1 request — returns settings + shops + subscription)
   - `dashboard`, `products`, `parties`, `transactions` fire in parallel
   - All should complete in <5s total (was 22-30s)
5. The `subscription/status` endpoint should NOT appear (bootstrap returned it)
6. `settings` should NOT appear as a separate request (bootstrap returned it)
7. `shops` should NOT appear as a separate request (bootstrap returned it)

If you still see 20s+ loads after these fixes, the issue is elsewhere
(check Vercel function logs for slow query execution).

## Summary

| Fix | Who | Effort | Impact |
|-----|-----|--------|--------|
| Bootstrap consolidation | Code (done) | — | 3 requests → 1 |
| Warmup-first gating | Code (done) | — | DB warm before queries |
| Graceful fallbacks | Code (done) | — | No more 500s on slow DB |
| Raise connection_limit | Founder | 5 min | 10× parallelism (biggest win) |
| Disable scale-to-zero | Founder | 2 min | No cold starts |

**Expected result:** 30s → 3-5s load times, without upgrading Neon plan.
