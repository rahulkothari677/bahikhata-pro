# Report 12 — Phase 6: offline sync, backup/restore, billing

**Date:** 2026-08-03
**Commits:** `b19d602`
**One critical defect found. Two of the three areas were already sound.**

---

## Summary

| Area | Result |
|---|---|
| Offline sync / queue replay | **SOUND** — every failure mode probed was already fixed |
| Backup / restore | **CRITICAL DEFECT — FIXED** |
| Billing / subscription | **SOUND** — code-audited only (see caveat) |

The one severe bug sat in the least-exercised path: the feature you only use
after losing your phone.

---

## B1 — Restoring a backup destroyed the entire udhaar book — **FIXED**

### The defect

The export strips `id` from parties and shipped a raw `partyId` on transactions
and payments — an id that cannot resolve after a restore, because parties are
recreated with new ones. So restore looked rows up by **name**:

```ts
txn.partyName || txn.party?.name     // transactions
payment.partyName                     // payments
```

**Neither field existed.** Not in the export, and not on the model: `Transaction`
and `Payment` have `partyId`, never `partyName`, and the export did not include
the `party` relation.

### Verified against a real backup, not inferred

```
payment_hasPartyName        false
firstTxn_hasPartyName       false
firstTxn_hasPartyRelation   false
party_hasId                 false   ← so partyId can never resolve
```

Restoring that file would have **skipped all 26 payments** and restored all
**273 transactions with no party**. Every customer balance collapses to its
opening balance — the whole receivable/payable book gone, destroyed by the one
feature whose only job is to preserve it, and discovered only when someone
actually needed it.

### The fix, measured after

| | Total | Resolve now | Blocked (ambiguous name) | Missing |
|---|---|---|---|---|
| Payments | 26 | **18** (was 0) | 8 | 0 |
| Transactions | 273 | **192** (was 0) | 6 | 0 |

The remaining 75 party-less transactions are legitimate: 66 walk-in sales, 5
expenses, 1 income, 2 credit notes, 1 purchase. Income and expense have no party
by design.

---

## B2 — Duplicate names silently mis-attributed money — **FIXED**

The lookup was `map.set(p.name, p.id)`. With two parties sharing a name the
second overwrote the first, so **every row belonging to the first was silently
re-attached to the second** — one customer credited with another's payments,
both balances wrong, nothing reported.

An ambiguous name is now **skipped and counted**, never guessed. A visible gap
in a restore is recoverable; a silently mis-attributed payment is not.

---

## B3 — Skipped payments were a bare number — **FIXED**

For a backup carrying no `partyName` at all, a restore reported *"26 skipped"*
with no indication the entire collection history had just been lost. Skipped
payments now name which of three causes applied: old backup without
`partyName`, ambiguous name, or no such party.

---

## Offline sync — audited, **SOUND**

Every failure mode probed was already closed by earlier audits:

| Failure mode | Handled by |
|---|---|
| Lost response → duplicate on replay | mutation ID minted **before** the online attempt (R2) |
| Server-side dedup | `clientMutationId @unique` + tenant-ownership check, 409 cross-tenant (N1/H2) |
| Two tabs syncing at once | cross-tab mutex via Web Locks (R12) |
| Replayed DELETE | 404 treated as success (R10) |
| Server-rejected writes | 409/422 counted as `rejected`, not `synced` (R7) |
| Writes exhausting retries | dead-letter store **with** Settings UI + notification (M1/R7) |
| Estimate→sale replay | guarded by `convertedToTransactionId` (F1) |
| Stalled connection | client timeout → honest "saved offline" (R8) |
| IDB write failure | throws, surfaces an honest error (R7) |

**Replay order** is FIFO and correct, but by an *implicit* chain: `Array.sort`
is stable (ES2019) and IndexedDB `getAll()` returns key order, so equal
millisecond timestamps fall back to insertion order. It works; it is simply
undocumented and would break silently if either assumption changed.

**Nothing new found.** That is a result, not a shrug.

---

## Billing — audited, **SOUND**

| Check | Result |
|---|---|
| Signature verification | `crypto.timingSafeEqual`, both callers |
| Plan/amount binding | read from the Razorpay **order** server-side, not the client body — the signature only covers `order_id\|payment_id` |
| Replay/duplicate payment | `@@unique([paymentId])` |
| Expired plan still granting features | `getUserPlan` re-checks `endDate` and returns `free`, independent of the daily cron (F3) |

The classic hole — verifying the signature but trusting a client-supplied
amount — is explicitly closed, with the reasoning in the source.

**Caveat, stated plainly:** billing was audited by reading code and schema only.
Triggering a real Razorpay flow needs a live payment, which I did not do. The
paths above are verified logically, not empirically.

---

## Verification

- `tsc` clean, `eslint` clean
- **2649 tests across 130 suites**
- Production build clean
- Export fix verified live: `payment.partyName: "Anita Singh"`,
  `txn.partyName: "Ramesh Verma"`, raw `partyId` dropped
- Contract test verified by removing `partyName` from the export and watching
  the guard fail

One existing guard pinned the literal `payments: { imported: 0, skipped: 0 }`
and failed when the shape gained `skipReasons`. It was updated to match the
fields that matter — that change strengthens the test's own intent rather than
weakening it.

---

## Action required from the shop owner

**Take a fresh backup once this deploys.** Any backup taken before `b19d602`
lacks `partyName` and will not restore payments or party links. The restore now
says so explicitly instead of failing quietly, but old files cannot be repaired.

**Task #16:** two party names are duplicated on the live account — `"rahul"` and
`"RAHUL KOTHARI"` — costing 8 payments and 6 transactions on a restore. Fixing
it means either renaming one of each pair (non-destructive) or merging two
ledgers (needs care). That is the owner's decision, not a change to make
unilaterally.

---

## Remaining

| # | Item | State |
|---|---|---|
| 3 | Transaction lifecycle & atomicity | not started |
| 5 | Auth, multi-tenancy & authorization | not started |
| 7 | Admin panel audit (~15k LOC) | not started |
