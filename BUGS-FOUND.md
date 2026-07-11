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

### BUG-005 — (RESERVED — was the validation.test.ts tsc errors, now FIXED, see Fixed bugs section)

- **Status**: FIXED (2026-07-11)

### BUG-004 — `openingBalance` on party UPDATE not rounded (Medium)

- **Found**: 2026-07-11, during Phase 2B pre-change scan of `party-balance.ts` call chain
- **File**: `src/app/api/parties/[id]/route.ts:343`
- **Severity**: Medium
- **Description**: The party UPDATE handler writes `openingBalance` using `parseFloat(body.openingBalance) || 0` — NO `roundMoney()` applied. The CREATE handler (`src/app/api/parties/route.ts:115`) correctly uses `roundMoney(openingBalance || 0)`. This inconsistency means:
  1. If a user edits a party and enters `1.005` as opening balance, it's stored as `1.005` (float with representation error `1.00499999...`)
  2. The `getReceivablePayable` SQL then reads this drift-prone value
  3. The dashboard/party-list balance may differ by 1 paisa from the party-detail balance (which uses `computePartyBalance` → Prisma aggregate → `roundMoney` in JS)
- **Repro**: Edit a party, set opening balance to `1.005`, save. Check dashboard balance vs party-detail balance — they may differ by 1 paisa.
- **Fix**: Change line 343 to `updateData.openingBalance = roundMoney(parseFloat(body.openingBalance) || 0)` (or use `parseMoney(body.openingBalance)` for consistency with the CREATE path).
- **Status**: OPEN

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
