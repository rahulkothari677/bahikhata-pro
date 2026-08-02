# Report 3 — All easy + medium findings resolved

**Date:** 2026-08-02
**Commits:** `bahikhata-pro` `586db91` · `bahikhata-admin` `7989cc2` (both on `main`, deployed)
**Verification:** pro — tsc clean, **2409/2409 tests, 109 suites** · admin — tsc clean, **325/325 tests, 25 files**

Reports are sequential; 01 and 02 are unchanged.

---

## Fixed in this round

### M7 — 11 test suites couldn't even load without a database URL
`src/lib/db.ts` builds the Prisma client the moment the file is imported. Any suite that
imported it died before running a single test. Jest calls that **"failed to run"**, not
"failed" — so on any machine without `DATABASE_URL` you silently lost 11 suites of
protection while the build still looked normally red.

Fixed in `jest.setup.ts` with a valid URL pointing at a **nonexistent** local database — so
if a test ever genuinely tries to reach a network, it fails loudly instead of quietly
talking to something real. A real `DATABASE_URL` still wins.

**Proof:** the suite now runs 108/108 with the environment variable completely unset.

---

### H4 — GST split put the odd paisa on the wrong tax for negative amounts
When GST doesn't divide evenly (₹180.01 → ₹90.005 each), one side must take the extra
paisa. The rule is "CGST takes it". `Math.ceil` rounds toward positive infinity rather than
away from zero, so:

- `+18001` paise → CGST got it ✅ (as documented)
- `−18001` paise → **SGST** got it ❌

Not reachable today because taxable amounts are never negative. It goes live the moment a
credit note carries negative GST — and a CGST/SGST asymmetry that only shows up on returns
is close to untraceable once it's inside a filed GSTR-1. Now sign-aware.

---

### M4 — order discounts could be off by a paisa
When a discount is split across lines, rounding leaves a residual. The old code dumped the
whole residual on the **last** line, then clamped it to that line's value. When the clamp
bound, the leftover was **thrown away** and the discount no longer added up.

Consequence: the invoice header stops matching its own line items, and `reconciliation.ts`
starts reporting a drift with no visible cause.

**I reproduced this against the old code before fixing it.** Bill of 7 lines at ₹1 plus one
line at ₹0.001, discount ₹3.00 → old code returned **₹3.01**. The residual is now spread
across every line that has room.

> Worth noting: my first attempt at a test for this used `[1000, 1000, 0.01]`, which *looks*
> like it should trigger the bug — and doesn't. A test built on the obvious-looking case
> would have passed against broken code. The committed test uses the input that actually
> reproduces it.

---

### M3 — "Best sellers" disagreed between two screens
Dashboard subtracted returns; Analytics didn't. The same product could top the list on one
screen and not the other, and a product returned almost in full still looked like a strong
seller in Analytics. Analytics now nets credit notes, matching Dashboard.

---

### M6 — payments could be deleted but never restored
Transactions have had an undo since V6. Payments had none, so a mis-tapped delete could only
be undone by re-entering the payment — which stamps a new date and leaves the audit trail
reading *"deleted, unrelated payment created"* instead of *"deleted, restored"*. In a
dispute, that difference matters.

Added `POST /api/payments/[id]/restore` with the same permission, read-only-CA and
period-lock rules as delete. Double-tap safe. No stock step — a payment moves no inventory.

---

### L5 — announcements hid real outages
Falling back to an empty banner list is correct. But the empty `catch {}` swallowed the
error, so a genuine database outage looked exactly like "no announcements today" and nothing
reached Sentry. Still fails soft; now it reports.

---

### M5 (admin) — SQL console had two flaws
1. `LIMIT 1001` was glued onto the end of the query by string concatenation. That's a syntax
   error for any query already ending in `LIMIT`/`OFFSET` — so *"top 20 by amount"*, the most
   natural thing to type during an incident, failed with a raw Postgres parse error. Now
   wrapped in a subselect.
2. `pg_read_file` was blocked but **`pg_read_binary_file` was not** — different identifier,
   so the word-boundary match never fired. Replaced with a prefix guard covering the whole
   family (`pg_read*`, `pg_ls*`, `lo_import`, `dblink*`, …).

> **The blocklist is not what keeps this console safe.** The read-only Postgres role is —
> and the route already refuses to run without it in production. A longer blocklist should
> not be mistaken for a stronger control.

Also added the first-ever tests for this endpoint (8), including one asserting the new
prefix rule doesn't block ordinary columns like `page_views`.

---

## Deliberately NOT done, with reasons

**L1 — debug/repair endpoints ship in the production bundle.**
They're already double-gated: founder-only *and* `ALLOW_REPAIR_ENDPOINTS` must be set. The
fix would mean build-time route exclusion in `next.config.ts` — a change to how the app is
built, risking the deploy pipeline, to harden something already behind two locks. **Not a
good trade.** Accepted as a documented risk. Keep `ALLOW_REPAIR_ENDPOINTS` unset in
production and this stays closed.

**L4 — `roundMoney()` called on values that are already exact integers.**
Cosmetic. Now that storage is paise, many of the ~180 calls are no-ops. Touching 180 money
call sites for zero user-visible benefit is a bad risk/reward trade in a ledger. **Declining
deliberately**, not forgetting.

---

## Running tally

| ID | Severity | Status |
|---|---|---|
| C1 | Critical | Resolved — no live users |
| C2 | Critical | **Next** — own batch |
| C3 | Critical | Queued behind the GST filing audit |
| C4 | Critical | Fixed ✅ |
| C5 | Critical | Queued — full invoice-wise allocation (your decision) |
| H1–H4 | High | **All fixed** ✅ |
| M1–M7 | Medium | **All fixed** ✅ |
| L2, L3, L5 | Low | Fixed ✅ |
| L1, L4 | Low | Declined with reasons above |

**16 of 21 closed.** The 3 remaining are all Critical and each gets its own phase.

---

## What to check in the live app

1. **Sell more stock than you have**, with "Allow overselling" OFF in Settings → you should
   get a clear *"not enough stock"* message naming the product, **not** *"another sale just
   took the last N units"*.
2. **Add an expense against a supplier → edit it → change the supplier → save → reopen.**
   The new supplier should stick.
3. **Analytics → Best Sellers.** If you record a sale and then a credit note (return) for the
   same product, its ranking should drop. It should now agree with the Dashboard.
4. **Everything else should be unchanged.** For the security fixes (Razorpay timing, query
   scoping, GST negative-split), *no visible change* is the success condition.

Use fresh data you create yourself — the existing seed rows (products sitting at −39 stock)
are dummy data and shouldn't be used to judge whether anything is correct.
