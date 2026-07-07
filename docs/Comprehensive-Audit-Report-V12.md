# Comprehensive Codebase Audit Report — Post V11 + V12 + Stock Policy

**Date:** 2026-07-07
**Scope:** Full codebase audit covering GST correctness, security, performance, UI/UX, and timezone handling
**Method:** 5 parallel deep-dive audits tracing actual data flow (UI → API → DB → reports), not just comments

---

## 0. Executive Summary

The V10/V11/V12 fixes are **substantially intact**. The GST-on-discount fix, per-item GST storage, shared rounding, IST timezone helpers, Party indexes, stock policy, and back-button fix are all working correctly.

However, the audit found **43 issues** across 5 domains:
- **6 CRITICAL** (must fix before launch — data loss, compliance bugs)
- **12 HIGH** (fix soon — security, correctness)
- **16 MEDIUM** (fix when possible — performance, UX)
- **9 LOW** (polish, defense-in-depth)

The most urgent are:
1. **GSTR-1 export uses UTC dates for invoice dates and `fp` field** — a GST compliance bug that could cause wrong-month filing
2. **Offline sync silently drops 4xx failures** — data loss (offline sales vanish without warning)
3. **Bulk delete in Ledger is completely broken** — uses a deprecated API path that returns 410
4. **`paidAmount` drifts by `roundOff`** — phantom "due" amount on every rounded sale
5. **Stock-check race condition** — block policy can be bypassed under concurrent sales

---

## 1. CRITICAL Issues (6) — Fix Before Launch

### C1. GSTR-1 export: invoice dates in UTC, not IST (GST compliance bug)
**File:** `src/app/api/gstr-export/route.ts:211, 228, 363`
**Severity:** CRITICAL — wrong invoice date on GST return

The export uses `t.date.toISOString().slice(0, 10)` which always returns UTC. A sale at IST 2:00 AM on July 1 (= UTC June 30, 20:30) is exported with invoice date "2026-06-30". The GST portal expects the local invoice date.

**Fix:** Add an `istDateString(d: Date)` helper to `lib/timezone.ts` and use it for `idt`, `in_date`, and the CSV date column.

### C2. GSTR-1 export: `fp` (filing period) uses UTC month
**File:** `src/app/api/gstr-export/route.ts:269`
**Severity:** CRITICAL — wrong filing period on GST return

`fp: ${String(to.getUTCMonth() + 1)...}` uses UTC month. For an export at IST 2:00 AM on July 1, `to` is still June 30 UTC → `fp = "062026"` instead of `"072026"`. The `getISTDateParts` helper is already imported but not used here.

**Fix:** Use `toParts.month` and `toParts.year` (already computed on line 75).

### C3. Offline sync silently drops 4xx failures (DATA LOSS)
**File:** `src/lib/offline-fetch.ts:456-460`
**Severity:** CRITICAL — offline sales vanish without warning

When a queued mutation replay gets a 4xx response (validation error, deleted product reference, plan limit hit), the sync engine deletes the queue item and counts it as "synced." The user saw "Saved offline" but the sale never reaches the database.

**Fix:** On 4xx, do NOT delete the queue item. Surface a user-visible "Sync failed" notification with the response body. Quarantine the item for manual review.

### C4. Bulk delete in Ledger is completely broken
**File:** `src/components/ledger/Ledger.tsx:207`
**Severity:** CRITICAL — bulk delete silently fails

`handleBulkDelete` calls `/api/transactions?id=${id}` with DELETE. But that endpoint returns **410 Gone** (the deprecated hard-delete was removed). The user sees "X transactions deleted" but nothing actually gets deleted. Single delete works (uses `/api/transactions/${id}`).

**Fix:** One-line change — replace `/api/transactions?id=${id}` with `/api/transactions/${id}`.

### C5. `paidAmount` drifts by `roundOff` when round-off is enabled
**File:** `src/app/api/transactions/route.ts:272-282`; `src/components/ledger/TransactionEntry.tsx:385, 464`
**Severity:** CRITICAL — phantom "due" on every rounded sale

The client sends `paidAmount` using the pre-round-off total. The server applies round-off, making `totalAmount` ≠ `paidAmount`. For a ₹1,062.50 sale rounded to ₹1,063, `paidAmount` is stored as ₹1,062.50, leaving a phantom ₹0.50 due.

**Fix:** In `TransactionEntry.tsx`, send `paidAmount: paidAmount === '' ? undefined : paid` (let the server use the post-round total).

### C6. Account-delete loads ALL transactions for a no-op Cloudinary cleanup
**File:** `src/app/api/account/delete/route.ts:42-46`
**Severity:** CRITICAL — OOM risk on account deletion

Loads all transactions + items to "find bill images publicIds for Cloudinary cleanup," but the Cloudinary cleanup is a TODO no-op. For a shop with 100K transactions × 5 items = 500K rows → serverless function OOM.

**Fix:** Delete the unused `transactions` findMany. If Cloudinary cleanup is needed later, track publicIds in a column.

---

## 2. HIGH Issues (12) — Fix Soon

### H1. Stock-check race condition (block policy bypass)
**File:** `src/app/api/transactions/route.ts:180-204`
**Severity:** HIGH — block policy can be bypassed under concurrency

The stock check reads `productMap` OUTSIDE the `$transaction`. Two concurrent sales can both read `currentStock = 5`, both pass the check (each selling 3 → resultingStock = 2), both decrement → final stock = -1.

**Fix:** Move the check inside the `$transaction` using conditional `updateMany({ where: { id, userId, currentStock: { gte: qty } } })` and verify `count > 0`.

### H2. Admin auth based on email allowlist (not DB role)
**File:** `src/lib/admin-auth.ts:12-37`
**Severity:** HIGH — security

Admin access is gated by a hardcoded email list. If the founder ever deletes their account, the email becomes free. An attacker can re-register with that email and gain admin access.

**Fix:** Add `isAdmin Boolean @default(false)` to User schema. Replace the email list with a DB check.

### H3. `parties/[id]` 6-month chart uses server-local month
**File:** `src/app/api/parties/[id]/route.ts:136`
**Severity:** HIGH — wrong chart window

`new Date(now.getFullYear(), now.getMonth() - 5, 1)` uses server-local time (UTC on Vercel). The `istMonthStartOffset` helper is imported but not used.

**Fix:** Replace with `istMonthStartOffset(now, -5)`.

### H4. `ai-usage/route.ts` uses UTC midnight for "today"/"this month"
**File:** `src/app/api/ai-usage/route.ts:35, 37`
**Severity:** HIGH — wrong AI usage boundaries

Uses `Date.UTC(...)` which is UTC midnight = 5:30 AM IST. AI scans between 12 AM and 5:30 AM IST are counted in the previous day's bucket.

**Fix:** Import and use `istDayStart(now)` and `istMonthStart(now)` from `@/lib/timezone`.

### H5. `usage-limits.ts` daily AI scan counter uses `setHours(0,0,0,0)`
**File:** `src/lib/usage-limits.ts:252-253`
**Severity:** HIGH — billing/limit correctness

Server-side helper using `setHours(0,0,0,0)` = UTC midnight = 5:30 AM IST. The daily limit "resets" at 5:30 AM instead of midnight IST.

**Fix:** Use `istDayStart(new Date())`.

### H6. Parties PUT silently resets `openingBalance` to 0
**File:** `src/app/api/parties/[id]/route.ts:235`
**Severity:** HIGH — silent data corruption

`openingBalance: parseFloat(body.openingBalance) || 0`. If the client sends an edit without `openingBalance` (e.g., just renaming), `parseFloat(undefined)` is NaN, `NaN || 0` = 0. The opening balance is silently overwritten.

**Fix:** Guard with `if (body.openingBalance !== undefined)`.

### H7. TransactionDetail infinite skeleton on API error
**File:** `src/components/ledger/TransactionDetail.tsx:45-52`
**Severity:** HIGH — permanent loading state

No `error` handling in `useQuery`. If the fetch errors (404, 500), `isLoading` is false but `txn` is undefined → skeleton spins forever.

**Fix:** Add `error` state, render "Transaction not found" with a Back button.

### H8. Ledger and Inventory show "No data" on API error (misleading)
**Files:** `src/components/ledger/Ledger.tsx:514-525`, `src/components/inventory/Inventory.tsx:255-265`
**Severity:** HIGH — misleading UX

If the API returns 500 (DB cold start), the code falls through to the empty state → user sees "No sales yet" instead of an error with retry.

**Fix:** Add `error ?` branch before the empty-state branch.

### H9. BillScanner preview computes GST on pre-discount amount
**File:** `src/components/scanner/BillScanner.tsx:609-615`
**Severity:** HIGH (display only) — V10 §2.1 regression in preview

The scanner's "Grand Total" preview computes GST on the pre-discount amount (the V10 anti-pattern). The saved value is correct (uses `computeLineItems`), but the preview is wrong.

**Fix:** Replace the inline math with a call to `computeLineItems`.

### H10. Tally export voucher doesn't balance
**File:** `src/lib/tally-export.ts:36-58`
**Severity:** HIGH — CA's Tally books won't match

Missing `discountAmount` and `roundOff` ledger entries. Debit (party) = totalAmount (includes discount + round-off). Credit (sales+tax) = subtotal + tax (excludes discount + round-off). These don't balance.

**Fix:** Add Discount and Round Off ledger entries. Credit Sales with `-(subtotal - discount)`.

### H11. Over-discount validation uses different base than `computeLineItems`
**Files:** `src/app/api/transactions/route.ts:239-254`, `src/app/api/transactions/[id]/route.ts:198-210`
**Severity:** HIGH — discount silently truncated for unlinked sub-units

The validation only normalizes quantity for product-linked items. `computeLineItems` normalizes ALL items (including unlinked). A scanned "500 gm × ₹20" is checked against ₹10,000 but stored as ₹10.

**Fix:** Use `resolveEnteredQuantity` in the validation, matching `computeLineItems`.

### H12. Sequential stock updates inside `$transaction` (N round-trips)
**Files:** `transactions/route.ts:345-360`, `transactions/[id]/route.ts:252-268, 300-315`
**Severity:** HIGH (performance at scale) — N items = N sequential UPDATEs

`for (const item of txItems) { await tx.product.updateMany(...) }` — 50 items = 50 sequential round-trips.

**Fix:** Batch into one raw SQL `UPDATE ... FROM (VALUES)`.

---

## 3. MEDIUM Issues (16) — Fix When Possible

### M1. Rate limit not fail-closed on `scan-bill` (AI budget burn)
**File:** `src/app/api/scan-bill/route.ts:34`
Missing `{ failClosed: true }` on the IP rate limiter. During Redis outage, scans bypass the limit.

### M2. VLM provider errors leaked via `results` field
**File:** `src/app/api/scan-bill/compare/route.ts:256-262, 323`
Inner `callProvider` returns raw error strings in the `results` payload, bypassing the V10 `apiError` fix.

### M3. `query-helpers.ts` spread order allows `userId` override (latent IDOR)
**File:** `src/lib/query-helpers.ts:30-53`
`{ userId, deletedAt: null, ...additional }` — additional can override userId. Swap to `{ ...additional, userId, deletedAt: null }`.

### M4. Transactions list lacks pagination (silent truncation at 200)
**Files:** `Ledger.tsx:124`, `transactions/route.ts:22-23`
Shops with >200 transactions silently lose visibility into older data. No "Load more" button.

### M5. Transactions GET eagerly loads `items + party` for every row
**File:** `transactions/route.ts:40-45`
200 transactions × 5 items = ~1000 item rows per page load. List view only needs `itemsCount` + `party.name`.

### M6. Admin routes use `setHours(0,0,0,0)` (4 routes)
**Files:** `admin/overview/route.ts:24-27`, `admin/users/route.ts:31-33`, `admin/ai-usage/route.ts:56-58`, `admin/features/route.ts:49-51`
All use server-local time (UTC on Vercel). Founder's admin dashboard metrics are shifted 5.5 hours.

### M7. `AddPartyInline` is a non-modal "modal" (no backdrop, no Esc, no focus trap)
**File:** `src/components/ledger/TransactionEntry.tsx:1407-1448`
Should use Radix `Dialog` like `ProductDialog` does.

### M8. `DateRangePicker` mobile popover — no backdrop, taps behind leak through
**File:** `src/components/common/DateRangePicker.tsx:176-243`
The tap that closes the picker can also fire a click on the underlying row.

### M9. Header + Sidebar shop switcher dropdowns never close on outside tap
**Files:** `src/components/layout/Header.tsx:133-155`, `src/components/layout/Sidebar.tsx:171-196`
No outside-click handler.

### M10. SplashScreen shows 2s on every app open (blocks interaction)
**File:** `src/app/page.tsx:75` + `src/components/common/SplashScreen.tsx:23-26`
No skip-on-warm-boot. On native, the Capacitor splash already covers warm-up.

### M11. "Waking up" message only on Dashboard
**Files:** `Ledger.tsx:525-528`, `Inventory.tsx:265-268`
Other pages show generic skeleton on cold DB with no "waking up" reassurance.

### M12. Race condition: stale data flashes on view switch
**File:** `src/components/ledger/TransactionDetail.tsx:74`
No `placeholderData: keepPreviousData` on Ledger/Inventory/Reports queries.

### M13. `confirm()` used for destructive actions (jarring on mobile)
**Files:** `Sidebar.tsx:82`, `Ledger.tsx:204`, `TransactionDetail.tsx:79`, `Settings.tsx:190-191`
Should use Radix `AlertDialog`.

### M14. CSV filename uses UTC year-month
**File:** `src/app/api/gstr-export/route.ts:379`
Same root cause as C2. File named `GSTR1_2026-06.csv` instead of `GSTR1_2026-07.csv`.

### M15. Missing partial index on `Transaction.deletedAt`
**File:** `prisma/schema.prisma:222-224`
Every query filters `deletedAt IS NULL`. A partial index would skip the post-filter.

### M16. Insights route loads 60 days of transactions with items in memory
**File:** `src/app/api/insights/route.ts:53-60`
100 sales/day × 60 days × 5 items = 30K rows in memory. Should push to SQL.

---

## 4. LOW Issues (9) — Polish / Defense-in-Depth

| # | File | Issue |
|---|---|---|
| L1 | `src/middleware.ts:39` | CSP still allows `unsafe-inline` for scripts |
| L2 | `src/app/api/warmup/route.ts:44-50` | DB hostnames exposed publicly without auth |
| L3 | `src/app/api/dashboard/route.ts:85` | `Prisma.raw()` with string interpolation (safe today, footgun) |
| L4 | `src/lib/utils.ts:75-86` | Legacy `calculateGST` bypasses `roundMoney` epsilon fix |
| L5 | `src/lib/seed.ts:90, 145` | Seed data uses float-precision GST (no `calculateGst`) |
| L6 | `src/app/api/gstr-export/route.ts:329` | Reconciliation tolerance is ₹1 (should be ₹0.05) |
| L7 | Mobile tap targets | Several buttons below 44px (TransactionEntry remove, party dropdown rows, sidebar collapsed) |
| L8 | `DateRangePicker.tsx:151` | Custom `from` parses as UTC midnight (5:30 AM IST) |
| L9 | `seed.ts:147-154` | Seed items missing per-item CGST/SGST/IGST |

---

## 5. Remaining Tasks for Later (Deferred / Founder Tasks)

### Founder tasks (cannot be done in code)
1. **Disable Neon "Scale to zero"** — the #1 fix for slow page loads across the entire app. ~$19/mo on Neon Launch plan.
2. **Run the V10 recompute script** — `DRY_RUN=true npx tsx scripts/v10-recompute-discounted-invoices.ts` first, then without `DRY_RUN`. Fix old discounted invoices with wrong GST.
3. **Set up Resend** for password reset emails — add `RESEND_API_KEY`, `RESEND_FROM_EMAIL`, `FOUNDER_ALERT_EMAIL` to Vercel env vars.
4. **Fix admin 2FA lockout trap** (in `bahikhata-admin` repo) — add a first-login 2FA enrollment flow before enabling mandatory 2FA.
5. **Add admin JWT revocation** (in `bahikhata-admin` repo) — admin JWT has no `tokenVersion` / revocation path.

### Code tasks for V12+ (future milestones)
1. **Integer-paise migration** — 42 money fields from `Float` to integer paise. The root cause behind GST drift (§2.2/§2.3). Gated by the golden test suite (now in place). ~126 type errors to fix manually.
2. **Ledger cursor pagination** — 50/page with infinite scroll. Currently loads 200 full transactions.
3. **`/api/bootstrap` endpoint** — collapse the 6+ bootstrap requests (settings, shops, flags, subscription, etc.) into one round-trip.
4. **Real two-user integration tests** — current tenant-isolation tests are string assertions, not behavioral.
5. **Full nonce-based CSP** — remove `unsafe-inline`. Load PostHog/Sentry/Vercel via `<Script>` with nonce.
6. **GSTR-3B** (monthly liability summary), **GSTR-2B** (purchase reconciliation), **e-invoicing** (IRN/QR), **e-way bills**, **HSN-wise summary**, **credit/debit notes**, **RCM**, **composition scheme**.
7. **Financial-year / period lock** — once GSTR is filed, lock that period against edits.
8. **Trial balance / P&L / balance sheet** and **bank reconciliation** for users who outgrow single-entry.
9. **Tally XML / Busy / Excel export** — CAs will ask for it.
10. **UPI payment links** and **auto payment reminders** on top of WhatsApp invoice.

---

## 6. V10/V11/V12 Fixes — Verification Status

| Fix | Status | Notes |
|---|---|---|
| V10 §2.1 GST on post-discount | ✅ Intact | `computeLineItems` correctly computes GST on post-discount taxable |
| V10 §2.2 Per-item GST storage | ✅ Intact | All read paths aggregate stored per-item values |
| V10 §2.3 Shared `roundMoney` | ✅ Intact | Client + server use same function |
| V10 §2.4 Profit on post-discount | ✅ Intact | `realizedUnitPrice` used |
| V10 §3.3 `apiError()` helper | ✅ Intact | All catch blocks use it |
| V10 §3.7 Shop-state cache removed | ✅ Intact | Direct PK lookup |
| V11 §2.1 Today KPI timezone | ✅ Intact | `istDayStart(now)` |
| V11 §2.2 Party indexes | ✅ Intact | `(userId, deletedAt)` + `(userId, name)` |
| V11 §2.3 Reports parallelized | ✅ Intact | All 3 report types use `Promise.all` |
| V11 §2.4 `z.coerce.number()` | ✅ Intact | All schemas use it |
| V11 §4.1 GSTR-1 single-month check | ✅ Intact | IST calendar month check |
| V11 §4.6 Timezone helpers | ⚠️ Partial | Core routes fixed; GSTR export `fp`/dates, admin routes, `usage-limits` still broken |
| V12 Unit normalization | ✅ Intact | `resolveEnteredQuantity` in `computeLineItems` |
| V12 GST-inclusive (MRP) | ✅ Intact | Back-calc formula correct |
| V12 Invoice round-off | ⚠️ Stored correctly, `paidAmount` drifts (C5) |
| V12 Stock policy | ✅ Intact | Block/warn based on `stockPolicy` setting |
| Back button fix | ✅ Intact | `canGoBackInApp()` replaces Capacitor's `canGoBack` |
| Desktop Save button | ✅ Fixed | Was missing entirely (only mobile had it) |
| Live stock check | ✅ Intact | Per-item warning as you type |

---

## 7. Recommended Fix Order

**Immediate (before any real user testing):**
1. C1 + C2 + C14 — GSTR-1 `fp` + invoice dates + CSV filename (all in `gstr-export/route.ts`)
2. C3 — Offline sync 4xx data loss
3. C4 — Bulk delete broken path (one-line fix)
4. C5 — `paidAmount` drift (one-line fix)
5. C6 — Account-delete OOM (remove unused query)

**Short-term (this week):**
6. H1 — Stock-check race condition (move inside `$transaction`)
7. H3 + H4 + H5 — Timezone fixes (`parties/[id]`, `ai-usage`, `usage-limits`)
8. H6 — Parties PUT `openingBalance` guard
9. H7 + H8 — Error states for TransactionDetail, Ledger, Inventory
10. H9 — BillScanner preview math
11. H10 — Tally export voucher balance
12. H11 — Over-discount validation base

**Medium-term (next sprint):**
13. M1-M6 — Security + performance hardening
14. M7-M13 — UI/UX polish (modals, dropdowns, splash, loading states)
15. M14-M16 — Performance (partial indexes, SQL aggregation)

**Long-term (future milestones):**
16. Integer-paise migration
17. Ledger pagination
18. Feature roadmap (GSTR-3B, e-invoicing, etc.)
