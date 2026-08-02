# Report 2 — Fixes applied for pass-1 blockers

**Date:** 2026-08-02
**Branch:** `fix/audit-pass-1-blockers` (repo: `bahikhata-pro`)
**Commit:** `a39843a`
**Verification:** `tsc --noEmit` clean · **2400 / 2400 tests pass** · 108 / 108 suites

> This is a *new* report. Report 1 (`AUDIT-REPORT-PASS-1.md`) is unchanged, per your
> instruction to keep every report in sequence rather than editing old ones.

---

## Part A — Fixed and verified (4 of 6 blockers)

### 1. H3 — Insights page crashed for any shop with a good month

**In plain words:** the Insights screen asked the database for "revenue per product,
last 30 days". It stored that answer in a box that can only hold numbers up to about
**₹21.5 lakh**. As soon as any *single product* sold more than that in a month, the
number didn't fit, the database threw an error, and the **entire Insights page returned
an error instead of loading.** A wholesaler would hit this in a normal month.

**What I changed:** used a bigger box (`::bigint` instead of `::int`). One word. The code
that reads the value already handled the bigger type, so nothing else had to change.

**How to verify in the live app:**
1. Open **Insights**. It should load normally (this is the baseline — it worked before too,
   as long as no product had crossed ₹21.5 lakh).
2. The real proof needs a big number. If you have a test shop, record a sale of one product
   for **₹25,00,000** dated within the last 30 days, then open Insights.
   - **Before this fix:** the page would error out completely.
   - **After this fix:** the page loads and shows that product as your bestseller.
3. Nothing else on the page should look different.

---

### 2. C4 — Admin "login as user" sessions lasted 30 days instead of 1 hour

**In plain words:** when you impersonate a shopkeeper from the admin panel, the intention
was that the session dies after 1 hour. The 1-hour limit was only written on the *cookie* —
and a cookie's expiry is just a note to the browser, not a rule the server enforces. The
actual signed session token was valid for **30 days**. So if that token value ever leaked
(a shared computer, a server log, a screen-share during support), someone could keep acting
as that shopkeeper for a month.

**What I changed:** the 1-hour limit is now applied to the **token itself**, not just the
cookie. Both now read from a single value in the code, so they can never disagree again.

**How to verify in the live app:**
1. From the admin panel, impersonate a test shopkeeper. You should land in their dashboard
   with the yellow "impersonating" banner — **exactly as before.** This fix must not change
   normal behaviour.
2. Confirm you can browse, and that "Exit" still works.
3. The 1-hour expiry itself is hard to observe without waiting an hour. The important thing
   to check is that **impersonation still works normally** — if it does, the fix is correct.

---

### 3. H1 — The payments speed limit was guarding the wrong door

**In plain words:** there is a rule that says "max 20 payment actions per minute". The
comment in the code said it was protecting payment *creation*. It was actually attached to
payment *reading*. So the behaviour was backwards:

- Looking at your customers' payment history could get **blocked** after 20 views a minute.
- **Recording** payments had no limit at all.

**What I changed:** moved the limit onto the create action, where it was always meant to be.
Reading is now unlimited — consistent with every other read screen in the app, none of which
are limited.

**How to verify in the live app:**
1. Open several customer profiles quickly, one after another, and scroll their payment
   history. **Before:** you could hit a "too many requests" error. **After:** it should just
   keep working smoothly.
2. Recording payments should feel completely normal. (The 20/min limit only bites if
   something is malfunctioning and firing payments in a loop — you will not hit it by hand.)

---

### 4. H2 — One shop could, in future, read another shop's invoice

**In plain words:** when the app saves a bill while your phone is offline, it attaches a
unique ID so that if the same bill gets sent twice, the server recognises it and doesn't
create a duplicate. The server looked that ID up **without checking which shop it belonged
to.** Today that's safe, because the app generates random IDs that never collide. But the
moment any future version of the app used something predictable (a timestamp, a counter, a
device ID), one shop's request could match another shop's bill — and the server would hand
back that bill, **including its line items and customer details.**

**What I changed:** all four places now check the record belongs to *you* before returning
it. If the ID somehow belongs to someone else, you get a "please retry" error instead of
someone else's data.

**How to verify in the live app:**
1. Turn on airplane mode, record a sale and a payment, turn airplane mode off, let them sync.
2. Confirm each appears **exactly once** — no duplicates. That is the behaviour this code
   protects, and it must still work.
3. Do the same for a bill created twice in quick succession (double-tap Save). Still one bill.

---

## Part B — Deliberately NOT fixed in this batch, and why

You asked me to be certain that nothing existing gets corrupted. Two of the six blockers
cannot be done safely in the same batch as the four above. I want to be explicit rather than
quietly bundling them in.

### C3 — GST-inclusive (MRP) pricing is off by a paisa

**Why I stopped:** the fix changes the **GST amount actually stored on every MRP-priced
line**. That number flows into GSTR-1, GSTR-3B and the invoice PDF. It also collides with
how the order-level discount is spread across lines — right now the discount is subtracted
from the *pre-tax* base, and for inclusive pricing it is genuinely ambiguous whether a
discount should come off the MRP or off the taxable value. That is a **tax-treatment
decision, not a coding decision**, and getting it wrong silently changes what you file.

**What it needs:** its own change, its own new tests (invoice total must equal MRP exactly,
per line and per slab), and its own deployment so you can verify GST reports before and
after in isolation. Mixing it into a batch with four unrelated fixes would make it impossible
to tell which change moved a number.

**One question I need you to answer before I do it:** when a customer gets a discount on an
MRP-priced item, should the discount come off the **MRP the customer pays**, or off the
**taxable value before GST is added**? (Most Indian retail does the former.)

### C2 — Dashboard loads every payment you have ever made

**Why I stopped:** this is in `party-balance.ts`, the single most sensitive file in the app —
it is the definition of "what a customer owes". It is also the file that was at the centre of
the 100× payment incident, and it currently contains an emergency workaround from that
incident. Changing it is correct, but it deserves a batch where it is the *only* change, with
the existing parity test as the guard, so that if any balance moves you know exactly why.

**Impact if left for now:** it is a **speed and memory** problem, not a correctness problem.
Balances are right; the dashboard just does far more work than it needs to. It gets worse as
shops accumulate payments. Not a launch blocker — but fix it before you have busy shops.

### C1 — Corrupted payment rows from the 100× incident

**Resolved by your answer.** With no live users, there is nothing worth preserving. Before
launch, clear the transactional tables so no row written during the bug window survives.

Run this against your database to see whether any suspect rows exist at all:

```sql
SELECT 'Payment' AS tbl, COUNT(*) AS suspect_rows
FROM "Payment"          WHERE "amount"  > 100000 AND "amount"  % 100 = 0
UNION ALL
SELECT 'Subscription',   COUNT(*) FROM "Subscription"   WHERE "amount" > 100000 AND "amount" % 100 = 0
UNION ALL
SELECT 'BankTransaction',COUNT(*) FROM "BankTransaction" WHERE "amount" > 100000 AND "amount" % 100 = 0;
```

If those counts are zero, you were never affected and nothing needs doing. If they are not,
the safest action with no live users is to clear test data rather than attempt a repair —
the repair heuristic cannot tell a corrupted ₹100 from a legitimate ₹10,000.

---

## Part C — What happens next

1. You give me push access + the live URLs (see my message).
2. I push this branch → Vercel builds a **preview deployment**, separate from production.
3. You verify the four items above on the preview URL.
4. On your OK, I merge to `main` → production.
5. Then C3 (after you answer the discount question) and C2, each as its own batch.
6. Then Phase 2 of the audit: **GST filing builders** — the highest-risk unaudited area.

---

## Running tally

| ID | Severity | Status |
|---|---|---|
| C1 | Critical | Resolved by "no live users" — verification SQL above |
| C2 | Critical | **Deferred** — own batch, perf not correctness |
| C3 | Critical | **Blocked on your discount decision** |
| C4 | Critical | **Fixed** ✅ |
| C5 | Critical | Open — product decision on payment allocation |
| H1 | High | **Fixed** ✅ |
| H2 | High | **Fixed** ✅ |
| H3 | High | **Fixed** ✅ |
| H4 | High | Open — latent, not reachable today |
| M1–M7 | Medium | Open |
| L1–L5 | Low | Open |
