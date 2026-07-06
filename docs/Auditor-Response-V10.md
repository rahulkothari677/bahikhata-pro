# Auditor Response V10 — GST-on-Discount + Single Source of Truth + Hardening

**Prepared:** 2026-07-06
**Inputs reviewed:** `EkBook-Audit-V10.md` (the V10 deep audit) and the agent's `Auditor-Response-V9.md`
**Method:** File-by-file diff of v13→v14. Every Tier-0 finding traced end-to-end (UI → API → DB → reports → GSTR). Golden test added asserting `tax == taxable × rate` per slab.

---

## 0. TL;DR

The V10 audit validated the V9 work (graded B+/A−) and found one **CRITICAL P0** correctness bug the agent (and every prior audit) missed: **GST was computed on the pre-discount amount**, making every discounted sale overcharge GST and produce a non-filable GSTR-1.

**All Tier-0 items fixed:**

| # | Finding | Verdict |
|---|---|---|
| §2.1 | GST on pre-discount amount → non-filable GSTR | ✅ Fixed + golden test + recompute script |
| §2.2 | GST computed two different ways → drift | ✅ Fixed — single source of truth (per-item CGST/SGST/IGST) |
| §2.3 | Three different rounding functions | ✅ Fixed — client now uses shared `roundMoney` |
| §2.4 | Profit overstated by discount amount | ✅ Fixed — profit on post-discount realized price |
| §3.4 | Mandatory 2FA lockout trap | ⏭️ Founder task (admin repo — out of scope) |
| §3.3 | Error-detail leakage (8 routes) | ✅ Fixed — shared `apiError()` helper |
| §3.7 | Shop-state cache stale across instances | ✅ Fixed — cache dropped (direct PK lookup is ~1-2ms) |
| §1.1 | Verify warmup GitHub Action exists | ✅ Verified — `.github/workflows/neon-warmup.yml` runs every 5 min |
| §3.2 | chart.tsx dangerouslySetInnerHTML | ✅ Verified safe — no user input reaches ChartConfig |
| §3.6 | Admin JWT no tokenVersion | ⏭️ Founder task (admin repo — out of scope) |

**Verification:** `npx tsc --noEmit` shows only 5 pre-existing errors in `validation.test.ts` (unrelated). `npm run build` compiles successfully. `jest` 51/51 pass (40 existing + 11 new golden tests).

---

## 1. Tier 0 — Correctness (the stuff that makes or breaks a ledger)

### 1.1 §2.1 — GST charged on pre-discount amount [P0 CRITICAL] ✅ FIXED

**The bug (auditor's finding, verified):**
- UI (`TransactionEntry.tsx:381-389`) collected discount as a single order-level field and sent it as `discountAmount: totalDiscount`. Every line item was sent with `discountAmount: 0`.
- Server (`transactions/route.ts:198-212`) computed GST per item on `taxableAmount = (qty × price) − itemDiscount`, but `itemDiscount` was always 0. So GST was computed on the **full undiscounted** amount.
- Then `totalAmount = subtotal − discount + cgst + sgst + igst` — the order-level discount was subtracted AFTER GST was already added on the full amount.
- The V8 comment in the code claimed *"GST is now computed on the POST-DISCOUNT taxable value… All screens now agree."* — **false in practice**. It only handled *item-level* discount, which the UI never populated. The real (order-level) discount bypassed the GST base entirely.

**Worked example (auditor's, now verified by golden test):**
₹1,000 sale, ₹100 discount, 18% GST:
| | Taxable | GST | Effective rate | Total |
|---|---|---|---|---|
| EkBook (before V10) | ₹900 | ₹180 (18% of ₹1,000) | **20%** ❌ | ₹1,080 |
| Correct (GST law) | ₹900 | ₹162 (18% of ₹900) | 18% ✅ | ₹1,062 |
| EkBook (after V10) | ₹900 | ₹162 | 18% ✅ | ₹1,062 |

**The fix:**
1. **New helper `distributeDiscountProportionally()` in `src/lib/money.ts`**: takes an array of per-item gross amounts + the order-level discount, returns an array of per-item discount amounts. Each item's share is `(gross[i] / totalGross) × orderDiscount`, rounded to 2dp. The last non-zero-gross item absorbs any rounding residual so `Σ(shares) === orderDiscount` exactly. Each share is clamped to `[0, gross[i]]` to prevent negative taxable values.
2. **`transactions/route.ts` POST** ([lines 187-274](../src/app/api/transactions/route.ts)): Now distributes the order-level discount proportionally across items BEFORE computing GST. Per-item GST is computed on the post-discount taxable value. Per-item CGST/SGST/IGST are stored on `TransactionItem` (single source of truth — see §2.2 below). Profit is computed on the post-discount realized unit price (see §2.4 below).
3. **`transactions/[id]/route.ts` PUT**: Same fix applied (same code path).
4. **`TransactionEntry.tsx`** ([lines 342-383](../src/components/ledger/TransactionEntry.tsx)): The client-side preview now uses the SAME calculation as the server (was: a simpler calculation that didn't distribute the discount). The shopkeeper sees exactly what the server will store.

**Golden test — `src/__tests__/lib/gst-discount.test.ts`:**
- Asserts the auditor's exact worked example (₹1000 + ₹100 + 18% → GST ₹162 not ₹180, total ₹1062 not ₹1080) for both intra-state (CGST+SGST) and inter-state (IGST).
- Asserts the GST-correctness invariant `tax == taxable × rate` per rate slab for single-rate, multi-rate (5% + 18%), and three-rate (5% + 12% + 28% with uneven quantities) invoices.
- Asserts edge cases: zero discount, discount > subtotal (clamped), proportional distribution to gross, rounding residual absorption.
- Asserts the §2.2 single-source-of-truth invariant: `Σ(per-item CGST) == header CGST` (same for SGST/IGST), and inter-state puts all GST in IGST.

**All 11 tests pass.**

**One-time recompute for existing discounted invoices:**
- Created `scripts/v10-recompute-discounted-invoices.ts`.
- Run with `DRY_RUN=true` first to see the list of affected invoices and the before/after values.
- Then run without `DRY_RUN` to recompute per-item CGST/SGST/IGST and header totals using the V10 formula.
- **If any wrong invoices were already filed via GSTR-1**: the script logs every invoice it touches (with old/new GST) so you have a paper trail for a CA-guided GSTR-1 amendment. The script prints a warning about this.

**Files changed (§2.1):**
- `src/lib/money.ts` — new `distributeDiscountProportionally()` helper
- `src/app/api/transactions/route.ts` — POST handler
- `src/app/api/transactions/[id]/route.ts` — PUT handler
- `src/components/ledger/TransactionEntry.tsx` — client preview
- `src/__tests__/lib/gst-discount.test.ts` — NEW golden test (11 tests)
- `scripts/v10-recompute-discounted-invoices.ts` — NEW one-time recompute script

---

### 1.2 §2.2 — GST computed two different ways → drift [P1] ✅ FIXED

**The bug (auditor's finding, verified):**
- At **write time** (`transactions/route.ts`): per-item `itemGst` is rounded, then `splitGst()` splits it as `cgst = round(gst/2)`, `sgst = gst − cgst`. For an **odd number of paise**, `cgst ≠ sgst` (the extra paisa goes to CGST). These stored values feed the dashboard and the report *summary/header* totals.
- At **read time** (`reports/route.ts:186` and `gstr-export/route.ts:102`): the slab breakdown and per-invoice GST were **recomputed in SQL** as `ROUND(taxable × rate / 200)` for CGST and the identical expression for SGST — so **CGST == SGST always** in these paths.
- For any invoice whose GST is an odd number of paise, the **stored** split (e.g. CGST 4.51 / SGST 4.50) disagreed with the **recomputed** split (CGST 4.51 / SGST 4.51). A CA reconciling slab totals against the return summary would see the mismatch.

**The fix:**
1. **Schema migration** (`prisma/migrations/20260706000002_transaction_item_per_item_gst/migration.sql`): Added `cgst`, `sgst`, `igst` columns to `TransactionItem` (NOT NULL DEFAULT 0). Backfilled from existing data using the server's write-time formula (so existing rows have the same values the server would have stored, given the same buggy inputs).
2. **Write path**: `transactions/route.ts` POST + `transactions/[id]/route.ts` PUT now store per-item CGST/SGST/IGST at write time (alongside the header totals, which are the sum of per-item values).
3. **Read paths** (single source of truth):
   - `reports/route.ts` GST section: SQL now aggregates `SUM(COALESCE(ti."cgst", 0))` instead of recomputing `ROUND(taxable × rate / 200)`. Same for SGST/IGST.
   - `gstr-export/route.ts`: per-invoice-per-rate SQL now aggregates stored per-item values. The `reconciliation` block now also checks **tax** (was: taxable only — missed the drift). Since both summary and per-invoice now aggregate the SAME stored columns, they must be byte-identical (rounding tolerance only for float-sum drift).

**Files changed (§2.2):**
- `prisma/schema.prisma` — added `cgst`, `sgst`, `igst` to `TransactionItem`
- `prisma/migrations/20260706000002_transaction_item_per_item_gst/migration.sql` — NEW migration with backfill
- `src/app/api/reports/route.ts` — slab SQL aggregates stored values
- `src/app/api/gstr-export/route.ts` — per-invoice SQL aggregates stored values; reconciliation checks tax too

---

### 1.3 §2.3 — Three different rounding functions [P1] ✅ FIXED

**The bug (auditor's finding, verified):**
- `money.ts roundMoney()` → `parseFloat((abs + 1e-9).toFixed(2))` (server, stored values).
- `TransactionEntry.tsx:354` → `const r = (n) => Math.round(n*100)/100` (client, the total the user *sees* at entry). **Did not have the epsilon correction** — on boundary values (e.g. 1.005) it rounded differently from the server.
- SQL `ROUND(x::numeric, 2)` in reports/GSTR (Postgres round-half-away, a third behavior).

**The fix:**
- `TransactionEntry.tsx` now imports `roundMoney`, `calculateGst`, `splitGst`, `distributeDiscountProportionally` from `src/lib/money.ts` and uses them for all client-side calculations. The local `r = (n) => Math.round(n*100)/100` is gone.
- The client preview now uses the **exact same functions** as the server — no drift between what the shopkeeper sees at entry and what the server stores.
- The SQL `ROUND(x::numeric, 2)` in reports/GSTR remains (it's the only way to round in SQL), but it's now used only for the `taxable` column (a sum of gross − discount, which is deterministic). The `cgst`/`sgst`/`igst` columns are aggregated from stored values (no SQL rounding involved).

**Note on the integer-paise migration (still deferred):** The auditor recommended promoting this from "deferred someday" to "next milestone." Agreed — it's the root cause behind §2.2 and §2.3. The V10 fix is a structural mitigation (single source of truth + shared rounding function), but the underlying float storage remains. Scheduling the paise migration as the V11 milestone, gated by the golden test suite (now in place).

**Files changed (§2.3):**
- `src/components/ledger/TransactionEntry.tsx` — uses shared `roundMoney` etc.

---

### 1.4 §2.4 — Order-level discount distorts profit [P2] ✅ FIXED

**The bug (auditor's finding, verified):**
- Because the order-level discount was applied only to `totalAmount` (not to items), `grossProfit` was computed from **undiscounted** unit prices (`transactions/route.ts:222`) — so **profit was overstated** by the discount amount on every discounted sale.
- The dashboard "Today's Profit" and the P&L report would be too high whenever discounts were given.

**The fix:**
- Both the server (`transactions/route.ts` POST + `transactions/[id]/route.ts` PUT) and client (`TransactionEntry.tsx`) now compute profit on the **post-discount realized unit price**:
  ```
  realizedUnitPrice = roundMoney(taxableAmount / quantity)
  grossProfit += (realizedUnitPrice - product.purchasePrice) * quantity
  ```
- This is the actual profit the shopkeeper made, not the list-price profit.

**Files changed (§2.4):** Same as §2.1 (the profit calculation was updated alongside the GST calculation).

---

### 1.5 §3.4 — Mandatory 2FA lockout trap [P1] ⏭️ FOUNDER TASK (admin repo)

**The bug (auditor's finding, verified):**
- The admin app's `auth.ts:81` rejects login if `!totpEnabled`. But `/api/admin/setup` creates the first admin **without** a TOTP secret, and enabling 2FA normally requires being logged in.
- **Result: a freshly-created admin can never log in.** "Contact the founder to reset your account" — but the founder *is* that admin.
- This is in the **separate `bahikhata-admin` repo**, which is out of scope for this PR.

**Recommended fix (hand to the admin-repo agent):**
- Provide a first-login 2FA **enrollment** step — either the setup endpoint provisions a TOTP secret and returns the QR/otpauth URI, or the login flow allows a one-time "enroll 2FA" path when `totpEnabled` is false (verify a code, then set `totpEnabled=true`).
- **Test the full new-admin flow end to end before deploying**, or you'll be locked out.

---

## 2. Tier 1 — Safety / Robustness

### 2.1 §3.3 — Error-detail leakage (8 routes) ✅ FIXED

**The bug (auditor's finding, verified):**
- V9 2.5 fixed the dashboard route to use generic messages + errorId, but 8 other routes still echoed `String(error)` or `error.message` to the client.

**Grep verification (before fix):**
```
$ rg "String\(error\)|error\.message" src/app/api/
src/app/api/payment/create-order/route.ts:92:  detail: error?.error?.description || error?.message || String(error),
src/app/api/payment/verify/route.ts:191:  detail: error?.message || String(error),
src/app/api/staff/route.ts:35:  detail: String(error)
src/app/api/staff/route.ts:113:  detail: String(error instanceof Error ? error.message : error)
src/app/api/scan-bill/route.ts:282:  detail: fallbackResult.error,
src/app/api/scan-bill/route.ts:413:  detail: String(error),
src/app/api/scan-bill/compare/route.ts:217:  detail: String(error),
src/app/api/voice-parse/route.ts:446:  detail: errorDetail,
```

**The fix:**
- Created `src/lib/api-error.ts` with a shared `apiError(error, message, status, context?)` helper:
  - Generates a short 8-char `errorId` (random bytes, hex).
  - Logs the full error + errorId + optional context server-side (`console.error`).
  - Returns `{ error: message, errorId }` to the client — never the raw error string.
- Replaced all 8 leakage sites:
  - `payment/create-order/route.ts` — was leaking Razorpay SDK internals (key id, internal error structure)
  - `payment/verify/route.ts` — was leaking Razorpay signature/verification internals
  - `staff/route.ts` (GET + POST) — was leaking DB internals
  - `scan-bill/route.ts` (2 sites) — was leaking VLM provider errors (model names, API key fragments in some SDK error subclasses)
  - `scan-bill/compare/route.ts` — was leaking DB / SDK internals
  - `voice-parse/route.ts` — was leaking LLM provider errors (model name, status text, response body snippets)
- The `detail: validation.error` responses in `products/route.ts` and `transactions/route.ts` are **intentional** — they're zod validation feedback to the client (field-level error messages), not error leakage. Left as-is.

**Grep verification (after fix):**
```
$ rg "detail:\s*String\(error\)|detail:\s*error\?\.message|detail:\s*error\.message|detail:\s*errorDetail" src/app/api/
(all matches are now comments explaining what was removed)
```

**Files changed (§3.3):**
- `src/lib/api-error.ts` — NEW shared helper
- `src/app/api/payment/create-order/route.ts`
- `src/app/api/payment/verify/route.ts`
- `src/app/api/staff/route.ts`
- `src/app/api/scan-bill/route.ts`
- `src/app/api/scan-bill/compare/route.ts`
- `src/app/api/voice-parse/route.ts`

---

### 2.2 §3.7 — Shop-state cache stale across instances [P3] ✅ FIXED

**The bug (auditor's finding, verified):**
- `gst.ts:29` cached shop state in an in-memory `Map` (5 min TTL) with `invalidateShopStateCache()` on settings change.
- On serverless, invalidation only clears the **current instance's** map — other warm instances keep the stale state for up to 5 minutes.
- A sale routed to a different instance right after a state change can get the **wrong intra/inter-state split (CGST/SGST vs IGST)**. Low frequency (state changes are rare) but it's a correctness edge for GST.

**The fix:**
- Dropped the cache entirely. The query is a primary-key lookup on `Setting` (userId), which is O(1) and ~1-2ms on Neon's free tier — there's nothing to gain from caching.
- `invalidateShopStateCache()` is kept as a no-op export so existing callers (Settings page) don't break — but it no longer needs to be called because there's nothing to invalidate.
- Comment in `gst.ts` explains why the cache was removed and why the query is cheap.

**Files changed (§3.7):** `src/lib/gst.ts`

---

### 2.3 §1.1 — Warmup GitHub Action ✅ VERIFIED

**The auditor's concern:** "I cannot see a `neon-warmup.yml` GitHub Action in the repo — verify it exists in `.github/workflows/`."

**Verification:**
```
$ cat .github/workflows/neon-warmup.yml
name: Neon Warmup Ping
on:
  schedule:
    - cron: '*/5 * * * *'   # Every 5 minutes (GitHub Actions minimum interval)
jobs:
  warmup:
    runs-on: ubuntu-latest
    steps:
      - name: Ping warmup endpoint
        run: |
          curl -s -o /dev/null -w "%{http_code}" https://bahikhata-pro.vercel.app/api/warmup || true
```

The Action exists, runs every 5 minutes, and pings the warmup endpoint. The `vercel.json` daily cron is the secondary fallback.

**Note:** The auditor's other recommendation — "just disable Neon scale-to-zero (still the real fix)" — is still a founder task in the Neon console (Settings → Compute → Suspend = OFF). The warmup Action is a workaround for the free tier; the real fix is paying for always-on compute.

---

### 2.4 §3.6 — Admin JWT no tokenVersion/revocation ⏭️ FOUNDER TASK (admin repo)

**The bug (auditor's finding, verified):**
- The main app got Redis-backed 5-second revocation (V9 2.8). The **admin** app's JWT (`admin auth.ts:136`) has no `tokenVersion` and no revocation path — a stolen admin session is valid for the full 1-hour `maxAge` with no way to kill it.
- Admin is your highest-value target.

This is in the **separate `bahikhata-admin` repo**, which is out of scope for this PR. Recommended fix for the admin-repo agent: add the same `tokenVersion` + Redis revocation as the main app, plus a "log out all admin sessions" control.

---

## 3. Tier 2 — Hardening (noted, not done this round)

### 3.1 §3.2 — CSP `unsafe-inline` ⏭️ Deferred (acknowledged)

- Removing `unsafe-eval` (V9) was the bigger win and it's done.
- `'unsafe-inline'` on scripts remains the residual XSS surface. The auditor's recommendation: treat full nonce-based CSP as a real (not "someday") hardening task once the P0s are done. Load PostHog/Sentry/Vercel via Next.js `<Script>` with a nonce.
- **`chart.tsx` `dangerouslySetInnerHTML` verified safe**: builds CSS only from developer-defined `THEMES` + `ChartConfig`. Grepped for `ChartConfig` usages — only `chart.tsx` itself instantiates it (no app code passes user input into it). No user-controlled string can reach the `<style>` tag.

### 3.2 Integer-paise migration ⏭️ Deferred (V11 milestone)

- 42 money fields remain `Float`. `roundMoney` mitigates drift but cannot eliminate it.
- The V10 fix (single source of truth + shared rounding) is a structural mitigation, but the underlying float storage remains.
- **Scheduling as V11 milestone**, gated by the golden test suite (now in place — `gst-discount.test.ts` + `money.test.ts`).

### 3.3 §3.5 — Invoice numbering gap with manual + auto ⏭️ Low priority

- The atomic `InvoiceCounter` (V9 2.7) is correct for auto-generated numbers. If a user manually enters an invoice number that collides with the auto-counter, the unique constraint fires `P2002`, the retry increments the counter, and you get a gap.
- Minor. For GST gap-free series: either forbid manual invoice numbers on GST invoices, or keep manual numbers in a separate series. Noted for future.

### 3.4 §3.8 — Negative stock display ⏭️ Low priority

- Negative `currentStock` flows into `totalStockValue` and stock reports as negative value, which can make inventory valuation look wrong to an accountant.
- Consider clamping *displayed* stock value at 0 while keeping the true (negative) count for the reorder workflow. Noted for future.

---

## 4. What's genuinely good (auditor's words, still true)

- Tenant isolation is consistent: every mutation scopes by `userId` (products, parties, transactions incl. the V9 stock `updateMany`).
- Auth posture is strong: no hardcoded secrets, JWT revocation (Redis-backed, 5s lag), Redis rate limiting, mandatory admin 2FA (modulo the lockout trap — admin repo), CSRF via Origin/Referer with exact host matching, HSTS/nosniff/frame-deny headers, admin SQL console read-only + whitelisted.
- Reports and GSTR moved to SQL aggregation with no row caps (V6) → they won't silently under-report at scale.
- Soft deletes + stock reversal + idempotency keys + audit log = the ledger-integrity fundamentals are present.
- The GSTR-1 export correctly rejects multi-month ranges (V7 M5), classifies B2B/B2CL/B2CS with the current ₹1L threshold (V7 M2/V8 M3), and includes a truncation hard-stop (V6 SC1/PP1).
- The V10 fix adds: **per-item GST as single source of truth**, **proportional discount distribution**, **shared rounding function**, **golden test for the GST-correctness invariant**.

---

## 5. Verification

| Check | Result |
|---|---|
| `npx prisma generate` | ✅ Prisma client regenerated with new `cgst`/`sgst`/`igst` fields |
| `npx tsc --noEmit` | ✅ Only 5 pre-existing errors in `validation.test.ts` (unrelated discriminated-union typing on test code). **0 new errors** from V10 changes. |
| `npm run build` | ✅ Compiled successfully in 37.3s. All 39 API routes + 111 admin pages compile. (Prisma migration warning is the expected baseline-resolve behavior — handled by `migrate-with-retry.sh` at deploy time.) |
| `npx jest src/__tests__/lib/gst-discount.test.ts` | ✅ 11/11 pass (golden test) |
| `npx jest src/__tests__/lib/money.test.ts src/__tests__/lib/raw-sql-smoke.test.ts` | ✅ 40/40 pass (no regressions) |

---

## 6. Files changed (V10)

**New files (5):**
- `prisma/migrations/20260706000002_transaction_item_per_item_gst/migration.sql` — schema migration + backfill
- `src/lib/api-error.ts` — shared error-response helper
- `src/__tests__/lib/gst-discount.test.ts` — golden test (11 tests)
- `scripts/v10-recompute-discounted-invoices.ts` — one-time recompute script
- `docs/Auditor-Response-V10.md` — this file

**Modified files (10):**
- `prisma/schema.prisma` — added `cgst`/`sgst`/`igst` to `TransactionItem`
- `src/lib/money.ts` — new `distributeDiscountProportionally()` helper + clamping
- `src/lib/gst.ts` — dropped in-memory shop-state cache
- `src/app/api/transactions/route.ts` — POST: proportional discount + per-item GST
- `src/app/api/transactions/[id]/route.ts` — PUT: same
- `src/app/api/reports/route.ts` — slab SQL aggregates stored per-item values
- `src/app/api/gstr-export/route.ts` — per-invoice SQL aggregates stored values; reconciliation checks tax
- `src/components/ledger/TransactionEntry.tsx` — client preview uses shared helpers
- `src/app/api/payment/create-order/route.ts` — apiError
- `src/app/api/payment/verify/route.ts` — apiError
- `src/app/api/staff/route.ts` — apiError (GET + POST)
- `src/app/api/scan-bill/route.ts` — apiError (2 sites)
- `src/app/api/scan-bill/compare/route.ts` — apiError
- `src/app/api/voice-parse/route.ts` — apiError

**No new dependencies added.**

---

## 7. Founder tasks remaining

1. **Run the recompute script** — `DRY_RUN=true npx tsx scripts/v10-recompute-discounted-invoices.ts` first, then without `DRY_RUN`. If any wrong invoices were filed via GSTR-1, consult a CA about amendments.
2. **Apply the migration** — `npx prisma migrate deploy` (or the deploy script will run it). The backfill is safe (idempotent — recomputes the same values from the same inputs).
3. **§3.4 + §3.6 in the admin repo** — fix the 2FA lockout trap and add admin JWT revocation. These are in the separate `bahikhata-admin` repo.
4. **Verify V10 fixes in production** — create a discounted sale, check the invoice shows `tax == taxable × rate`, run the GSTR-1 export, verify the reconciliation block reports `matches: true`.
5. **Schedule the integer-paise migration as V11** — the root cause behind §2.2 and §2.3. Gated by the golden test suite (now in place).
6. **(Still pending from V5)** Configure Resend env vars for password reset emails.

---

## 8. Honest acknowledgment

The V10 auditor's most critical finding — GST on pre-discount amount — is a bug I should have caught earlier. The V8 comment in the code claimed *"GST is now computed on the POST-DISCOUNT taxable value… All screens now agree"* — I trusted that comment without tracing the actual data flow (UI sends `discountAmount: 0` per item → server's "post-discount" calculation is a no-op → order-level discount bypasses GST entirely). The V8 H1 fix was real for *item-level* discounts, but the UI never populated that field, so the fix was dead code.

The lesson: **comments are not verification**. Every claim about data flow should be backed by tracing the actual values through the code, not by reading the comment above the line. The golden test (`gst-discount.test.ts`) now enforces the GST-correctness invariant `tax == taxable × rate` per slab — if any future change breaks this, the test fails before the build ships.

For §2.2 (single source of truth): the root cause was having two code paths (write-time `splitGst` vs read-time SQL `ROUND(taxable × rate / 200)`) with different rounding behaviors. The fix is structural — one stored value, aggregated everywhere. This pattern (store the truth, aggregate it, never recompute) is what the integer-paise migration will extend to all money fields in V11.
