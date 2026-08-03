# Report 10 — Backlog cleared: tasks 9, 10, 11, 12, 13

**Date:** 2026-08-03
**Commits:** `fa9af59` (fixes 9/10/12/13), `a73c70f` (audit 11)
**Every item states FIXED or AUDITED-SOUND explicitly.**

---

## The pattern behind three of them

A **per-browser** or **invoice-only** fact standing in for an **account-wide**
one. Same shape as the cash-drawer double-count in Report 9.

---

## #10 — Theme picker reappeared on every load — **FIXED**

```ts
const [themePickerDone, setThemePickerDone] = useState(false)   // never persisted
const showThemePicker = !themePickerDone && !!session
```

Plain component state, so it reset on every mount and the picker fired **every
single load**. The onboarding flag immediately above it had been given a
localStorage initialiser for exactly this reason; this one never was.

Persisted, and the answer is saved when given. The chosen *theme* was already
saved — only the record of having been asked was lost.

---

## #9 — Tour greeted an established shop — **FIXED**

Gated only on `localStorage['bahikhata-tour-seen']`. That answers *"has this
BROWSER seen the tour"*. The question that matters is *"has this ACCOUNT
started"*, which only the data can answer.

Reproduced on an account with **20 parties and 42 transactions**: a new browser
showed "Record Your First Sale".

Both the tour and the theme picker are now gated on `hasNoData`, threaded
`page.tsx → AppShell → OnboardingTour`. A second device or a cleared cache no
longer restarts first-run setup on a live ledger.

---

## #13 — "No sales yet" to a shop with 50+ sales — **FIXED**

Search filters only the loaded page (50, keyset-paginated). Searching an
invoice behind "Load more" produced the **empty-ledger** state: *"No sales yet
— Record your first sale to start tracking revenue."*

For a ledger, that reads as data loss.

`filtered.length === 0 && transactions.length > 0` now renders a distinct
state — **"No match in the N loaded"** — offering the two things that help:
clear the search, or load more.

---

## #12 — Party report ignored money collected — **FIXED**

`periodActivity` is documented as *"net change in the selected period"* but was
built from invoices alone, `Σ(totalAmount − paidAmount)`; the branch never
queried the Payment table.

A customer invoiced ₹600 who settled ₹400 in the same window showed **₹600** —
the full credit extended, as though nothing came back. The `balance` beside it
was always right (it comes from `getReceivablePayable`), so **two figures on the
same row disagreed.**

Payments are now aggregated over the same window and applied with the balance
convention — received reduces, paid increases — and folded into
`totalReceived`/`totalPaid`, which had counted only money taken at billing.

**Two follow-on gaps found while fixing it**, both closed: a party whose only
period activity was settling an older bill has no row in `periodPartyAgg`, so it
was neither fetched nor kept by the final filter. Clearing an account inside the
period made that party vanish from the report meant to show what happened in it.

---

## #11 — Remaining payment surfaces — **AUDITED, SOUND**

| Surface | Basis | Verdict |
|---|---|---|
| P&L | ACCRUAL — `totalAmount`, never reads Payment | correct |
| Cash-flow | CASH — `paidAmount` + payments as separate rows | correct |
| Party report | mixed | fixed as #12 |
| Bank reconciliation | actual money movements; cash excluded by design | correct |
| Statement, invoice PDF, WhatsApp reminder, insights | due via the shared helper | correct |

Cash-flow was already using the exact pattern the drawer had to be fixed to.

Each basis is now pinned by a test, because a report that silently changes
basis misstates profit (P&L) or the money in hand (cash-flow).

---

## One guard was vacuous, and only breaking the code revealed it

The cash-flow test first asserted the branch merely *contained*
`_sum: { paidAmount: true`. It **passed while the sales query was deliberately
switched to `totalAmount`** — because the purchase query a few lines below still
matched.

Re-pinned to the consumption sites (`salesAgg.forEach` reading
`row._sum.paidAmount`) plus a negative assertion. Verified by breaking it again:
it now fails, as it should have the first time.

The same session also hit **CRLF**: an anchor containing `\n` matches nothing on
a Windows checkout, and the assertion then passes against an empty string. The
new guard file normalises line endings on read.

---

## Verification

- All four fixes verified by **re-introducing each regression and watching
  exactly its own guard fail** — 4 failures for 4 reverts
- `tsc` clean, `eslint` clean
- **2602 tests across 127 suites**
- Production build clean

---

## Remaining

| # | Item | State |
|---|---|---|
| 3 | Transaction lifecycle & atomicity | phase not started |
| 5 | Auth, multi-tenancy & authorization | phase not started |
| 6 | Offline sync, backup/restore, billing | phase not started |
| 7 | Admin panel audit (~15k LOC) | phase not started |

Never examined: offline queue replay and conflict handling, staff permission
behaviour (verified *called*, not verified *correct*), and the admin panel's
bulk jobs, break-glass, webhook engine, fraud rules and revenue recognition.
