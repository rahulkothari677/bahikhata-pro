# 20 — Two things that could not be undone, and a database grant nobody knew was missing

Date: 2026-08-05
Repos: bahikhata-pro, bahikhata-admin
Trigger: "if there is an error showing then you should fix it also, and if a bank
statement when it's wrong then permanent then you should fix it… new users should
not face any kind of issues in their ledger in any way."

---

## The short version

| # | What | Status |
|---|------|--------|
| 27 | A wrongly imported bank statement could not be deleted — no API, no button | **FIXED** — API + UI, verified against production |
| 26 | Admin webhook delete returned a flat 500 | **DIAGNOSED — one step left, and it is yours** |
| — | Main-app CI had been red for 3 commits and I had not checked | **FIXED** |

The webhook bug turned out not to be a webhook bug. It is a missing database
privilege that breaks **13 admin routes and two unattended jobs**, including one
that touches revenue. That is the important finding in this report.

---

## 27 — A wrong bank statement was permanent

### What was wrong

Bank Reconciliation let you upload a CSV, and match or unmatch a row. That was
all. There was no delete, in the API or the screen.

So if you imported the wrong file — wrong bank, wrong month, wrong account, or
just the wrong file from your downloads folder — those rows stayed in
reconciliation forever. They showed as unmatched, the match rate was permanently
wrong, and the only way to get rid of them was to delete the whole account.

I found this by importing a test statement during the audit and then discovering
I could not remove it.

### In plain words

Imagine writing in pen in your bank book, on the wrong page, and there being no
way to tear the page out. Every time you open the book afterwards it tells you
about money that was never yours.

### What was done

`DELETE /api/bank-recon/statement/[id]`, plus a Remove button on each imported
statement in the Bank Reconciliation screen.

The care went into two places:

**Ownership.** Every query is scoped by your user id — the lookup and both
deletes. Prisma's `delete({ where: { id } })` matches on the id alone, so
without this one shop could delete another shop's import by guessing an id.

**Saying what does not happen.** A delete button next to bank figures reads as
"this will remove my money". So the confirmation names exactly what goes (this
import and its rows), what does not (your sales, purchases and payments), what
happens to rows that were matched to your entries (the link goes, the entry
stays), and that you can import the right file afterwards. The success message
repeats it.

It is a hard delete on purpose. A bank statement is *imported* data, not your
books — nothing in the schema references those rows, and the match pointers
point outward from the statement to your ledger, so removing the statement drops
the pointers and leaves the invoices and payments untouched. Your GST and
income-tax retention duties cover the ledger, not a CSV you uploaded by mistake.
Re-importing the correct file is the intended recovery, and the per-row hash
already makes that safe to repeat.

Owners only. CAs and read-only staff are refused by the API, and the button is
hidden from them — a button whose only possible outcome is a rejection is worse
than no button.

### How it was verified

Not by reading the code. Against the live deployment, with fresh data:

1. Recorded a fingerprint of the account — 50 transactions with their totals and
   paid amounts, and 22 party balances.
2. Imported a probe statement, confirmed it appeared.
3. Matched one of its rows to a **real invoice**, and confirmed the link was
   live. This is the dangerous case: a pointer now exists into the books.
4. Deleted the statement.
5. Confirmed: statement gone, invoice still there with the same total, same paid
   amount, not soft-deleted, and all 50 transactions and 22 balances
   byte-identical.
6. Deleting the same id again returns 404, not a 500.

One check in the first run was worthless and I redid it: the "ledger unchanged"
comparison read a field the API does not return, so it compared `undefined` to
`undefined` and would have said "unchanged" no matter what happened. The
replacement fingerprint was itself checked for sensitivity — a deliberately
altered copy does not match — before I trusted it.

7 more tests drive the real React component, because both ways the button could
break are silent: forgetting to render the confirm dialog (click, nothing
happens, no error) and nesting the delete inside the card's expand button
(the click toggles the card instead). Verified by breaking each.

---

## 26 — The webhook 500 was never a code bug

### The wrong turn, first

Deleting a webhook endpoint in the admin panel returned a flat 500. My first
theory was a missing `ON DELETE CASCADE`: the schema declares one, the app has
no migrations directory so the live constraint state cannot be read from the
repo, and the error carried no Prisma code, which rules out a *classified*
foreign-key violation. I deleted the child rows explicitly and pushed it.

It changed nothing. The same endpoint still returned 500.

The reason the theory was even possible is that the response said nothing. So
the next change was not another guess — it was making the error report where it
happened and what class of error it was.

The very next request answered it:

```
stage:  "delete-deliveries"
name:   "PrismaClientUnknownRequestError"
detail: PostgresError 42501 — permission denied for table "WebhookDelivery"
```

### The actual cause

**The database role the admin panel connects as can SELECT, INSERT and UPDATE,
but it cannot DELETE.**

That is not a bug someone introduced. The app's own `db.ts` recommends exactly
this kind of purpose-scoped role. What was never done is widening the grant to
the tables the panel legitimately deletes from — and nothing anywhere recorded
that it was needed.

### Why nothing caught it

Every one of these routes typechecks. Their unit tests pass, because unit tests
mock the database. The production build passes. And Postgres permission errors
have no Prisma error code, so every affected route fails in exactly the same
uninformative way. It is invisible until a human presses the button.

### It is not one button

13 admin routes call delete: admin users, API keys, bulk jobs, campaigns,
competitors, data exports, experiments, fraud rules, incidents, notification
templates, NPS config, and the two webhook ones.

Two more matter much more, because they run unattended and touch money:

- **RevenueSchedule** — `generateRevenueSchedule()` deletes a subscription's
  existing schedule and recomputes it from scratch. Denied, the function throws,
  so revenue recognition stops updating. This is the same area where this audit
  already found revenue being over-recognised.
- **ChurnPrediction** — the refresh job deletes each chunk's old rows and
  rewrites them. Denied, it dies mid-chunk.

I have not yet confirmed which of these tables are denied — only `WebhookDelivery`
is proven. That is what the new grants endpoint is for.

### What was built

| File | What it does |
|---|---|
| `src/lib/delete-grants.ts` | The 15 tables, and why `User` is deliberately not one of them |
| `scripts/grant-admin-delete.sql` | The GRANT, with run instructions |
| `GET /api/admin/database/grants` | Asks the **live** database, per table, whether the role can delete — and reports the role name |
| `tests/delete-routes-have-grants.test.ts` | Fails the build if a new delete route appears without a grant |

The grant is an explicit list of tables, not `GRANT DELETE ON ALL TABLES`.
All-tables would also hand the admin panel DELETE on `User`, `Transaction`,
`Payment` and every other shopkeeper table. A previous audit deliberately
replaced admin bulk user deletion with a soft delete; the missing grant is what
makes that decision enforceable at the database rather than merely intended in
code. So `User` stays ungranted, and that is now recorded as a choice rather
than left looking like an oversight.

### What is left, and why I cannot do it

**A role cannot grant itself privileges.** The GRANT has to be run by the
database owner. That is you. Instructions are at the top of the SQL file and
repeated in the summary below.

---

## The CI failure I should have caught

Main-app CI had been failing for three commits. Four `require()` calls in a test
I wrote violate the lint rule. I ran lint on the admin repo before pushing and
not on this one.

Both are green now. Worth noting that the blocking lint step earned itself here:
while `next lint` was silently exiting 1 under `continue-on-error`, this would
have sailed straight through unnoticed.

---

## The pattern, again

Every finding in this report is the same shape as most of the audit: **the
components are individually correct and the defect lives between them.**

- The bank import worked. The reconciler worked. Nothing connected them to a way
  out.
- The webhook route was correct — I proved it by running the real handler
  against a healthy mocked database and getting a clean 200. The database said
  no, and the code had no way to tell anyone.
- 2,800 tests pass, and passed throughout.

A green check is a claim. Only using the product, against the real deployment,
with data created for the purpose, produces evidence.

---

## Addendum — what the GRANT revealed

You ran the script. Verified against the live database: `ok: true`, all 15
tables `can_delete: true`, `User` still correctly excluded.

**The webhook delete now returns 200.** The endpoint that had failed all session
is gone, and a second attempt correctly 404s instead of 500ing.

**And the fix uncovered a second, independent bug that the first one had been
hiding.** Revenue recompute finally reached its INSERT — and failed:

```
22P03  incorrect binary data format in bind parameter 5
```

Bind parameter 5 is `amount`. The admin app's schema declared it `Float`. The
real column is `INTEGER`, converted by the main app's `paise_migration` on
2026-07-12. Both apps share one database, but the admin app keeps its own schema
copy and has no migrations directory, so it never tracked that change. Prisma
was serialising a float into an integer column, and Postgres refused it.

Comparing the entire migration against the admin schema found **seven** drifted
columns, not one:

- `RevenueSchedule.amount`
- `DailyStats.mrr`, `newMrr`, `churnedMrr`, `arr`, `totalGmv`, `aiCostInr`

The other 66 converted columns were already correct.

`DailyStats` is written by the daily-stats cron. So MRR, ARR and GMV could not
be saved either — the same error, on a job whose failures nobody was reading.

**Reads survived, which is why it lived so long.** The panel rendered fine. Only
writes failed.

### Two faults on one path

This is the part worth remembering. `computeRevenueSchedule` deletes before it
inserts. The permission error fired first, so the type error never got a chance
to. Fixing the outer fault did not produce success — it produced a *different*
failure.

That is a good outcome, not a setback. It is also why the honest-reporting fix
mattered: had the recompute still been claiming `success: true`, the second bug
would have gone straight back into hiding.

### Verified after deploy

```
success: true   subscriptionsProcessed: 1/1   failed: 0   entriesCreated: 1
```

The schedule row reads ₹0 / current / pro. That is **correct, not broken** — the
only active subscription is a comped Pro grant worth ₹0, confirmed from two
independent endpoints. The overview showing zeros is honest: `totalScheduled` is
a sum, not a count.

### A test I had to fix twice

Because ₹0 proves nothing about the paise conversion (0 × 100 = 0 either way), I
pinned the conversion in a test instead. The first version was worthless:
removing `Math.round` from `toPaise()` left every assertion passing, because all
six of my values happened to multiply cleanly — 249.92 × 100 is exactly 24992 in
binary floating point.

Only after searching for values that land *off* an integer (0.07 → 7.000000000000001,
0.29 → 28.999999999999996) did breaking it produce failures. Those are in the
test now, with a note explaining why they are there.

A test that survives the bug it was written for is not a test. I only knew
because I broke it on purpose.
