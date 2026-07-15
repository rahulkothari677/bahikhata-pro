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

### BUG-014 — GSTR-3B API returns 500 "Failed to compute GSTR-3B" (High/API)

- **Found**: 2026-07-15, during browser testing of V22-3 Phase 1
- **File**: `src/app/api/gstr-3b/route.ts` — the `computeGstr3bValues` function
- **Severity**: High (GSTR-3B filing is a core compliance feature)
- **Description**: The GSTR-3B API returns HTTP 500 for all months. The error is caught and returns `{ error: "Failed to compute GSTR-3B", errorId: "..." }`. The actual error is server-side and not visible without Vercel function logs.
- **Root cause**: Unknown — needs Vercel function logs to diagnose. Likely related to the Prisma money extension converting aggregate `_sum` values, or a SQL query issue with the paise migration.
- **Status**: OPEN — needs investigation with Vercel logs

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
