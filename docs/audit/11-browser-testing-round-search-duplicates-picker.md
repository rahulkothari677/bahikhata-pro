# Report 11 — Browser-testing round: search, duplicate parties, party picker

**Date:** 2026-08-03
**Commits:** `933b1e2`, `00b5542`, `f68b3b0`
**Every item states FIXED, VERIFIED or MEASURED explicitly.**

---

## What browser testing found that code review had not

Two of the four defects in this report were invisible from the source. Both
were found by *using* the feature immediately after shipping it.

---

## S1 — Search only covered the loaded page — **FIXED, VERIFIED**

The Report 10 fix corrected the empty state: *"No match in the 50 sales
loaded"*, then 100 after pressing **Load more**. It read correctly. The invoice
being searched for was three months old and still had not arrived.

**Fixing the message had made the limitation legible without removing it.**

Search now runs on the server — `GET /api/transactions?search=` across invoice
number, notes, party name and party phone. The clause is pushed into
`where.AND` so it sits *inside* the `userId` scope (a top-level `OR` beside
`userId` would have exposed other shops' rows) and composes with the keyset
cursor, so paging a filtered set stays correct.

Client debounces 350ms and includes the term in the query key — without the
key, paging would continue from a cursor belonging to the previous result set.

**Verified live:** the invoice unfindable through 100 rows now returns
instantly, by full number, by suffix alone (`0428-009`), and by party name.

---

## S2 — Search treated `%` and `_` as wildcards — **FIXED, VERIFIED**

Probing the new endpoint immediately after shipping:

```
GET /api/transactions?search=%   → the entire ledger
GET /api/transactions?search=_   → the entire ledger
```

Prisma's `contains` compiles to `LIKE '%' || $1 || '%'` and does **not** escape
the term, so Postgres' metacharacters stayed live. Not a security hole — the
clause is ANDed inside the `userId` scope throughout — but wrong results, and
`_` is common enough in references to hit by accident (`INV_001` also matched
`INV-001`).

`escapeLikeWildcards()` escapes backslash **first**, then `%` and `_`. Order
matters: escaping `%` first would double-escape the backslashes just introduced
and turn an escaped wildcard back into a live one. There is a test for exactly
that.

**Verified after deploy:** `%` → 0 results, `_` → 0 results, real searches
unaffected.

---

## P1 — "Add New" was the hardest thing on the screen to reach — **FIXED**

Reported from the New Sale and New Purchase screens. The button existed **only
at the bottom of the party dropdown's scroll area** — under up to 20 rows in a
`max-h-64` box. So registering a brand-new walk-in customer, the one moment you
certainly do not have them on file, required scrolling past everyone you do.

Now beside the **Customer / Supplier** heading, visible before the dropdown is
opened, and the in-dropdown copy is **sticky at the top** so it stays put while
the list scrolls. Same fix in `PartySelect` and `TransactionEntry`.

**Also surfaced while there:** the list silently slices to 20 matches with no
indication, so a shopkeeper could conclude a customer did not exist. It now
says *"Showing 20 of N — keep typing to narrow it down."*

---

## #14 — Duplicate parties — **FIXED (hard block)**

Two distinct parties both named **"RAHUL KOTHARI"** (₹492.50 and ₹50) in the
live party report.

### What established ledger software does

Rahul asked for the convention rather than an opinion. It is a **hard block**:

| App | Rule |
|---|---|
| Tally | Ledger names unique; duplicate is an error |
| QuickBooks | Display name unique across customers/vendors/employees |
| Zoho Books | Display name must be unique |
| Xero | Contact name must be unique |
| Vyapar | Party name unique per business |

None settle for a warning. Rahul's instinct matched the convention exactly.

### Why it matters more than it looks

Every report groups by `partyId`, so two ledgers for one person means the
outstanding shown is only **part** of what is owed, a payment settles bills on
one ledger while the other keeps chasing, and the picker shows two identical
rows. **It never surfaces as an error — it surfaces as a customer being asked
for money they already paid.**

### The rule implemented

- **Name** — blocked on exact match, case- and spacing-insensitive
- **Phone** — blocked on exact match, digits only, last 10, so `+91 98765 43210`
  and `9876543210` are one number
- Returns **409** with the conflicting party attached and a message naming it
  and both ways forward
- Two genuine same-name customers remain recordable by distinguishing them —
  the same escape hatch every app above relies on

### Two deliberate design decisions

**Application-level, not a DB constraint.** Duplicates already exist in live
data, so `@@unique([userId, name])` would fail to apply. Existing pairs are left
alone; only new names and renames are checked.

**Renames are blocked too.** Otherwise the create-block is a back door: add
"Ramesh K", rename to "Ramesh Kumar", and you have the split ledger the block
exists to prevent. `excludeId` lets a party keep its own name.

**Offline replay was already safe:** the queue treats 409 as *rejected* and
surfaces it separately rather than counting it as synced — infrastructure that
already anticipated this case.

---

## #15 — Trigram indexes — **MEASURED, then added**

The task said measure before choosing. Measured on the live app:

| Query | Median |
|---|---|
| No search (baseline) | 440ms |
| Search by invoice | **300ms** |
| Search by party name | **327ms** |
| No-match | 283ms |

Search is **not slower than the baseline**. At ~200 transactions the time is
network and Neon cold-start, not the query. This migration is therefore **not
fixing an observed slowdown.**

It was added anyway, and the reason is timing rather than symptoms: **index
creation cost scales with table size.** Instant on today's tables; a
`CREATE INDEX CONCURRENTLY`-and-watch-it operation at a few hundred thousand
invoices. Search gets slower exactly as a business succeeds.

The GIN write cost is stated in the migration rather than presented as a pure
win.

---

## Verification

- `tsc` clean, `eslint` clean
- **2626 tests across 129 suites**
- Production build clean
- S1, S2 verified live against real data

---

## Process note

While verifying the duplicate block I ran the probe **before confirming the
deploy had landed**, so four test parties were created in live data instead of
being rejected. All four were deleted immediately and verified gone; the two
pre-existing "RAHUL KOTHARI" records are original data and were untouched.

The lesson is the same one this session keeps teaching: confirm the thing you
are testing is actually running before drawing conclusions from it.

---

## Remaining

| # | Item | State |
|---|---|---|
| 3 | Transaction lifecycle & atomicity | not started |
| 5 | Auth, multi-tenancy & authorization | not started |
| 6 | Offline sync, backup/restore, billing | not started |
| 7 | Admin panel audit (~15k LOC) | not started |

**Offline sync remains the largest unexamined risk.** It replays mutations, so
a duplicate or misordered replay lands on exactly the money paths this audit has
been correcting.
