# Report 4 — Scale sweep (the N-series findings)

**Date:** 2026-08-02
**Trigger:** N1 was found *by accident* while re-reading an unrelated change. That means the
bug class had never been swept for, so this report sweeps it deliberately.
**Method:** comment-stripped AST-ish scan of every `findMany` / transaction loop in
`bahikhata-pro`, then manual triage of each hit.

> A telling signal: **the admin panel has an `unbounded-queries.test.ts` guard. The main
> ledger app does not.** The app holding the actual financial data is the one without the
> guard.

---

## N1 — Sequential DB round-trips inside interactive transactions — **FIXED**

**Status:** fixed in `60f1cda`.

`PUT /api/transactions/[id]` was fixed for this during the P2028 work and carries a comment
explaining why it matters. **Four other paths never received the same fix:**

| Path | What it does |
|---|---|
| `POST /api/transactions` | create a bill |
| `DELETE /api/transactions/[id]` | void a bill (stock reversal) |
| `POST /api/transactions/[id]/restore` | un-void a bill |
| `POST /api/transactions/[id]/convert` | estimate → sale |

Each ran `for (item of items) { await tx.product.updateMany(...) }` — **one sequential
round-trip per line item, inside the open transaction.**

A 20-line wholesale bill = 20 sequential round-trips on create, up to 40 on void. At the
200–500 ms/query this app sees on Neon under pool contention, that exhausts the transaction
budget and Prisma rolls the whole operation back with **P2028**.

The failure mode is what makes this bad: the user is never told it was a timeout. The sale
just fails. On the void path it's worse — a void that fails leaves a bill that cannot be
cancelled.

**Also a correctness fix.** Where one product appeared on two lines, the per-line check
tested each line against stock separately rather than the bill's *total* demand for that
product. On block paths that made the error message quote a post-partial-decrement figure;
on reversal paths it made the `gte` guard fire on a partial shortfall instead of the real one.

All four now group per product and issue updates concurrently.

---

## N2 — Nightly reconciliation loads every user, then processes them one at a time

**Severity: Critical at scale. Not yet fixed.**
`src/app/api/cron/nightly-reconciliation/route.ts:74`

```ts
const users = await db.user.findMany({
  select: { id: true, email: true, name: true },
  orderBy: { createdAt: 'asc' },
})
// ... then reconciliation runs SEQUENTIALLY, one user at a time
```

No pagination, no batching, no resume point. At a million users this loads a million rows
into a serverless function's memory and then tries to reconcile them one after another
inside a single invocation with a `maxDuration` ceiling.

**Why this one is worse than it looks:** this is the job that *detects ledger drift*. When it
silently stops completing, you don't just lose a background task — you lose the mechanism
that tells you the books have gone wrong. It fails exactly when you most need it, and it
fails quietly.

**Fix shape:** cursor-paginate users in batches, process with bounded concurrency, persist a
resume cursor so a timed-out run continues rather than restarting, and alert when a run does
not reach the end.

---

## N3 — Dashboard loads every product and every party on each open

**Severity: High. Not yet fixed.**
`src/app/api/dashboard/route.ts:122` and `:133`

```ts
db.product.findMany({ where: { userId }, select: { /* 7 fields */ } })   // ALL products
db.party.findMany({ where: { userId, deletedAt: null },
                    select: { id: true, openingBalance: true } })        // ALL parties
```

The dashboard is the most-opened screen in the app. A kirana with 500 products is fine; a
distributor with 20,000 products ships 20,000 rows × 7 fields **per dashboard load**.

There is also redundancy: `openingBalance` for every party is already aggregated inside
`getReceivablePayable()`, which this same handler calls.

**Fix shape:** the dashboard needs *aggregates* (stock value, low-stock count), not row
lists. Push them into SQL. Keep row fetching only for the small "low stock" preview list,
with a `take`.

---

## N4 — Same full-collection product/party scans on other read paths

**Severity: High. Not yet fixed.**

| File | Line | Scans |
|---|---|---|
| `app/api/insights/route.ts` | 59 | all products |
| `app/api/analytics/route.ts` | 89 | all in-stock products |
| `app/api/reports/route.ts` | 433, 510 | all products, all parties |
| `app/api/reports/consolidated/route.ts` | 104 | all products |

Same shape as N3 on screens that are opened slightly less often. Same fix.

---

## N5 — Per-party history loaded in full

**Severity: Medium. Not yet fixed.**
`app/api/parties/[id]/balance-as-of/route.ts:59` and `:75`

Loads every transaction and every payment for a party to compute a balance as of a date.
Correct today; grows without bound for a party with years of history. A regular wholesale
customer will eventually have thousands of rows.

**Fix shape:** aggregate in SQL with the date bound applied server-side, as
`getReceivablePayable` now does.

---

## Triage of the remaining scans — assessed and accepted

Total `findMany` without `take`: **60**. Of those:

- **10** bounded by an id-set or a parent id (`id: { in: [...] }`, `transactionId`) — bounded
  by construction.
- **9** bounded by a date range.
- **41** full-collection scans, of which the genuinely risky ones are N2–N5 above.

**Accepted as safe, with reasons:**

| Query | Why it's fine |
|---|---|
| `shops` (×4) | A user has a handful of shops. |
| `staff` | Bounded by team size. |
| `featureFlag` (×2) | Small global table. |
| `referral/status` | Bounded by a user's own referrals. |
| `transactions/[id]` linked notes (×2) | Notes against one invoice. |
| `restore-utils`, `import/restore` | One-off recovery operations, not request paths. |
| `debug/*` | Founder-gated and env-flagged. |
| `account/export`, `export/full` | Deliberately full exports. **Should stream** rather than buffer, but that is a separate change and they are not on a hot path. |
| `cron/expire-subscriptions` | Bounded by *expiring* subscriptions, not all of them. |

---

## Recommended: add the guard the admin app already has

`bahikhata-admin` has `tests/unbounded-queries.test.ts`. `bahikhata-pro` has no equivalent,
which is why N1–N5 accumulated unnoticed.

A guard test in pro should fail the build on any new `findMany` without `take` on a request
path, with an explicit allowlist for the cases accepted above — so each future exception is a
deliberate decision with a name against it, not an oversight.

---

## Status

| ID | Severity | Status |
|---|---|---|
| N1 | High | **Fixed** ✅ `60f1cda` |
| N2 | Critical (at scale) | Open |
| N3 | High | Open |
| N4 | High | Open |
| N5 | Medium | Open |
| Guard test for pro | — | Recommended |

**None of N2–N5 is a correctness bug today.** Balances and totals are right. These are the
bugs that surface as *"the app got slow as we grew"* — which is the hardest kind to diagnose
after the fact, because nothing ever appears in an error log.
