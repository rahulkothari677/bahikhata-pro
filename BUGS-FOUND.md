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

### BUG-010 — `item.discountAmount` input field is accepted but silently ignored (Low/APIDesign)

- **Found**: 2026-07-11, during Phase 3 pre-change scan of `line-items.ts` + `validation.ts`
- **File**: `src/lib/validation.ts:26` (Zod schema) + `src/lib/line-items.ts` (computeLineItems)
- **Severity**: Low (API design issue, no data corruption)
- **Description**: The `transactionItemSchema` accepts a `discountAmount` field per line item:
  ```ts
  discountAmount: z.coerce.number().min(0).optional().default(0)
  ```
  But `computeLineItems()` NEVER reads `item.discountAmount` from the input. It computes the per-item discount as the proportional share of the ORDER-level discount:
  ```ts
  const perItemDiscounts = distributeDiscountProportionally(grossAmounts, toMoney(orderDiscount))
  const itemDiscount = roundMoney(perItemDiscounts[idx])
  ```
  So if a client sends `items: [{ productName: 'X', quantity: 2, unitPrice: 100, discountAmount: 50 }]`, the `discountAmount: 50` is **silently dropped**. The stored `discountAmount` will be the proportional share of the order-level discount (0 if no order discount).
- **Impact**: 
  - No data corruption (the stored value is always correct — proportional share of order discount)
  - But: misleading API — the field suggests per-item discounts are supported, when they're not
  - If a frontend developer builds a "per-item discount" UI based on this field, it will appear to work (no error) but the discount won't be applied
- **Fix**: Either (a) remove `discountAmount` from the item input schema (breaking change for any client that sends it), or (b) implement per-item discount support in `computeLineItems` (add `item.discountAmount` to the per-item discount calculation). Option (b) is more user-friendly but changes behavior.
- **Status**: OPEN — defer to a future API design cleanup sub-phase (not blocking paise migration)

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

- **Found**: 2026-07-11, during Phase 2D verification (broader test sweep)
- **File**: `src/__tests__/lib/csv-export.test.ts` (test infrastructure)
- **Severity**: Medium (test crashes Jest runner, blocking the test suite)
- **Description**: Running `npx jest src/__tests__/lib/csv-export.test.ts` crashes the Node.js process with an unhandled rejection loop (~93 duplicate stack traces from `next/src/server/node-environment-extensions/unhandled-rejection.tsx`). The process exits with no test results.
- **Verification**: Confirmed PRE-EXISTING — reproduced on `aa7edb7` (Phase 2C, before Phase 2D changes) via `git stash`. NOT caused by paise migration.
- **Likely cause**: The test file probably imports something that triggers Next.js server-side environment extensions which conflict with Jest's jsdom environment. Could be a missing mock or an import of a route handler that pulls in next/server.
- **Fix**: Investigate the test file's imports, add mocks for next/server components, or move to a different test environment. Defer to a dedicated test-infra fix sub-phase.
- **Status**: OPEN — defer to a dedicated test-infra fix sub-phase (not blocking paise migration)

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

- **Found**: 2026-07-11, during Phase 2B pre-change scan
- **File**: `src/lib/party-balance.ts:83-120`
- **Severity**: Low (performance)
- **Description**: `computePartyBalance` makes 7 DB queries in 2 sequential batches:
  - Batch 1 (line 83): `Promise.all([salesAgg, purchaseAgg, creditNoteAgg, debitNoteAgg, paymentsAgg])` — 5 queries
  - Batch 2 (line 111): `Promise.all([receivedAgg, paidAgg])` — 2 queries
  - Batch 2 does NOT depend on Batch 1 results. They could all run in parallel as a single `Promise.all` with 7 promises, saving 1 round-trip of latency.
- **Impact**: Adds ~1 DB round-trip (~5-20ms on Neon) to every party-detail page load and every WhatsApp reminder send.
- **Fix**: Merge both batches into a single `Promise.all([salesAgg, purchaseAgg, creditNoteAgg, debitNoteAgg, paymentsAgg, receivedAgg, paidAgg])`.
- **Status**: OPEN — defer to a later sub-phase (not part of paise migration)

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
