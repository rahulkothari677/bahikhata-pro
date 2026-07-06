# EkBook — Agent Response to V9 Technical Audit Report

**From:** Agent (Rahul's AI engineer)
**To:** Auditor
**Date:** 6 July 2026
**Re:** Response to `EkBook-Technical-Audit-Report.md`
**Commits:** 13 commits across main app + 2 commits across admin repo (all pushed to GitHub)

---

## 0. Executive Summary

Every finding in the audit report has been addressed — either fixed in code, assigned to the founder as an infrastructure task, or deferred with a documented reason. Here is the item-by-item status.

**Key wins:**
- **Loading time:** Eliminated the double dashboard fetch (the two 28s + 41s calls). Now ONE call with IndexedDB cache for instant first-paint on repeat visits.
- **Security:** Closed the cross-tenant stock manipulation IDOR. Admin login now Redis-backed + mandatory 2FA. JWT revocation lag reduced from 30 minutes to ~5 seconds via Redis. Error details no longer leaked to clients. `unsafe-eval` removed from CSP.
- **Correctness:** GST now computed on post-discount taxable value (consistent across sale time, dashboard, reports, GSTR). Invoice numbering is now atomic (no race, no gaps). Offline sync no longer stalls on one bad write.
- **UX:** "Waking up your shop…" message after 3s. First-run modal pile-up gated behind `firstRunComplete`. Persistent stock warning banner. Voided transaction trail filter.

---

## 1. PERFORMANCE & LOADING TIME

### 1.1 [P0] DB asleep + warmup cron misconfigured
**Status:** ✅ Code fixed + ❌ Founder task remaining

- **Code:** Corrected the misleading comment in `warmup/route.ts` — it now accurately describes that GitHub Actions (`neon-warmup.yml`, every 5 min) is the real warmup, and the `vercel.json` daily cron is a fallback. Added cold-start latency logging to the warmup endpoint (`durationMs` + `coldStart` boolean in response + console warning when >2000ms).
- **Founder task (Y1):** Disable Neon "Scale to zero" in the Neon Console. This is the single biggest fix — eliminates the 9-20s cold start entirely. Costs ~$19/mo on Neon Launch tier. Cannot be done from code.

### 1.2 [P0] Dashboard fetched twice on every load
**Status:** ✅ FIXED (Phase 1, commit `6db34c5`)

`Dashboard.tsx` now uses the shared `useDashboard(dateRange)` hook (day-granular canonicalized cache keys) instead of its own inline `useQuery` with millisecond-precision timestamps. Both `Dashboard.tsx` and `page.tsx` now share the same cache key → React Query dedupes to ONE API call.

### 1.3 [P1] Onboarding check runs full analytics
**Status:** ✅ RESOLVED by 1.2

After fixing 1.2, both callers share the same cache → one query, not two. The auditor noted "After 1.2 is fixed this becomes cheap." The alternative (piggyback on `/api/settings`) is not needed.

### 1.4 [P1] Request storm (thundering herd)
**Status:** ✅ PARTIALLY FIXED (Phase 3, commit `8d60f8c`)

- **Done:** Gated `precacheData()` behind warmup completing — `fetch('/api/warmup').then(() => precacheData())`. DB is awake by the time precache's 5 requests hit.
- **Deferred:** The `/api/bootstrap` endpoint suggestion (single round-trip for settings + shops + flags + dashboard-lite). After Phase 1 eliminated the duplicate fetch and Phase 3 gated precache, the remaining herd (shops, settings, products, parties) is much smaller. Building `/api/bootstrap` requires refactoring multiple frontend hooks — high risk for marginal benefit at current scale.

### 1.5 [P2] Per-request aggregation won't scale to billions
**Status:** ❌ DEFERRED

**Reason:** Requires per-user daily rollups (new table + nightly job or incremental on-write + backfill of historical data + dashboard rewrite to read from rollups). 2-3 day project. Not a bug — a scale optimization that's premature until users have 100K+ transactions. The building block (`DailyStats`) already exists for admin-wide metrics.

### 1.6 [P2] Deployment-target mismatch (standalone + Bun vs Vercel)
**Status:** ✅ FIXED (Phase A, commit `bb1020b`)

Confirmed with founder: Vercel only, no self-hosting with Bun. Removed:
- `next.config.ts`: `output: "standalone"` (Vercel ignores it)
- `package.json` `build`: removed `cp -r .next/static .next/standalone/` commands
- `package.json` `start`: changed from `bun .next/standalone/server.js` to `next start -p 3000`

These were dead config that misled debugging.

### 1.7 [P3] Frontend/bundle notes
**Status:** ✅ DONE (Phase A, commit `bb1020b`)

- **1.7a (two fonts):** Reduced from Inter + Plus Jakarta Sans to Inter only. `--font-heading` CSS variable now falls back to `--font-sans` (Inter). Saves one font request.
- **1.7b (PostHog + Vercel Analytics):** Audited. PostHog = event-level analytics (feature usage, funnels, user identification, consent-gated). Vercel Analytics = Core Web Vitals. Different purposes — keeping both. No change.
- **1.7c (good things):** Acknowledged. No action needed.

---

## 2. CORRECTNESS & SECURITY BUGS

### 2.1 [P1] Cross-tenant stock manipulation (IDOR)
**Status:** ✅ FIXED (Phase 2, commit `ec3e054`)

All stock updates changed from `tx.product.update({ where: { id: item.productId } })` to `tx.product.updateMany({ where: { id: item.productId, userId } })`. A foreign product ID now silently affects 0 rows. Applied to POST (create), PUT (edit — both reverse-old + apply-new), DELETE (soft-delete + reverse), and POST restore (undo).

### 2.2 [P1] Money stored as Float
**Status:** ❌ DEFERRED

**Reason:** 2-3 day project. 42 schema fields to migrate. Previous Decimal migration attempt created 126 type errors across 13 files (Prisma Decimal objects don't support JS arithmetic — each needs a manual `Number()` wrapper). Must be done as a dedicated, test-covered phase: write golden tests for GST split, discounts, rounding FIRST, then migrate, then verify all totals unchanged. The `roundMoney()` mitigation is correct interim — it eliminates float drift at every calculation step.

### 2.3 [P2] roundMoney uses 1e-9, not Number.EPSILON
**Status:** ✅ FIXED (Phase 4, commit `d569583`)

Tested `Number.EPSILON` — 3 tests failed (it's too small to fix `1.005` because the float representation error is close in magnitude, and `toFixed()` re-rounds). Kept `1e-9` (empirically correct — smallest nudge that passes all 27 tests) but rewrote the comment to be honest about why `1e-9` is used instead of `Number.EPSILON`. The real fix is the paise migration (2.2).

### 2.4 [P2] Admin login brute-force in-memory
**Status:** ✅ FIXED (Phase 5 + Phase B)

- **Phase 5 (commit `414bf9a`):** Created `admin-rate-limit.ts` with Redis-backed rate limiter (Upstash, same as main app). Keyed by email+IP. Shared across all serverless instances. Falls back to in-memory for dev.
- **Phase B (commit `e172a37`):** Enforced mandatory TOTP 2FA for all admin users. Was: 2FA only checked IF `totpEnabled`. Now: if 2FA is not set up, login is rejected with `2FA_SETUP_REQUIRED` message.

### 2.5 [P2] Dashboard 500 leaks error details
**Status:** ✅ FIXED (Phase 2, commit `ec3e054`)

Returns generic "An internal error occurred" + an `errorId` (e.g. `dash-1234567890-abc123`) for support lookup. Full error logged server-side + captured by Sentry. The `useDashboard` hook also updated to show the generic message + errorId instead of raw error detail.

### 2.6 [P2] CSP allows unsafe-inline + unsafe-eval
**Status:** ✅ PARTIALLY FIXED

- **`unsafe-eval` removed** (Phase 6, commit `d444580`). This is the bigger security win.
- **Nonce-based CSP attempted and reverted** (Phase D, commit `5a06c3a` → reverted in commit `2f99980`). The nonce approach caused CSP violations that blocked PostHog, Sentry, and Vercel Analytics (per CSP spec, when a nonce is present, browsers IGNORE `'unsafe-inline'`). Reverted to `'unsafe-inline'` without nonce.
- **`unsafe-inline` kept** because Next.js injects inline scripts for hydration and third-party scripts load dynamically. Full nonce-based CSP requires migrating ALL script loading to Next.js `<Script>` component — a larger refactor, deferred.
- **Improvement kept from Phase D:** CSP is now in middleware (not `next.config.ts`) and the matcher covers all routes (not just API).

### 2.7 [P2] Invoice-number race condition
**Status:** ✅ FIXED (Phase 4, commit `d569583`)

New `InvoiceCounter` model (`userId → seq`). The `upsert({ update: { seq: { increment: 1 } } })` is atomic at the row level — no race, no gaps, no retry needed. Migration `20260706000001_add_invoice_counter` creates the table + backfills each user's counter to their current max `invoiceSequence`. The retry loop is kept as a safety net but should be a no-op.

### 2.8 [P3] JWT revocation lag up to 30 minutes
**Status:** ✅ FIXED (Phase C, commit `f09a7d0`)

`tokenVersion` is now cached in Redis with a 5-second TTL. On every request, the JWT callback checks Redis (~2ms) instead of the DB (~50ms). When `tokenVersion` is bumped (password reset, logout all), the Redis cache is explicitly invalidated → revocation takes effect within ~5 seconds (was 30 minutes). Falls back to 5-minute DB check if Redis is down (was 30 minutes).

`invalidateTokenVersionCache()` is called in both `revoke-all/route.ts` and `reset-confirm/route.ts` after bumping `tokenVersion`.

### 2.9 [P3] Offline sync stalls on first 5xx
**Status:** ✅ FIXED (Phase 4 + Phase B)

- **Phase 4 (commit `d569583`):** Changed `break` to `continue` for both 5xx and network errors. Failing items no longer block subsequent items.
- **Phase B (commit `34afbe6`):** Added per-item attempt tracking. Each pending write has an `attempts` counter. After 5 failed attempts, the item is dropped (quarantined) with a console warning. New `updatePendingWriteAttempts()` in `offline-db.ts`.

### 2.10 [P3] Negative stock allowed silently
**Status:** ✅ DONE (by design + V9 Phase 6)

Overselling returns `stockWarnings` but still commits — this is a **deliberate product decision** (kirana shops sell before recording purchases). V9 Phase 6 (commit `d444580`) added a persistent rose-colored banner at the top of the sale entry form showing each affected product (name, had/sold/now stock). Banner stays until dismissed via X button. Toast also fires for immediate feedback.

---

## 3. SCALABILITY & ARCHITECTURE

### 3.1 [P1] Single Postgres, no partitioning or read replicas
**Status:** ❌ DEFERRED — Infrastructure decision

**Reason:** Requires Neon plan upgrade ($19+/mo), DBA-level planning, and migration strategy. Not a code change — founder + DBA task. Partitioning is needed at 10M+ rows; read replicas for admin analytics separation. The code is ready for these (all queries use indexes, `activeTransactionWhere` filters are index-friendly).

### 3.2 [P1] Admin panel shares production DB
**Status:** ❌ DEFERRED — Infrastructure decision

**Reason:** Requires Neon read replica setup first. Once infra is ready, it's a one-day change: point admin app's `DATABASE_URL` to the replica. The admin app already uses a separate `READONLY_DATABASE_URL` for the SQL console (V6 SC4). The schema comment noting `@ekbook/prisma` as the intended future is acknowledged.

### 3.3 [P2] No materialized rollups
**Status:** ❌ DEFERRED — Same as 1.5

**Reason:** Same as 1.5. Per-user daily rollups are essential before scale but are a 2-3 day architecture project (new table + nightly job + backfill + dashboard rewrite).

### 3.4 [P2] Connection model under real concurrency
**Status:** ❌ DEFERRED — Founder task

**Reason:** Needs load testing (k6/Locust) + Neon pooler ceiling validation. The `connection_limit=1` + pooler config is correct for serverless. The `withConnectionRetry()` wrapper in `db.ts` handles transient pool timeouts. Load testing requires a test environment — founder task.

### 3.5 [P2] Large API surface (124 endpoints)
**Status:** ❌ DEFERRED — Product decision

**Reason:** Founder needs to decide which of the 80 admin routes are v1 vs later. Feature-flagging off unused subsystems is a product strategy decision, not a code fix.

### 3.6 [P3] Test coverage for money math + tenant isolation
**Status:** ✅ PARTIALLY DONE

- **Money math:** 27 unit tests in `money.test.ts` (roundMoney, addMoney, splitGst, calculateGst, formatINR, parseMoney).
- **Reconciliation:** 17 tests in `reconciliation.test.ts` (party balance formula, GST taxable reconciliation, B2CL classification).
- **Tenant isolation:** 11 tests in `tenant-isolation.test.ts` (Phase B, commit `34afbe6`) — validates `activeTransactionWhere` always includes `userId` + `deletedAt: null`, stock update patterns include `userId`, invoice counter is scoped by `userId`.
- **Raw SQL:** 13 tests in `raw-sql-smoke.test.ts` — catches CR1-class bugs (missing parens, unbalanced SQL).
- **Total:** 75 tests passing.
- **Deferred:** Full integration tests hitting real DB with two users. Needs a test database setup — founder task.

---

## 4. UI / UX

### 4.1 [P1] Bare spinner for up to 40 seconds
**Status:** ✅ FIXED (Phase 3 + Phase D)

- **Phase 3 (commit `8d60f8c` + `2a90eb2`):** After 3 seconds of loading, the skeleton is replaced by a centered, colorful saffron spinner with "Waking up your shop…" and "Almost there — just a moment." Timer auto-clears when loading completes.
- **Phase D (commit `5a06c3a`):** IndexedDB cache for instant first-paint. On repeat visits, reads cached dashboard data from IndexedDB (~1ms) and shows it as `placeholderData`. User sees their real data INSTANTLY, then it refreshes in the background.

### 4.2 [P2] First-run modal pile-up
**Status:** ✅ FIXED (Phase 6, commit `d444580`)

`RatePromptModal` and `PWAInstallPrompt` are now gated behind `firstRunComplete` — a state set true after the tour is done (new users) or immediately for existing users (no onboarding shown). Low-priority modals wait their turn instead of piling up.

### 4.3 [P2] Consolidate bootstrap endpoint
**Status:** ❌ DEFERRED — Same as 1.4

**Reason:** Phase 1 eliminated the duplicate fetch (biggest herd contributor). Phase 3 gated precache behind warmup. Phase D added instant first-paint from IndexedDB cache. The remaining herd (shops, settings, products, parties) is much smaller. Building `/api/bootstrap` requires refactoring multiple frontend hooks to consume a single response — high risk for marginal benefit at current scale.

### 4.4 [P3] Surface oversell warnings visibly
**Status:** ✅ FIXED (Phase 6, commit `d444580`)

Persistent rose-colored banner at the top of the sale entry form showing each affected product (name, had/sold/now stock). Banner stays until dismissed via X button. Toast also fires for immediate feedback.

---

## 5. QUICK WINS

| # | Quick Win | Status |
|---|---|---|
| 1 | Fix warmup schedule / disable Neon scale-to-zero | ✅ Comment fixed, ❌ Neon = founder task |
| 2 | Dashboard uses shared hook | ✅ DONE |
| 3 | Scope stock updates by userId | ✅ DONE |
| 4 | Stop leaking DB error detail | ✅ DONE |
| 5 | Admin login Redis + force 2FA | ✅ DONE |
| 6 | Skeletons + "waking up" message | ✅ DONE |
| 7 | Correct misleading comments | ✅ DONE |

---

## 6. RECOMMENDATIONS

| # | Recommendation | Status |
|---|---|---|
| 1 | Decide deployment target (1.6) | ✅ DONE — Vercel only, removed Bun/standalone |
| 2 | Money→paise migration (2.2) | ❌ DEFERRED — dedicated project, 2-3 days, high risk |
| 3 | Per-user daily rollups (1.5/3.3) | ❌ DEFERRED — architecture change, premature until 100K+ txns |
| 4 | Separate OLTP from analytics (3.1/3.2) | ❌ DEFERRED — infra decision, needs Neon plan upgrade |
| 5 | Load test + tenant-isolation tests (3.4/3.6) | ✅ Tenant-isolation unit tests done (11 tests). Load test = founder task. |
| 6 | DPDP Act posture | ✅ Already done — audit logs, consent modal, account export/delete, lending models removed |
| 7 | Observability: cold-start frequency logging | ✅ DONE — warmup endpoint logs `durationMs` + `coldStart` boolean |
| 8 | Confirm Neon PITR backups | ❌ Founder verification task (Neon Console) |

---

## FOUNDER TASKS (cannot be done from code)

| # | Task | Impact | Status |
|---|---|---|---|
| **Y1** | Disable Neon scale-to-zero ($19/mo Launch tier) | Eliminates 9-20s cold starts. THE #1 fix. | ❌ Pending |
| **Y3** | Configure Resend (password reset emails) | Unlocks password reset | ❌ Pending |
| **Y4** | Create read-only Postgres role (admin SQL console) | Unlocks admin SQL console | ❌ Pending |
| **Y5** | Verify Vercel region == Neon region | Reduces per-query latency | ❌ Pending |
| **Y6** | Set Upstash Redis env vars in admin Vercel | Activates Redis-backed admin login limiter + mandatory 2FA | ❌ Pending |
| **Y7** | Verify Neon PITR (point-in-time recovery) is enabled | Ledger app must restore to any minute | ❌ Pending |
| **Y8** | Set up 2FA in admin panel (now MANDATORY) | Can't log in without it after Phase B deploy | ❌ Pending |

---

## DEFERRED ITEMS — DETAILED REASONS FOR AUDITOR

### D1: Money Float → integer paise migration (§2.2)
**Effort:** 2-3 days, high risk.
**Why deferred:** 42 schema fields. Previous Decimal migration attempt created 126 type errors (Prisma Decimal objects don't support JS arithmetic — each needs manual `Number()` wrapper, missing one = runtime crash in a financial app). Must be done as: (1) write golden tests for GST split, discounts, rounding, (2) migrate, (3) verify all totals unchanged. The `roundMoney()` mitigation is correct interim — it eliminates float drift at every calculation step. 75 unit tests verify the current behavior.

### D2: Per-user daily rollups (§1.5/3.3)
**Effort:** 2-3 days, architecture change.
**Why deferred:** Requires: new `UserDailyStats` table, nightly job (or incremental on-write), backfill of historical data, dashboard rewrite to read from rollups. Not a bug — a scale optimization. Premature until users have 100K+ transactions. The building block (`DailyStats`) already exists for admin-wide metrics.

### D3: Partitioning / read replicas (§3.1/3.2)
**Effort:** Infrastructure decision + DBA planning.
**Why deferred:** Requires Neon plan upgrade ($19+/mo). Partitioning needed at 10M+ rows. Read replica for admin analytics is a one-day change once infra is ready. The code is ready (all queries use indexes, `activeTransactionWhere` is index-friendly).

### D4: /api/bootstrap endpoint (§4.3/1.4)
**Effort:** 4 hours, medium risk.
**Why deferred:** Phase 1 eliminated the duplicate dashboard fetch (the biggest herd contributor — was 2 calls, now 1). Phase 3 gated precache behind warmup. Phase D added instant first-paint from IndexedDB cache. The remaining herd (shops, settings, products, parties) is small. Building `/api/bootstrap` requires refactoring multiple frontend hooks to consume a single response — high risk of breaking the app for marginal benefit.

### D5: Full nonce-based CSP (§2.6)
**Effort:** 3+ hours, medium risk.
**Why deferred:** Attempted in Phase D — caused CSP violations that blocked PostHog, Sentry, and Vercel Analytics. Per CSP spec, when a nonce is present, browsers IGNORE `'unsafe-inline'`. Only scripts with the exact nonce can execute, but third-party scripts load dynamically without the nonce. Full nonce-based CSP requires migrating ALL script loading to Next.js `<Script>` component with strategy — a larger refactor. `unsafe-eval` was already removed (the bigger security win).

### D6: Load test (§3.4)
**Effort:** 1 day, needs test environment.
**Why deferred:** Needs k6/Locust setup + test database. Founder task.

---

## VERIFICATION

- ✅ `npx tsc --noEmit` — 0 new errors
- ✅ `npx next build` — ✓ Compiled successfully
- ✅ `npx jest` — 75/75 tests pass (money, reconciliation, tenant-isolation, raw-sql-smoke, auth-token-version)
- ✅ All commits pushed to `origin/main` (main app + admin repo)

---

## COMMITS (chronological)

### Main App
| Commit | Phase | What |
|---|---|---|
| `6db34c5` | Phase 1 | Double dashboard fetch + warmup comments |
| `ec3e054` | Phase 2 | Cross-tenant stock + error detail leak |
| `8d60f8c` | Phase 3 | Gate precache behind warmup + "waking up" message |
| `2a90eb2` | Phase 3 | Centered colorful "waking up" spinner |
| `d569583` | Phase 4 | roundMoney + invoice race + offline sync |
| `d444580` | Phase 6 | CSP unsafe-eval removal + modal pile-up + stock banner |
| `bb1020b` | Phase A | vercel.json + standalone removal + one font + analytics audit |
| `5104f1e` | Phase A fix | Remove invalid $comment from vercel.json |
| `34afbe6` | Phase B | Mandatory 2FA + offline sync attempts + tenant tests + warmup logging |
| `f09a7d0` | Phase C | JWT revocation 30 min → 5 sec via Redis |
| `5a06c3a` | Phase D | Nonce-based CSP + IndexedDB first-paint |
| `2f99980` | Phase D fix | Revert nonce CSP (blocked scripts) |

### Admin Repo
| Commit | Phase | What |
|---|---|---|
| `414bf9a` | Phase 5 | Redis-backed admin login rate limiter |
| `e172a37` | Phase B | Enforce mandatory TOTP 2FA |

---

*This document is the complete response to the V9 Technical Audit Report. Every finding is addressed — fixed, assigned to founder, or deferred with a documented reason.*
