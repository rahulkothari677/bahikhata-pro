# 16 — Phase 7: the admin panel

**Date:** 2026-08-04
**Commits:** admin `36fcd13` · main app `9ce1952`
**Tests:** admin 418 / 28 files · main app 2713 / 136 suites
**Method:** live control + treatment against the real deployment, plus targeted code sweeps

---

## The headline

> **Every sale a shopkeeper ever deleted was still counted in your GMV — and nothing
> would ever have taken it out.**

Found by creating one real sale and deleting it, not by reading code.

---

## What I did, and what happened

I created a **₹2,360 sale** in the main app (2 × ₹1,000 + 18% GST — the tax
maths was exactly right), then watched your admin dashboard.

| Step | Admin GMV | Admin transactions |
|---|---|---|
| Baseline | ₹29,23,867.03 | 2174 |
| After creating the ₹2,360 sale | ₹29,26,227.03 ✅ **+2360 exactly** | 2175 ✅ **+1** |
| **After deleting that sale** | ₹29,26,227.03 ❌ **unchanged** | 2175 ❌ **unchanged** |
| After the fix deployed | **₹29,22,980.68** | **2169** |

The first two rows are good news: fresh data reaches admin instantly and
precisely, with no caching lag and no 100× paise error.

The third row is the bug. The sale was gone from the shopkeeper's books —
requesting it returned 404 — and both admin figures sat still.

The fourth row is the fix, and it says more than I expected. The numbers landed
**below** the original baseline: **6 fewer transactions and ₹3,246.35 less**. My
probe was only 1 transaction and ₹2,360 of that. **The other 5 transactions and
₹886.35 were already-deleted entries that had been inflating your GMV** before I
touched anything.

That is independently corroborated: earlier in this session your backup export
listed 273 transactions while the live ledger listed 268 — exactly those 5
soft-deleted rows.

---

## Findings

| # | Finding | Severity | Status |
|---|---|---|---|
| 1 | Deleted transactions counted in every admin metric (33 queries) | 🔴 High | **FIXED** |
| 2 | GST report used row-creation date, not invoice date | 🔴 High | **FIXED** |
| 3 | Support-admin edits recorded as the shopkeeper's own | 🔴 High | **FIXED** |
| 4 | Route policy key is a hand-typed string that can silently drift | 🟡 Medium | **FIXED** (guard test) |
| 5 | Authorization, step-up 2FA, SQL console, setup endpoint | ✅ | **Sound — no change** |

---

## 🔴 1. Deleted transactions counted everywhere (FIXED)

**In simple words:** when a shopkeeper deletes a mistyped sale, it should stop
counting. It didn't. Your GMV could only ever go up.

The sweep found **33 queries** with this omission. The pattern was telling: the
`user.count` calls on the *very same lines* correctly excluded deleted accounts,
and the transaction ones didn't — so this had drifted in one query at a time.

**Fixed:** overview, activity, daily-stats rollup, growth, segments (6), churn
prediction, per-user stats, GST filing (5).

**Deliberately left counting deleted rows**, each annotated in the code so a
future sweep doesn't "fix" them:

- **Fraud rules and risk scoring** — creating transactions then deleting them
  *is* the laundering pattern those rules exist to catch. A row disappearing is
  evidence, not noise.
- **Data validation** — an integrity check on the table must see what's stored.
- **DPDP subject-access export** — a deleted row is still *held* (retained for
  the GST 72-month rule), so omitting it would hand someone an export missing
  data you still have about them.

**One thing worth flagging:** the daily-stats job **writes a stored rollup row**.
Wrong numbers there were baked into history and read back later as fact. The fix
corrects future runs; **past rollup rows still contain the inflated figures.**
Since you're wiping test data anyway, I'd let those clear naturally rather than
rewrite history.

---

## 🔴 2. The GST report disagreed with what shopkeepers file (FIXED)

`gst-filing.ts` had **two** faults, either one enough on its own:

1. It counted deleted invoices as outward supply.
2. It bucketed the tax period by **`createdAt`** (when the row was written)
   rather than **`date`** (the invoice date).

**Why #2 matters:** enter a 31 July invoice on 2 August — completely routine,
since catching up on paperwork is the point of the app — and it landed in
**August** in your admin report and **July** in the shopkeeper's actual return.

The main app is the authority here: it excludes deleted rows from every GST
surface without exception, and buckets by invoice date. Admin now matches it.

---

## 🔴 3. A support admin's edits were recorded as the shopkeeper's (FIXED)

**In simple words:** if you log in as a shopkeeper to help them and change
something, their records said **they** did it. There was no way for them to tell
your edit from their own.

An admin impersonating a shopkeeper can write to **34 of the 43** mutating routes
(9 are blocked: exports, account delete, restore, payments, staff). Both trails
then named the shopkeeper:

- `AuditLog.userId` — the shopkeeper, correctly, since it's their trail. But
  nothing else was stored, so the two were indistinguishable.
- `FieldChangeLog.changedByUserId` — the shopkeeper's id, **in a table your own
  schema calls "fraud defense + court-admissible."**

The session *did* carry the admin's email in `impersonatedBy`. It was read in
**exactly one place** — to draw the "you are impersonating" banner. It never
reached anything stored.

**Fixed:** the admin's email is now recorded on both trails. A nullable column
was added to `FieldChangeLog`; null keeps its existing meaning (the shopkeeper
did it), so every existing row stays correct and no backfill was needed.

The test suite includes the **control** that an ordinary edit is *not* marked as
a support action — labelling every normal edit as admin-made would be worse than
the original bug.

---

## ✅ What I checked and found sound

I want to be clear that the admin panel's security core is **genuinely strong** —
it has been through serious prior audits and it held up:

- **Every one of 84 routes** is behind the admin gate, or is correctly public
  (login, status, password reset).
- **A route with no policy fails closed** (500), rather than defaulting to open.
- **Step-up 2FA is enforced server-side**, re-read from the database, with a
  10-minute window that rejects both null and future timestamps. Founders do not
  bypass it.
- **The SQL console** refuses to run without a read-only database role,
  SELECT-only, keyword-blocked, statement-timeout, audit-logged.
- **The bootstrap endpoint** requires a deployment secret with a timing-safe
  comparison, and its information-leaking GET was already removed.
- **Roles are re-read from the DB** on every request, so a demoted admin loses
  access within 30 seconds rather than when their token expires.
- **Money conversion** is correct — the paise↔rupee extension is present, and
  every raw-SQL site that touches money divides by 100 and names its columns
  `_paise` so the unit is visible.
- **PII is masked** in the activity feed (`A•••• P••••`).

## 🟡 4. One drift risk I closed

`withAdmin('admin/bulk', …)` takes its policy key as a **hand-typed string**.
Nothing tied it to the file it lives in, so a copy-pasted route keeping the key
it was copied from would silently run under **another route's** permissions —
including its step-up requirement. A missing key fails closed; a *wrong* key
fails silently.

All 79 currently match. There is now a test that fails if one ever doesn't.

---

## What's next in Phase 7

Not yet covered: impersonation session lifecycle (expiry, revocation), the audit
chain's tamper-evidence, break-glass alerting, the webhook engine, revenue
recognition, and bulk-job execution. Those are the next pass.
