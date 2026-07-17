# Bug Registry — BahiKhata Pro

**Purpose**: Track every bug, logic error, or feature defect found during
codebase scans (paise migration and beyond). Each entry must be actionable
and include enough context to reproduce.

**Triage rules**:
- **Critical / security / data-loss**: fix immediately in current sub-phase.
- **High (breaks a feature)**: fix in current sub-phase if small; else add
  here with a clear repro and fix in the next sub-phase.
- **Medium (works but wrong edge case)**: add here, fix in a dedicated
  sub-phase.
- **Low (cosmetic / perf)**: add here, fix later.

**Status legend**: `OPEN` / `IN-PROGRESS` / `FIXED` / `WONTFIX` / `DUPLICATE`

---

## Open bugs

<!-- Add new bugs below this line. Newest first. -->

### V20-014 — Money round-trip integration test (auditor §5.2) — COMPLETED

- **Found**: 2026-07-12, during V20 post-audit (auditor's §5.2 recommendation)
- **File**: `src/__tests__/lib/v20-money-roundtrip-integration.test.ts` (new, 819 tests)
- **Severity**: N/A (test infrastructure, not a bug)
- **Description**: The auditor recommended "a single integration test that, for every model in MONEY_COLUMNS, runs create/update/upsert/findFirst/aggregate/groupBy with a known fractional value and asserts round-trip equality." This test now exists. It exports the extension's conversion functions (`convertDataOnWrite`, `convertRowOnRead`, `convertNestedData`) via a `__testing` export and exercises them with 10 test values across all 15 models × all money columns.
- **Coverage**: 819 tests covering — (1) write→DB→read round-trip for every model/column, (2) aggregate _sum/_avg/_min/_max conversion, (3) nested creates (V19-001 regression), (4) nested reads with all V20-008 relations, (5) GstReturn/Gstr1Snapshot upsert (V20-001 regression), (6) MODEL_RELATIONS completeness guard, (7) coverage completeness.
- **Status**: COMPLETED (2026-07-12)

### BUG-013 — Hand-written aggregate handlers only converted `_sum` (Medium/Latent) — FIXED

- **Found**: 2026-07-12, during V20 post-audit deep scan
- **File**: `src/lib/prisma-money-extension.ts` (Transaction handler line 312, Payment handler line 426)
- **Severity**: Medium (latent — no code path uses `_avg/_min/_max` on money columns today, but inconsistent with V20-005)
- **Description**: The V20-005 fix added `_avg/_min/_max` conversion to `generateModelHandlers`, but the hand-written Transaction and Payment aggregate/groupBy handlers still only converted `_sum`. If anyone writes `db.transaction.aggregate({ _avg: { totalAmount: true } })`, it would return paise (100× too large).
- **Fix applied**: 2026-07-12 (V20-008 batch). Updated both hand-written handlers to iterate `['_sum', '_avg', '_min', '_max']` — matches the generateModelHandlers pattern.
- **Regression guard**: Added in `src/__tests__/lib/v20-money-extension-regression.test.ts` → "V20-010: hand-written aggregate handlers convert _avg/_min/_max".
- **Status**: FIXED

### BUG-012 — AuthScreen language toggle didn't translate anything (Medium/UX) — FIXED

- **Found**: 2026-07-12, during V20 post-audit deep scan
- **File**: `src/components/auth/AuthScreen.tsx`
- **Severity**: Medium (misleading feature — user selects Hindi, nothing changes)
- **Description**: The V20-5C batch added a language toggle to the login screen with 5 languages (EN, हिं, ગુ, मरा, தமி). However, the AuthScreen used hardcoded English strings ("Sign In", "Create Account", "Email", "Password", "Your Name", "India's Smartest Ledger App", data-secure notice) — the toggle only set the store value without any visible effect. The i18n system already had `auth.*` translation keys for all 5 languages, but the AuthScreen never called `useTranslation()`.
- **Fix applied**: 2026-07-12 (V20-008 batch). Wired AuthScreen to `useTranslation()`. All visible strings now use `t('auth.*')` keys. Selecting Hindi now actually translates the login screen to Hindi.
- **Status**: FIXED

### BUG-011 — MODEL_RELATIONS missing 5 money-bearing relations (Critical/100× bug) — FIXED

- **Found**: 2026-07-12, during V20 post-audit deep scan (the V20 auditor's §1.3 "audit every include" recommendation was not fully executed in Batch 1)
- **File**: `src/lib/prisma-money-extension.ts` (MODEL_RELATIONS map, line 79)
- **Severity**: Critical (100× money display bug — same class as V20-002)
- **Description**: The V20-002 fix added `BankStatement → transactions` to MODEL_RELATIONS, but did NOT complete the full audit the auditor recommended. Five money-bearing relations were missing:
  1. `BankTransaction → matchedPayment` (Payment.amount) — bank recon UI showed matched payments 100× inflated
  2. `BankTransaction → matchedTransaction` (Transaction.totalAmount, etc.) — bank recon UI showed matched transactions 100× inflated
  3. `Transaction → originalTransaction` (self-relation, Transaction.totalAmount) — credit/debit note detail showed original sale 100× inflated
  4. `Transaction → reversalTransactions` (self-relation, Transaction.totalAmount) — sale detail showed "Total adjusted" 100× inflated
  5. `Transaction → matchedBankTransactions` (BankTransaction.amount) — back-reference, latent
- **Reachable today**: Yes. `src/app/api/transactions/[id]/route.ts:33-58` includes `reversalTransactions` and `originalTransaction` (both with `totalAmount`). `src/app/api/bank-recon/reconcile/route.ts:30-42` includes `matchedPayment` and `matchedTransaction`. Both paths returned paise values to the UI without conversion.
- **Fix applied**: 2026-07-12 (V20-008 batch). Added all 5 missing entries to MODEL_RELATIONS.
- **Regression guard**: Added in `src/__tests__/lib/v20-money-extension-regression.test.ts` → "V20-008: MODEL_RELATIONS completeness" (7 tests verifying each relation is present in the source).
- **Status**: FIXED

### BUG-010 — `item.discountAmount` input field is accepted but silently ignored (Low/APIDesign)

- **Status**: FIXED (2026-07-11, auditor commit 8d61e2f — removed from transactionItemSchema)

### BUG-009 — GSTR-1 reconciliation mismatch on demo data (Low/DataIssue)

- **Found**: 2026-07-11, user reported "Cannot export GSTR-1 — data inconsistency detected" error
- **File**: Data issue (not a code bug) — affects `src/app/api/gstr-export/route.ts` reconciliation check
- **Severity**: Low (app is in testing phase, no real customers, only demo data affected)
- **Description**: The GSTR-1 export reconciliation check correctly catches that some transactions have header columns (subtotal, discountAmount) that don't match their line items (qty×price, per-item discount). Per-invoice taxable (₹52,524) ≠ summary taxable (₹52,150) — ₹374 drift.
- **Root cause**: Pre-existing data integrity issue in demo data — NOT caused by paise migration. Some transactions were saved with header values inconsistent with their line items (likely from before the V12 computeLineItems centralization).
- **NOT a code bug**: The reconciliation check is working as designed — it caught a real data drift before an incorrect GSTR-1 would be filed. The code is correct.
- **Fix available**: `/api/admin/repair-headers?fix=true` endpoint (deployed in commit e533c35) recomputes header columns from line items. User can run this to repair demo data.
- **User decision**: Leave for now (app is in testing phase, no real data). Will re-seed demo data or run the repair endpoint when needed.
- **Status**: OPEN (data issue, not a code bug) — defer until real data exists or user requests repair

### BUG-008 — csv-export.test.ts crashes Jest with unhandled rejection loop (Medium/TestInfra)

- **Status**: FIXED (2026-07-11, auditor commit 8d61e2f — fixed async/await + jsdom anchor)

### BUG-007 — (MOVED to Fixed bugs section below)

- **Status**: FIXED (2026-07-11, as part of V17 Phase 2C)

### BUG-006 — (MOVED to Fixed bugs section below)

- **Status**: FIXED (2026-07-11, as part of V17 Phase 2C)

### BUG-005 — (RESERVED — was the validation.test.ts tsc errors, now FIXED, see Fixed bugs section)

- **Status**: FIXED (2026-07-11)

### BUG-004 — (MOVED to Fixed bugs section below)

- **Status**: FIXED (2026-07-11, as part of V17 Phase 2E)

### BUG-003 — MOVED to Fixed bugs section below

- **Status**: FIXED (2026-07-11, as part of V17 Paise Migration Phase 2B)

### BUG-002 — `computePartyBalance` runs 2 sequential `Promise.all` batches (Low/Perf)

- **Status**: FIXED (2026-07-11, auditor commit 8d61e2f — merged into single Promise.all)

### BUG-001 — (Reserved for first entry)

- **Status**: WONTFIX (placeholder)

---

## Fixed bugs

<!-- Move bugs here once fixed. Include fix date and commit/PR reference. -->

### BUG-004 — `openingBalance` on party UPDATE not rounded — FIXED

- **Found**: 2026-07-11, during Phase 2B pre-change scan
- **File**: `src/app/api/parties/[id]/route.ts:343`
- **Severity**: Medium
- **Description**: The party UPDATE handler used `parseFloat(body.openingBalance) || 0` without `roundMoney()`. The CREATE handler (`src/app/api/parties/route.ts:115`) correctly used `roundMoney(openingBalance || 0)`. This inconsistency meant editing a party with `1.005` as opening balance would store the float-drifted value `1.00499999...`, causing 1-paisa discrepancies between dashboard and party-detail balances.
- **Fix applied**: 2026-07-11, as part of V17 Phase 2E. Changed to `parseMoney(body.openingBalance)` which applies `roundMoney` internally — matches the CREATE path's behavior. `parseMoney` was chosen over `roundMoney(parseFloat(...))` because it also handles string cleaning (removes ₹ symbol, commas, spaces) for robustness.
- **Regression guard**: Added in `src/__tests__/lib/raw-sql-smoke.test.ts` under "V17 Phase 2E" → "BUG-004 fix: openingBalance uses parseMoney".
- **Status**: FIXED

### BUG-007 — Reconciliation test mock misroutes getReceivablePayable SQL — FIXED

- **Found**: 2026-07-11, during Phase 2C post-change scan of `reconciliation.test.ts`
- **File**: `src/__tests__/lib/reconciliation.test.ts:42-53` (mock routing logic)
- **Severity**: Medium (test always passed trivially — fixture data never used)
- **Description**: The mock `$queryRaw` implementation used `includes('Payment')` to identify the orphaned-payments query. However, `getReceivablePayable`'s SQL ALSO contains `"Payment"` in its subquery. This caused `getReceivablePayable` to be misrouted to the orphaned-payments branch, receiving `[{ count: 0 }]` instead of the fixture party-balance rows. The test then passed trivially (0 === 0) without ever testing the actual fixture data.
- **Fix applied**: 2026-07-11. Changed mock routing to use patterns UNIQUE to each query:
  - Orphaned-items: `includes('TransactionItem')` (unique — no other query refs TransactionItem)
  - Orphaned-payments: `includes('pty.id IS NULL')` (unique — only orphaned-payments checks pty.id IS NULL)
  - getReceivablePayable: default (falls through to `overrides.queryRawResult`)
- **Verification**: `npx jest reconciliation.test.ts` — 13 tests pass. The party-balances check now actually tests the fixture values (p1=1300, p2=-300) instead of 0===0.
- **Status**: FIXED

### BUG-006 — Orphaned-items reconciliation check ALWAYS returns 0 — FIXED

- **Found**: 2026-07-11, during Phase 2C pre-change scan of `reconciliation.ts`
- **File**: `src/lib/reconciliation.ts:162-172` (`checkOrphanedData` function)
- **Severity**: High (the check is designed to catch DB integrity issues but could never fire)
- **Description**: The orphaned-items query had a contradictory `EXISTS` clause: `WHERE t.id IS NULL AND EXISTS (SELECT 1 FROM Transaction t2 WHERE t2.id = ti.transactionId)`. If the parent Transaction was hard-deleted (t.id IS NULL), the EXISTS subquery also can't find it → always false → count always 0. The check could never detect the exact orphans it was designed to catch.
- **Root cause**: TransactionItem has no `userId` field. The original author tried to scope the orphan check to the current user via the parent Transaction's userId, but since the parent is deleted, there's no row to read userId from.
- **Fix applied**: 2026-07-11. Removed the EXISTS clause entirely. The orphaned-items check is now global (not user-scoped). This is appropriate because: (1) orphans indicate a DB integrity issue (FK bypass), not a user data issue; (2) TransactionItem has no userId field; (3) a global check that fires is better than a user-scoped check that never fires. The orphaned-payments check remains correctly user-scoped because Payment HAS its own userId field.
- **Regression guard**: Added in `src/__tests__/lib/raw-sql-smoke.test.ts` under "V17 Phase 2C — reconciliation.ts verification" → "BUG-006 fix: orphaned-items query does NOT have the contradictory EXISTS clause".
- **Status**: FIXED

### BUG-005 — `validation.test.ts` had 5 tsc errors (discriminated union not narrowed) — FIXED

- **Found**: 2026-07-11, after user pointed out I was ignoring pre-existing tsc errors
- **File**: `src/__tests__/lib/validation.test.ts` (lines 30, 40, 50, 60, 71)
- **Severity**: Low (type-level only — tests passed at runtime, but `tsc --noEmit` failed)
- **Description**: The test file accessed `result.error` after `expect(result.success).toBe(false)`. TypeScript does NOT narrow the discriminated union `{ success: true; data } | { success: false; error }` based on an `expect()` call — `expect()` returns a Jest assertion object, not a boolean, so it's not a type guard. The 5 occurrences all followed the pattern:
  ```ts
  const result = validateBody(createTransactionSchema, invalid)
  expect(result.success).toBe(false)
  expect(result.error).toContain('type')  // ← tsc error: 'error' doesn't exist on the union
  ```
- **Why this matters even though tests passed at runtime**:
  1. `tsc --noEmit` fails → anyone adding `tsc` as a CI build gate would block deploys
  2. IDE shows red squiggles → misleading signal that code is broken
  3. Sets a precedent of "we ignore tsc errors" → real type bugs get missed
  4. The fix is trivial and correct — no reason to leave it broken
- **Fix applied**: 2026-07-11. Wrapped each `result.error` access in `if (!result.success) { ... }` — a proper TypeScript type guard that narrows the union. 5 occurrences fixed with the same pattern. This matches the existing pattern already used at lines 182-185 of the same file.
- **Verification**:
  - `npx tsc --noEmit`: **0 errors** (was 5 before fix). Codebase is now fully type-clean.
  - `npx jest validation.test.ts`: 19 tests, ALL PASS (same as before — runtime behavior unchanged).
  - `npx eslint validation.test.ts`: clean.
- **Scanned for same pattern elsewhere**: Grepped `src/__tests__/` for `expect(result.success).toBe(false)` followed by `result.error` access. Other test files (`phase5-technical.test.ts`, `decimal-quantity.test.ts`) call `expect(result.success).toBe(false)` but DON'T access `result.error` afterward, so they don't have this bug. No other instances found.
- **Status**: FIXED

### BUG-003 — `getReceivablePayable` COUNT(*) includes income/expense transactions (Low/Medium) — FIXED

- **Found**: 2026-07-11, during Phase 2B pre-change scan
- **File**: `src/lib/party-balance.ts:221`
- **Severity**: Low/Medium
- **Description**: The SQL `COUNT(*) AS "txnCount"` counted ALL transaction types (sale, purchase, credit-note, debit-note, income, expense) that had a `partyId` set. The schema allows `partyId` on income/expense transactions (validation.ts:51 has no refinement to prevent it). While income/expense typically use `payeeName`/`payeePhone` instead of `partyId`, nothing prevented a client from setting `partyId` on an income/expense transaction, which would inflate the `transactionCount` shown in the party list UI.
- **Fix applied**: 2026-07-11, as part of V17 Paise Migration Phase 2B. Changed `COUNT(*)` to `COUNT(CASE WHEN "type" IN ('sale', 'purchase', 'credit-note', 'debit-note') THEN 1 END)` — standard SQL, counts only transaction types that have financial impact on the party balance.
- **Regression guard**: Added in `src/__tests__/lib/raw-sql-smoke.test.ts` under "V17 Phase 2B — paise-read-pattern regression guard" → "BUG-003 fix: COUNT uses CASE WHEN type IN (...) not COUNT(*)".
- **Status**: FIXED

---

### BUG-014 — GSTR-3B API returns 500 "Failed to compute GSTR-3B" (High/API) — FIXED

- **Found**: 2026-07-15, during browser testing of V22-3 Phase 1
- **File**: `src/app/api/gstr-3b/route.ts` — the `computeGstr3bValues` function
- **Severity**: High (GSTR-3B filing is a core compliance feature)
- **Description**: The GSTR-3B API returns HTTP 500 for all months. The error is caught and returns `{ error: "Failed to compute GSTR-3B", errorId: "..." }`. The actual error is server-side and not visible without Vercel function logs.
- **Root cause**: The `computeGstr3bValues` function fired 11 parallel queries in a single `Promise.all`. On Neon's free tier with `connection_limit=1`, this causes connection pool exhaustion — the queries queue behind a single connection, and some timeout before completing.
- **Fix applied**: 2026-07-16 (V22-15 Phase 9). Split the 11 queries into 2 batches: Batch 1 (6 queries) wakes the DB, Batch 2 (5 queries) runs warm. Same pattern as the Dashboard API's 2-batch strategy.
- **Status**: FIXED

### BUG-015 — `lazy()` called inside function body caused Settings to re-mount and lose state (High/UX) — FIXED

- **Found**: 2026-07-15, during V22-6 Phase 4 deep scan of AccountScreen.tsx
- **File**: `src/components/layout/AccountScreen.tsx` — `AccountSectionContent` function
- **Severity**: High (Settings form lost all unsaved changes on any parent re-render)
- **Description**: The `lazy(() => import('@/components/settings/Settings'))` call was inside the `AccountSectionContent` function body. React's `lazy()` creates a new lazy component each time it's called. Since `AccountSectionContent` re-renders on every parent state change (e.g., when the settings query refetches, when the user types in a field, when the dashboard data loads), a NEW lazy component was created on every render. React treated this as a different component type → unmounted the old Settings → remounted a new one → all form state (typed text, selected values, dirty flags) was lost.
- **User impact**: If a user was filling out the profile form (e.g., typing their GSTIN) and any background query refetched, the entire form would reset to empty. Extremely frustrating.
- **Fix applied**: 2026-07-15 (V22-6 Phase 4). Moved the `lazy()` call to module scope (top of file, after imports). Now the lazy component is created once and is stable across all renders. Settings form state is preserved.
- **Verification**: Browser-tested — filled profile form fields, waited for background refetch, confirmed form values persisted.
- **Status**: FIXED

### BUG-016 — Bill-wise Profit report summary totals are incorrect when 500+ transactions exist (Medium/Reporting) — OPEN

- **Found**: 2026-07-15, during V22-12 Batch B pre-change scan of Bill-wise Profit API
- **File**: `src/app/api/reports/route.ts` — the `bill-profit` report type (lines 567-634)
- **Severity**: Medium (incorrect financial summary for high-volume shops)
- **Description**: The Bill-wise Profit report fetches transactions with `take: 500` (a safety cap to avoid loading too many rows). The per-bill rows are correctly truncated, BUT the summary totals (`totalRevenue`, `totalCogs`, `totalProfit`, `avgMargin`) are calculated from the truncated `bills` array (lines 615-618), NOT from all transactions. For shops with 500+ transactions in the date range, the summary would show incorrect totals — only reflecting the latest 500 bills, not all bills.
- **User impact**: A shop with 600 sales in a month would see summary totals that only reflect the latest 500 sales, underreporting revenue/profit by ~17%. The per-bill table is also truncated (only shows 500 rows), but the summary should use SQL aggregation (like the Item-wise Profit report does) to compute accurate totals across ALL transactions.
- **Root cause**: The bill-profit report loads raw transaction rows with items (for the per-invoice table), which requires `take: 500` to avoid memory issues. The summary was calculated from these truncated rows instead of using a separate SQL aggregate query.
- **Fix approach**: Run a separate `db.transaction.aggregate` or raw SQL `SUM` query (without `take`) to compute the summary totals, while keeping the per-bill table capped at 500. The new Item-wise Profit report (`item-profit` type) already uses raw SQL `GROUP BY` which doesn't have this issue.
- **Status**: OPEN — needs fix in a future batch. The Item-wise Profit report (added in V22-12 Batch B) is the recommended alternative for accurate per-product profit totals.

### BUG-017 — Document Vault upload limited to ~4.5MB by Vercel serverless body size (Low/Infrastructure) — OPEN

- **Found**: 2026-07-16, during V22-14 Batch D bug scan of Document Vault API
- **File**: `src/app/api/documents/route.ts` — POST handler
- **Severity**: Low (most business documents are under 4MB)
- **Description**: The Document Vault API accepts file uploads via JSON body (base64-encoded). The API validates a 10MB max file size. However, Vercel's default serverless function body size limit is 4.5MB. Files larger than 4.5MB will fail with a 413 error from Vercel's infrastructure before the API's own validation runs.
- **User impact**: Users uploading large PDFs (e.g., detailed bank statements, multi-page GST certificates) over 4.5MB will see an upload failure. Most business documents (bills, ID proofs, single-page certificates) are well under this limit.
- **Fix approach**: Use direct browser-to-Cloudinary uploads (unsigned upload preset) instead of routing through the serverless function. This bypasses Vercel's body size limit entirely. The serverless function would only store the metadata after the upload succeeds.
- **Status**: OPEN — acceptable for now. The API's 10MB validation is still correct (it just won't be reached for files >4.5MB on Vercel). Users who need to upload larger files can split them or compress first.

### BUG-018 — HSN Summary report 100× money bug (Critical/Paise) — FIXED

- **Found**: 2026-07-16, during Audit V22 §5 verification
- **File**: `src/app/api/reports/route.ts` — HSN Summary report type
- **Severity**: Critical (100× inflated values — same class as V20-002)
- **Description**: The HSN report's raw SQL returns paise (Int columns), but the code used `roundMoney()` without `fromPaise()` first → taxableValue, CGST, SGST, IGST, and totalTax all displayed 100× too large.
- **Root cause**: Raw SQL `$queryRaw` bypasses the Prisma money extension. Every raw SQL query that returns money columns MUST convert paise→rupees via `fromPaise()` at the JS boundary. This was missed when the HSN report was added in V22-9.
- **Fix applied**: 2026-07-16 (Audit V22 response). Added `fromPaise()` to all 5 raw SQL value conversions.
- **Status**: FIXED

### BUG-019 — Item-wise Profit report 100× money bug (Critical/Paise) — FIXED

- **Found**: 2026-07-16, during Audit V22 §5 verification
- **File**: `src/app/api/reports/route.ts` — Item-wise Profit report type
- **Severity**: Critical (100× inflated values — same class as V20-002)
- **Description**: Same class of bug as BUG-018. Raw SQL returns paise (Int columns for revenue and COGS), but the code used `roundMoney()` without `fromPaise()` → revenue, COGS, and profit all 100× too large. E.g., ₹5,700 showed as ₹5,70,000.
- **Root cause**: Same as BUG-018 — raw SQL bypasses the money extension.
- **Fix applied**: 2026-07-16 (Audit V22 response). Added `fromPaise()` to revenue and cogs conversions. Profit is computed from converted values.
- **Browser verified**: Tata Tea Gold now shows ₹5,700 (was ₹5,70,000 before fix).
- **Status**: FIXED

### BUG-020 — TransactionItem missing aggregate handler in money extension (Critical/100×) — FIXED

- **Found**: 2026-07-16, during Audit V23 §1
- **File**: `src/lib/prisma-money-extension.ts` — transactionItem handler block
- **Severity**: Critical (100× comparison mismatch in GST reconciliation)
- **Description**: The transactionItem block had findMany/findFirst/findUnique/create/createMany/update/updateMany but NO aggregate or groupBy handler. db.transactionItem.aggregate() returned raw paise while db.transaction.aggregate() returned rupees → 100× mismatch in reconciliation.ts checkGstReconciliation() → false "books don't tie out" alert for every GST user.
- **Fix applied**: 2026-07-16 (Audit V23 response). Added aggregate + groupBy handlers (copy of Transaction's pattern).
- **Status**: FIXED

### BUG-021 — Staff profit-hiding bypass in bill-profit + item-profit reports (Critical/Security) — FIXED

- **Found**: 2026-07-16, during Audit V23 §3
- **File**: `src/app/api/reports/route.ts`
- **Severity**: Critical (staff could see owner's profit data despite hideProfit being enabled)
- **Description**: hideProfit was only applied to the 'pl' report. bill-profit and item-profit returned full profit/COGS/margin to any staff with reports access.
- **Fix applied**: 2026-07-16 (Audit V23 response). Return 403 for bill-profit + item-profit when hideProfit=true.
- **Status**: FIXED

### BUG-022 — AccountScreen footer version string hardcoded, drift from About page (Low/Maintenance) — FIXED

- **Found**: 2026-07-17, during Audit V23 Batch L §13.9e scan
- **File**: `src/components/layout/AccountScreen.tsx` (line 779 footer + line 1242 About)
- **Severity**: Low (cosmetic, but erodes trust — beta testers couldn't tell which version they were on)
- **Description**: Two hardcoded version strings lived in different files:
  - AccountScreen footer: `"EkBook v1.0 · Made with love for Bharat 🇮🇳"`
  - About page: `"EkBook v1.0.0 (Beta)"`
  They had drifted: footer said v1.0, About said v1.0.0. Bumping the version required editing two files and hoping they stayed in sync.
- **Fix applied**: 2026-07-17 (Batch L §13.9e). Created `src/lib/app-version.ts` with single `APP_VERSION_LABEL` constant (defaults to `'1.0.0-beta'`, overridable via `NEXT_PUBLIC_APP_VERSION` env var for Vercel build-specific versioning). Both surfaces now import and render the same constant.
- **Status**: FIXED

### BUG-023 — Analytics `email_hash` trait was reversible base64, not a hash (High/PII) — FIXED

- **Found**: 2026-07-17, during Audit V23 Batch L §13.9g scan
- **File**: `src/app/page.tsx:258` (post-auth identify), `src/components/auth/AuthScreen.tsx:110` (post-login identify)
- **Severity**: High (PII leak — emails could be recovered from analytics events)
- **Description**: The `email_hash` trait sent to PostHog was computed as `btoa(email).slice(0, 16)`. Base64 is an ENCODING, not a hash — it's fully reversible. Truncating to 16 chars still leaks ~12 chars of the actual email. Anyone with access to the PostHog dashboard could decode these back to plaintext emails for short addresses. The trait name `email_hash` claimed it was hashed when it wasn't.
  Worse: AuthScreen.tsx used the same `btoa(email).slice(0,16)` AS the `userId` placeholder passed to `identifyUser()` — meaning the reversible value was the analytics userId itself, not just a trait. A user's email-derived ID was the primary key in the analytics platform.
- **Fix applied**: 2026-07-17 (Batch L §13.9g).
  - Added `hashEmail()` async helper in `src/lib/analytics.ts` using Web Crypto `subtle.digest('SHA-256', ...)` — a true one-way hash, hex-encoded, first 16 chars (64 bits, good attribution uniqueness).
  - Returns empty string in SSR or non-secure contexts (subtle requires HTTPS or localhost) — callers skip the trait rather than fall back to btoa.
  - `page.tsx`: identify fires immediately (no delay), then async hash resolves and enriches with the real `email_hash` trait. Raw email never reaches the platform.
  - `AuthScreen.tsx`: post-login identify uses the SHA-256 hash as both userId placeholder AND `email_hash` trait. Once the real session loads, `page.tsx` re-identifies with the real DB userId.
- **Verification**: tsc 0 errors, jest 1616/1616, build clean. No `btoa(email)` left in src/ (only comment references documenting the prior bug).
- **Status**: FIXED

### BUG-024 — Logout button silently failed if clearAllOfflineData threw (Medium/UX) — FIXED

- **Found**: 2026-07-17, during Audit V23 Batch L §13.9d scan
- **File**: `src/components/layout/AccountScreen.tsx:742-758`
- **Severity**: Medium (user taps Logout, nothing happens, no feedback)
- **Description**: The onClick handler was a chain of `.then()` calls with no `.catch`:
  ```
  import(next-auth).then(({ signOut }) =>
    import(offline-db).then(({ clearAllOfflineData }) =>
      clearAllOfflineData().then(() => signOut(...))))
  ```
  If `clearAllOfflineData()` threw (e.g., IndexedDB blocked by browser privacy mode, quota error, or a corrupted object store), the promise rejected, no `.catch` handled it, and `signOut()` never ran. The user tapped Logout, the button did nothing, no toast, no error, no redirect.
- **Fix applied**: 2026-07-17 (Batch L §13.9d). Rewrote as async/await with try/catch around each step:
  - `clearAllOfflineData` failure is logged but non-fatal (`console.warn`).
  - `signOut` runs unconditionally afterward.
  - If even `signOut` throws, last-resort `window.location.href = '/'` ensures the user is never stuck on a dead button.
- **Status**: FIXED

### BUG-025 — GSTR-3B 3.1(e) nonGstValue inflated by all income types (Medium/GST-filing) — FIXED

- **Found**: 2026-07-17, during Audit V23 Batch L §13.9i scan
- **File**: `src/app/api/gstr-3b/route.ts:101-104`
- **Severity**: Medium (wrong 3.1(e) value on every GSTR-3B that has non-supply income)
- **Description**: `nonGstValue` was computed as `SUM(totalAmount) WHERE type='income'` over ALL income transactions. But the income categories defined in `IncomeExpense.tsx` include 'Commission', 'Interest', 'Rent Received', 'Discount Received', 'Refund', 'Miscellaneous' — these are NON-SUPPLY income (interest on bank deposits, rent of own property, etc.), NOT outward supplies of goods/services. They do NOT belong in 3.1(e) "Non-GST outward supplies". Including them inflated 3.1(e) for every shop that records interest or commission income — a kirana with ₹2,000 bank interest would see ₹2,000 wrongly added to 3.1(e).
- **Fix applied**: 2026-07-17 (Batch L §13.9i). Filter to `category: 'Scrap Sale'` only — the one income category that could plausibly be a non-GST outward supply (casual sale of capital assets like scrap). Most kirana users now correctly get `nonGstValue=0`. TODO added in code for a proper `isNonGstSupply` flag on Transaction for users who genuinely sell non-GST goods (alcohol, petrol, lottery).
- **Status**: FIXED

### BUG-026 — Sidebar + MoreScreen logout had same clearAllOfflineData anti-pattern as AccountScreen (Medium/UX) — FIXED

- **Found**: 2026-07-17, during Audit V23 Batch L follow-up scan
- **Files**: `src/components/layout/Sidebar.tsx:94-103`, `src/components/layout/MoreScreen.tsx:229-238`
- **Severity**: Medium (logout button silently fails on IDB errors — same class as BUG-024)
- **Description**: When I fixed BUG-024 (AccountScreen logout chain with no .catch), I should have grepped for the same pattern elsewhere. Found two more logout handlers with the identical bug:
  - Sidebar `handleLogout`: `try { await clearAllOfflineData(); clearRecentProducts(); signOut(...) } catch { toast('Failed to logout') }`
  - MoreScreen `handleLogout`: `try { await clearAllOfflineData(); signOut(...) } catch { toast('Failed to logout') }`
  In both: if `clearAllOfflineData()` throws (IndexedDB blocked by browser privacy mode, quota error, corrupted store), `signOut()` never runs. User taps Logout, sees "Failed to logout" toast, and is stuck on a dead button. The toast is also misleading — logout itself didn't fail, only the offline-cache clear did.
- **Fix applied**: 2026-07-17 (Batch L follow-up). Both handlers now wrap `clearAllOfflineData()` in its own try/catch (failure logged but non-fatal), then `signOut()` runs unconditionally in a separate try/catch with a `window.location.href = '/'` fallback if even signOut throws. Matches the AccountScreen pattern from BUG-024.
- **Status**: FIXED

### BUG-027 — Desktop free-plan users could not open ANY transaction (High/UX) — FIXED
- **Found**: 2026-07-17 (auditor browser-verification session, V24 batch 2)
- **Severity**: High — clicking a sale/purchase row on desktop did nothing for free-plan users
- **Description**: `Ledger.tsx handleViewTransaction` only navigated to `transaction-detail` on mobile (`max-width: 1023px`). On desktop it relied on `LedgerSplitView` showing the detail pane — but the split view is Pro-gated (`canUse('split_view')`). The code contained four lines of comments describing exactly the needed free-desktop fallback ("we need to also navigate to detail for free users on desktop") and never implemented it. Result: on the desktop free plan, every transaction row was unopenable — no detail, no edit, no PDF, no credit note.
- **Repro**: free-plan account, viewport ≥1024px, Sales Ledger → click any row → nothing happens.
- **Fix applied**: 2026-07-17 — `handleViewTransaction` now navigates to `transaction-detail` when `isMobile || !canUse('split_view')` (same `useSubscription().canUse` gate the split view uses). Browser-verified: row click now opens the detail page on a free desktop account.
- **Status**: FIXED

### BUG-028 — Interactivity depends on exit animations completing (Medium/UX-robustness) — OPEN
- **Found**: 2026-07-17 (auditor browser-verification session)
- **Severity**: Medium (freeze only under throttled rendering; but the failure mode is total click-blocking)
- **Description**: Radix dialogs (Onboarding, ThemePicker, and by extension every Dialog) unmount only after their CSS exit animation fires `animationend`. In any environment where the compositor is throttled or rAF is paused (backgrounded tab, aggressive battery-saver, embedded webviews, automation), a closed dialog's invisible overlay stays in the DOM with `data-state="closed"` and intercepts ALL clicks — the app appears completely frozen. Directly observed: both first-run dialogs stuck at `data-state="closed"` with `playState: "running"` exit animations that never ended; every sidebar click was eaten by the invisible overlay. Related: `useCountUp` KPI values render ₹0 forever when rAF is paused (dashboard "Today's Revenue" showed ₹0 while the hero text showed ₹700).
- **Suggested fix**: (a) add a timeout fallback to dialog unmounts (if animationend hasn't fired within ~400ms of state=closed, force-remove/hide); (b) ensure count-up hooks render the FINAL value immediately when `document.visibilityState === 'hidden'` or on rAF starvation; (c) audit for other animation-load-bearing UI (splash `onFinish`).
- **Status**: OPEN

### BUG-029 — First-run Theme Picker and Onboarding dialogs can stack (Low/UX) — OPEN
- **Found**: 2026-07-17 (auditor browser-verification session)
- **Description**: On a brand-new account, the ThemePicker and the Onboarding welcome dialog can both be mounted simultaneously (two stacked modals with competing overlays; which one receives clicks depends on DOM order). `showOnboarding` gates on `themePickerDone`, but the transition frame where the picker closes and onboarding opens leaves both in the DOM (compounded by BUG-028 in throttled environments). Sequence the two flows explicitly (single first-run wizard) instead of two independent modals.
- **Status**: OPEN

### BUG-030 — Credit-note entry summary shows profit REVERSAL as positive "Gross Profit" (Low/cosmetic) — OPEN
- **Found**: 2026-07-17 (auditor browser-verification session)
- **Description**: While creating a credit note, the live summary shows "Gross Profit ₹90 (30.0%)" in positive green for a ₹300 return — but this is profit being REVERSED, not earned (server correctly stores negative). Label it "Profit reversed: −₹90" (rose) when `isNote`.
- **Status**: OPEN

### BUG-031 — Party balances can appear stale for up to 30s after a return/payment (Low/UX) — OPEN
- **Found**: 2026-07-17 (auditor browser-verification session)
- **Description**: `/api/parties` responses carry `withCache` max-age 30s. React-query invalidation refetches after a save, but the browser HTTP cache can satisfy that refetch with the stale response (observed: balance showed ₹1,000 for ~30s after a credit note; `cache:'no-store'` returned ₹700). Money-bearing endpoints should send `Cache-Control: no-store` (or the client should refetch with cache-busting) — a shopkeeper seeing a stale khata for 30s after recording a return will distrust the number.
- **Status**: OPEN

### BUG-032 — MoreScreen 8 items navigate to wrong/under-delivering views (Medium/UX) — OPEN (deferred to Batch 1b)

- **Found**: 2026-07-17, during V25 Audit Batch 1 pre-change scan of MoreScreen.tsx
- **Files**: `src/components/layout/MoreScreen.tsx` (lines 80, 81, 104, 105, 106, 118, 119, 138)
- **Severity**: Medium (8 More directory entries promise features but under-deliver on tap)
- **Description**: 8 items in MoreScreen's SECTIONS array navigate to a view that doesn't match the label's promise:
  1. **Sale Return** (line 80): label says "Credit notes — return from customer" but `view: 'sales'` opens the sales ledger. No credit-note creation flow is triggered.
  2. **Purchase Return** (line 81): label says "Debit notes — return to supplier" but `view: 'purchases'` opens the purchase ledger. No debit-note creation flow.
  3. **Cash in Hand** (line 104): label says "Today's cash position & collections" but `view: 'dashboard'` opens the plain dashboard with no scroll-to-cash-in-hand or modal.
  4. **Day-End Summary** (line 105): label says "Close the drawer — daily cash" but `view: 'dashboard'` opens the dashboard without triggering the Close Drawer dialog (which is local state in Dashboard.tsx).
  5. **WhatsApp Reminders** (line 106): label says "Send payment reminders" but `view: 'parties'` opens the parties list. The BulkRemindersModal is local state in Parties.tsx — no way to auto-open it from More.
  6. **Multi-Shop Management** (line 118): label says "Switch or add shops" but `view: 'settings'` opens Settings on the Profile tab. No "Shops" tab exists in the Settings tab bar (it's a singleTab prop thing).
  7. **Staff & Access** (line 119): label says "Manage staff, CA access" but `view: 'settings'` opens Settings on the Profile tab. The Staff tab exists but isn't auto-selected.
  8. **Smart Insights** (line 138): label says "AI-powered alerts & suggestions" but `view: 'dashboard'` opens the dashboard without scrolling to the SmartInsights section (which sits ~6 screens down — see V25 §2.4).
- **Fix approach**: Requires deep-linking infrastructure that doesn't exist yet:
  - For #1, #2: navigate to `new-sale` / `new-purchase` with a `isNote: true` param (or add a `view: 'new-credit-note'` / `'new-debit-note'`).
  - For #3, #4, #8: add a `triggerDayEnd` / `scrollTarget` store field (similar to existing `triggerNewEntry` counter pattern) that Dashboard subscribes to.
  - For #5: add a `triggerBulkReminders` store field that Parties subscribes to (or move BulkRemindersModal open state to the store).
  - For #6, #7: use existing `setPendingSettingsTab('staff')` before `setView('settings')` — Settings.tsx already reads this.
- **Why deferred**: This is a deep-linking infrastructure task (5+ new store fields, modifications to Dashboard, Parties, Settings, TransactionEntry, MoreScreen). Better as its own batch (Batch 1b) after the dead-code cleanup ships. Not in scope of the §4 dead-code batch.
- **Status**: OPEN — deferred to Batch 1b

### BUG-033 — Reports back button stranded desktop users on mobile More screen (Medium/UX) — FIXED

- **Found**: 2026-07-17, during V25 Audit Batch 2 §2.3 scan (same anti-pattern class as §2.3)
- **File**: `src/components/reports/Reports.tsx:291`
- **Severity**: Medium (desktop users landing on a single report with no previousView got stranded)
- **Description**: `handleBackToHub` in Reports.tsx had the same anti-pattern as the Pricing back button (V25 §2.3): `setView(prev || 'more')`. If a user opened a report directly (e.g., via shared URL or after a page reload when previousView was null), the back button sent them to `'more'` — which on desktop used to render full-screen with no sidebar (the V25 §2.3 bug). Even after §2.3 fix makes More render with sidebar on desktop, sending users to More when they didn't come from More is still wrong behavior.
- **Fix applied**: 2026-07-17 (Batch 2 §2.3 follow-up). Changed fallback from `'more'` to `'dashboard'` — always safe, always has full chrome. Matches the pattern already used by MoreScreen.tsx and AccountScreen.tsx handleBack.
- **Status**: FIXED

### BUG-034 — /api/dashboard was also cached (maxAge: 30, swr: 300) — same class as BUG-031 (High/Money) — FIXED

- **Found**: 2026-07-17, during V25 Batch 5 §5.1 scan (same anti-pattern class as BUG-031)
- **File**: `src/app/api/dashboard/route.ts:589`
- **Severity**: High (dashboard is the MOST money-bearing endpoint — revenue, profit, receivable, payable, KPIs)
- **Description**: Same anti-pattern as BUG-031. The dashboard GET handler used `withCache({ maxAge: 30, swr: 300 })`. A shopkeeper who just made a sale would see stale revenue/KPIs for up to 30s while the browser HTTP cache served the old response. React-query invalidation refetched, but the refetch could return the cached 200 instead of hitting the server.
- **Fix applied**: 2026-07-17 (Batch 5 §5.1 follow-up). Replaced `withCache(...)` with `noStore(...)`. Dashboard data is now always fresh.
- **Status**: FIXED
