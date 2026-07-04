# BahiKhata Pro — Audit Analysis & Fix Plan

**Date:** 4 July 2026
**Based on:** Three external audit reports (V4 Complete Assessment, Code Audit, Launch Audit) verified against the actual codebase at this revision.
**Status:** Phase 1 fixes in progress.

---

## Table of Contents

1. [Audit Verification Summary](#1-audit-verification-summary)
2. [Categorized Fix Plan](#2-categorized-fix-plan)
3. [Step-by-Step Guides for Things YOU Need to Do](#3-step-by-step-guides-for-things-you-need-to-do)
4. [Issues YOU Must Fix (Legal/Operational)](#4-issues-you-must-fix-legaloperational)
5. [Phase Tracker](#5-phase-tracker)

---

## 1. Audit Verification Summary

I verified all 20 specific technical claims from the three audit reports against this codebase. **15 are CONFIRMED, 3 are PARTIALLY TRUE, and 3 are NOT FOUND** (already removed or based on an older revision).

### ✅ Confirmed Issues (15)

| # | Issue | File | Severity |
|---|---|---|---|
| 1 | `prisma db push --accept-data-loss` in build script | `package.json:7` | 🔴 Critical |
| 2 | Money stored as `Float` (24+ fields) | `prisma/schema.prisma` | 🔴 Critical |
| 3 | GST split `itemGst / 2` on floats | `transactions/route.ts:96-106` | 🔴 High |
| 4 | In-memory `Map` rate limiting | `lib/rate-limit.ts:25` | 🔴 High |
| 5 | Hardcoded `NEXTAUTH_SECRET` fallback | `lib/auth.ts:91` | 🔴 Critical |
| 6 | Prisma logs every query in production | `lib/db.ts:9-11` | 🟠 Medium |
| 7 | Zero `$transaction` usage (non-atomic writes) | entire `src/` | 🔴 High |
| 8 | Payment verify not idempotent (re-extends plan) | `payment/verify/route.ts` | 🟠 Medium |
| 9 | No `maxDuration` on any API route | all route files | 🟠 Medium |
| 10 | Unbounded `limit` param (OOM risk) | `transactions/route.ts:12-14` | 🟠 Medium |
| 11 | Party balances recomputed in JS | `parties/route.ts:11-43` | 🟠 Medium |
| 12 | Password minimum only 6 chars | `auth/register/route.ts:21` | 🟠 Medium |
| 13 | 30-day JWT, no revocation mechanism | `lib/auth.ts:64-67` | 🟠 Medium |
| 14 | `cuid()` string PKs on billion-row tables | `schema.prisma` | 🟡 Low (scale) |
| 15 | No table partitioning, no migrations folder | `prisma/` | 🟡 Low (scale) |

### 🟡 Partially True (3)

| # | Issue | Reality |
|---|---|---|
| 16 | Payment verify "creates duplicate subscriptions" | The `id = sub_<paymentId>` trick prevents duplicate rows, BUT a replay still re-extends `renewsAt` because `user.update` runs before `subscription.create` throws. Not idempotent, but not as bad as claimed. |
| 17 | Admin CSRF allows missing Origin | There's **no admin middleware at all**. The Pro app's CSRF allows missing Origin if Referer is present. |
| 18 | "db push drops admin tables" comment | Confirmed — but this is your own comment acknowledging the bug. |

### ❌ NOT FOUND in Current Code (3) — audits were based on an older revision

| # | Claimed Issue | Reality |
|---|---|---|
| 19 | Lending pipeline (`lib/lending-pipeline.ts`, `lib/credit-score.ts`, `data-monetization/*`) | **These files do not exist.** Only dormant schema models (`CreditScoreCache`, `Partner`) remain. Safe to drop. |
| 20 | `/api/admin/login-debug` endpoint | **Does not exist.** Already deleted. |
| 21 | Admin raw-SQL runner (`$queryRawUnsafe`) | **Zero matches.** Already gone. |

**Key relief:** The #1 risk flagged in all three reports — the lending pipeline — **does not exist as live code**. Only dormant schema tables remain, which we'll drop in Phase 1.

---

## 2. Categorized Fix Plan

### Category A: Technical Code Issues — I (the AI) fix these

#### Phase 1 — Quick Critical Fixes (no external dependencies needed)

| # | Fix | Effort | Status |
|---|---|---|---|
| 1.1 | Remove `NEXTAUTH_SECRET` fallback; fail-hard if missing | 5 min | ✅ Done |
| 1.2 | Set Prisma logging to `['error','warn']` in production | 5 min | ✅ Done |
| 1.3 | Add `maxDuration` to heavy routes (scan-bill, voice-parse, reports, gstr-export) | 10 min | ✅ Done |
| 1.4 | Add `$transaction` + idempotency to payment verify (`@@unique([paymentId])`) | 1-2 hr | ✅ Done |
| 1.5 | Cap list endpoints at 200 (prevent OOM) | 30 min | ✅ Done |
| 1.6 | Drop dormant `CreditScoreCache` + `Partner` models | 10 min | ✅ Done |
| 1.7 | Raise password minimum from 6 to 8 characters | 5 min | ✅ Done |

#### Phase 2 — After YOU complete the 3 setup tasks (see Section 3)

| # | Fix | Effort | Depends on |
|---|---|---|---|
| 2.1 | Switch build from `db push` to `migrate deploy` | ½ day | Neon snapshot (your task) |
| 2.2 | Move rate limits to Redis (Upstash) | 1 day | Upstash account (your task) |
| 2.3 | Configure Neon pooled endpoint + `connection_limit=1` | 1-2 hr | Pooled URL (your task) |

#### Phase 3 — Medium fixes (I can do after Phase 2)

| # | Fix | Effort |
|---|---|---|
| 3.1 | Derive GST interstate split server-side from state codes | 2 hr |
| 3.2 | Move party balances + dashboard totals to SQL aggregates | 2-3 hr |
| 3.3 | Shorten JWT to 7 days + add `tokenVersion` for revocation | 3-4 hr |

#### Phase 4 — Large fix (careful, phased migration)

| # | Fix | Effort |
|---|---|---|
| 4.1 | Migrate money Float → integer paise (BigInt) | 2-3 days |

#### Phase 5 — Scale fixes (before 1M users)

| # | Fix | Effort |
|---|---|---|
| 5.1 | Move AI scanning + report generation to background jobs (Upstash QStash) | 2-3 days |
| 5.2 | Partition big tables by `createdAt` (monthly) | 1-2 days |
| 5.3 | Switch high-volume tables to `BigInt` PKs | 1-2 days |
| 5.4 | Add BRIN indexes on `createdAt` for append-only tables | 1 hr |

### Category B: Needs Your Decision First

| # | Decision | My recommendation |
|---|---|---|
| B1 | Keep `Float` money or migrate to paise? | Migrate to paise (Phase 4). Eliminates a class of bugs that destroys bookkeeping trust. |
| B2 | Single schema vs. duplicated admin tables? | Once `db push` is gone, admin table duplication hack can be removed. Admin repo should own its tables. |
| B3 | Redis provider? | Upstash (free tier, serverless-friendly). |
| B4 | Drop lending/credit-score schema models? | Yes — Phase 1.6 does this. Removes regulatory risk. |

### Category C: Legal / Regulatory — YOU must fix (with professionals)

See Section 4 below.

### Category D: Operational — YOU must fix

See Section 4 below.

---

## 3. Step-by-Step Guides for Things YOU Need to Do

These three tasks unlock Phase 2. Do them in any order — all three are needed before I can proceed.

### Task 1: Take a Neon Database Snapshot

**Why:** Before I switch the build script from `db push` to `migrate deploy`, we need a snapshot so we can restore if anything goes wrong during the first migration.

**Step-by-step:**

1. **Log in to Neon** at https://console.neon.tech
2. **Select your project** (the one BahiKhata Pro uses)
3. **Go to the "Branches" tab** in the left sidebar
4. **Find your `main` branch** (or whatever your production branch is called)
5. **Click on the branch name** to open it
6. **Click the "Create branch" button** (top right)
7. **Name it:** `pre-migration-backup-2026-07-04` (or today's date)
8. **Select "Copy from current branch"** — this creates a full copy of all data
9. **Click "Create branch"**
10. **Wait for it to finish** (takes 1-5 minutes depending on data size)
11. **Verify:** Click on the new branch, go to "Tables", confirm your tables are there

**Alternative (simpler):** Neon also supports PITR (Point-in-Time Recovery):
1. In your project, go to **Settings → Integrations → Backups**
2. Confirm PITR is enabled (it's free on all paid plans, and on free with 7-day history)
3. Note the current time — if something breaks, you can restore to this exact moment

**Tell me when done:** Just say "Neon snapshot taken" and I'll proceed with Phase 2.1.

---

### Task 2: Create an Upstash Redis Account

**Why:** Your rate limiting and AI usage quotas are currently stored in server memory, which doesn't work on Vercel (each serverless instance has its own memory). Redis gives all instances a shared memory.

**Step-by-step:**

1. **Go to** https://upstash.com
2. **Click "Sign Up"** (free, no credit card needed)
3. **Sign up with GitHub or Google** (easiest)
4. **Once logged in, click "Create Database"**
5. **Fill in:**
   - **Name:** `bahikhata-ratelimit`
   - **Primary Region:** `ap-south-1 (Mumbai)` — closest to your Indian users
   - **Type:** `Regional` (free tier, sufficient for now)
   - **TLS:** leave enabled (default)
6. **Click "Create"**
7. **Wait for it to provision** (10-20 seconds)
8. **Once created, click on the database name** to open it
9. **Find the "REST API" section** in the left sidebar
10. **Copy these two values:**
    - `UPSTASH_REDIS_REST_URL` — looks like `https://xxx-xxx-xxx.upstash.io`
    - `UPSTASH_REDIS_REST_TOKEN` — a long string of letters/numbers

**Add them to Vercel:**
1. Go to your Vercel project: https://vercel.com/rahulkothari677/bahikhata-pro
2. **Settings → Environment Variables**
3. **Add two variables:**
   - Key: `UPSTASH_REDIS_REST_URL` | Value: (paste from Upstash) | Environments: Production + Preview
   - Key: `UPSTASH_REDIS_REST_TOKEN` | Value: (paste from Upstash) | Environments: Production + Preview
4. **Click "Save"** for each

**Tell me when done:** Share the two env var names (NOT the values) and say "Upstash configured" — I'll proceed with Phase 2.2.

**Free tier limits:** 10,000 commands/day. Rate limiting uses ~2-3 commands per request, so this covers ~3,000-5,000 requests/day. Upgrade to paid (~$1/month) when you exceed this.

---

### Task 3: Get the Neon Pooled Connection String

**Why:** Your database currently has no connection pooler. Under load, Vercel spins up hundreds of server instances, each opens its own DB connections, and Postgres runs out of connections → everything crashes. The pooled endpoint fixes this.

**Step-by-step:**

1. **Log in to Neon** at https://console.neon.tech
2. **Select your project**
3. **Go to the "Dashboard" tab** (or "Connection Details")
4. **Find the "Connection String" section**
5. **Look for TWO connection strings:**
   - **"Pooled connection"** — has `-pooler` in the hostname (this is what we want)
   - **"Direct connection"** — no `-pooler` (we'll use this only for migrations)

6. **Copy the POOLED connection string** — it looks like:
   ```
   postgresql://neondb_owner:password@ep-xxx-xxx-pooler.region.aws.neon.tech/neondb?sslmode=require
   ```
   Notice the `-pooler` in the hostname.

7. **Also copy the DIRECT connection string** — it looks like:
   ```
   postgresql://neondb_owner:password@ep-xxx-xxx.region.aws.neon.tech/neondb?sslmode=require
   ```
   No `-pooler` in the hostname.

**Update Vercel environment variables:**
1. Go to Vercel: **Settings → Environment Variables**
2. **Update `DATABASE_URL`:**
   - Set to the **POOLED** connection string
   - Add `&pgbouncer=true&connection_limit=1` to the end
   - Final value looks like:
     ```
     postgresql://...@ep-xxx-pooler.region.aws.neon.tech/neondb?sslmode=require&pgbouncer=true&connection_limit=1
     ```
   - Environments: Production + Preview
3. **Add a NEW variable `DIRECT_URL`:**
   - Set to the **DIRECT** connection string (no `-pooler`)
   - Environments: Production + Preview
4. **Click "Save"** for each

**Tell me when done:** Say "Neon pooled connection configured" and I'll proceed with Phase 2.3.

---

## 4. Issues YOU Must Fix (Legal/Operational)

These cannot be done by me. They require licensed professionals or business decisions.

### Legal / Regulatory (with professionals)

| # | Item | Who does it | Cost estimate | Deadline |
|---|---|---|---|---|
| C1 | **Incorporate a Private Limited Company** | CA + lawyer | ₹10-25k | Before launch |
| C2 | **Trademark search + filing** (the "Bahi Khata" name is crowded) | Trademark attorney | ₹5-15k | Before marketing spend |
| C3 | **GST registration** (you must charge 18% on subscriptions) | CA | ₹3-8k/mo retainer | Before first paid subscription |
| C4 | **DLT registration** (Principal Entity + sender IDs + templates) | You + telecom | Nominal fee, weeks of latency | Start immediately |
| C5 | **Privacy Policy + ToS + Refund Policy** (DPDP-aligned, multilingual) | Fintech lawyer | ₹25-50k | Before launch |
| C6 | **DPDP consent architecture** (consent records, withdrawal UI, erasure pipeline) | You build (I help code), lawyer reviews notice | — | Before 13 May 2027 |
| C7 | **CERT-In incident response plan + 6-hour reporting template** | Lawyer + you | ₹10-20k | Before launch |
| C8 | **Cyber-liability + E&O insurance** | Insurance broker | ₹1-3 lakh/yr premium | Before launch |
| C9 | **If lending ever ships:** NBFC RE contract + CIMS registration + KFS flow | Fintech lawyer + NBFC partner | ₹1-5 lakh legal | Only if you build lending |
| C10 | **Professional penetration test (VAPT)** | Security firm | ₹1-3 lakh | Before approaching investors |

### Operational / Business

| # | Item | Why |
|---|---|---|
| D1 | **Hire support staff or outsource** before marketing spend | Solo founder can't handle hundreds of daily merchant calls |
| D2 | **Document runbooks** (deploy, rollback, DB failover, restore, incident comms) | Bus factor = 1; "sick you at 3am" is a stranger |
| D3 | **Set up uptime monitoring + paging to your phone** (BetterStack/UptimeRobot) | You can't fix what you can't see |
| D4 | **Monthly backup restore drill** (timed, documented) | An untested backup is a hope, not a backup |
| D5 | **Load test at honest Day-1 estimate × 3** with k6/Locust | "1 lakh concurrent" must be measured, not hoped |
| D6 | **Build a per-user unit-cost sheet** (infra + SMS + AI + PG per merchant/month) | Freemium khata apps have bled out on this |
| D7 | **Get a co-founder or first engineer within 6 months** | Solo founder burnout is a top killer |
| D8 | **Signed Play Store APK + listing** (Data Safety form must match privacy policy) | Mobile distribution |

---

## 5. Phase Tracker

### Phase 1 — Quick Critical Fixes ✅ COMPLETE (committed a2cfa61)

- [x] 1.1 Remove `NEXTAUTH_SECRET` fallback
- [x] 1.2 Fix Prisma production logging
- [x] 1.3 Add `maxDuration` to heavy routes
- [x] 1.4 Add `$transaction` + idempotency to payment verify
- [x] 1.5 Cap list endpoints at 200
- [x] 1.6 Drop dormant `CreditScoreCache` + `Partner` models
- [x] 1.7 Raise password minimum to 8 characters
- [x] Build verified + pushed to GitHub

**Bug fixes found during build verification (pre-existing issues also fixed):**
- Renamed `use-paywall.ts` → `.tsx` (JSX in .ts file)
- Fixed type errors in `use-paywall`, `admin/features`, `CameraPreviewModal`, `calendar`, `resizable`
- Added `@default(cuid())` + `@updatedAt` to `Referral`, `UsageTracking`, `FeatureFlag` models
- Excluded `bahikhata-admin/`, `tool-results/`, config files from `tsconfig`
- Installed 20+ missing npm dependencies (radix-ui, react-day-picker, react-hook-form, etc.)

### Phase 2 — Migrate deploy + Redis rate limiting ✅ COMPLETE (committed 7d890a9)

- [x] 2.1 Add `directUrl` to Prisma schema (DIRECT_URL for migrations, DATABASE_URL for runtime)
- [x] 2.2 Generate baseline migration (`prisma/migrations/0_init/migration.sql`, 1196 lines)
- [x] 2.3 Switch build from `db push --accept-data-loss` to `migrate deploy` (with baseline resolve)
- [x] 2.4 Install `@upstash/ratelimit` + `@upstash/redis`
- [x] 2.5 Rewrite `rate-limit.ts` to use Upstash Redis (with in-memory fallback)
- [x] 2.6 Update all 6 callers to use `await` (rateLimit is now async)
- [x] Build verified + pushed to GitHub

### Phase 3 — Medium fixes (after Phase 2)

- [ ] 3.1 Derive GST interstate split server-side
- [ ] 3.2 Move party balances to SQL aggregates
- [ ] 3.3 Shorten JWT + add tokenVersion

### Phase 4 — Large fix

- [ ] 4.1 Migrate money Float → integer paise

### Phase 5 — Scale fixes (before 1M users)

- [ ] 5.1 Background jobs for AI scanning
- [ ] 5.2 Table partitioning
- [ ] 5.3 BigInt PKs
- [ ] 5.4 BRIN indexes

---

*This document is the single source of truth for the audit fix plan. Updated as each phase completes.*
