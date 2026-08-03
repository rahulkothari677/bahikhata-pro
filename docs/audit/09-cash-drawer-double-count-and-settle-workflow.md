# Report 9 — The cash drawer counted collected money twice

**Date:** 2026-08-03
**Commit:** `d65a37c`
**Reported by:** Rahul, from the live app
**Status of each finding is stated explicitly: FIXED, or LOGGED for later.**

---

## The report

> "in close counter in dashboard my amount in expected amount in drawer is
> showing 1000. while it should be just 600. because today i made a sale of 600
> but the constumer just paid 200 and then reamaining 400 i collected from
> udhaar."

INV-0043 — ₹600 sale, ₹200 paid at billing, ₹400 settled later.

---

## D1 — Expected cash counted the same ₹400 twice — **FIXED**

`GET /api/day-summary` summed `totalAmount` for sales:

```ts
_sum: { totalAmount: true }          // the INVOICE value
...
case 'cash': cashSales = cashSales + amount
```

`totalAmount` is what the invoice is worth. `paidAmount` is what actually
changed hands at billing. Summing the invoice total into the drawer treats
every sale as if it were paid in full on the spot — so anything collected
later was counted **twice**: once inside the invoice total, and again as the
Settle payment.

```
cashSales        = 600   (the whole invoice)
udhaarCollected  = 400   (the settlement)
expectedCash     = 1000  against ₹600 of real cash
```

### Why this one is worse than a display bug

The shopkeeper counts the **physical till** against this number. A ₹400
phantom surplus does not read as "the app is wrong" — it reads as **₹400
missing from the drawer**. That is how someone gets wrongly accused of theft.

### The fix

The drawer now sums `paidAmount` for its cash lines and keeps `totalAmount`
for the revenue lines. They answer different questions and must not be
conflated:

| | Question it answers | Field |
|---|---|---|
| Revenue | What did I sell today? | `totalAmount`, all modes |
| Cash | What is in the drawer? | `paidAmount`, cash mode only |

```
cashInFromSales     = 200
udhaarCollectedCash = 400
expected            = 600
```

This is the **same defect class as the July double-count**: one sum of money
reaching a total by two different routes.

---

## D2 — Non-cash settlements also inflated the drawer — **FIXED**

Payments were grouped by `type` only, so every received payment was added to
expected cash regardless of how it arrived. The original comment called finer
granularity a *"future enhancement"* — but a customer settling ₹400 by UPI
never touches the cash drawer, so the count came up short by exactly that
amount every time.

Payments are now grouped by `['type', 'mode']`. Only cash reaches the drawer;
the totals across all modes still drive the display, with a line stating how
much of the collection was cash.

The same reasoning was applied to income, expenses and note refunds, which were
all summed across every payment mode into a **cash** figure.

---

## D3 — The figure could not be checked — **FIXED**

The total appeared alone above a formula written in prose. When it read ₹1,000
against ₹600 of real cash there was no way to see where the extra came from.

It is now itemised — every term that moved cash, listed, adding to the total on
screen. A drawer number that cannot be verified is worse than none, because it
carries the same authority whether it is right or wrong.

---

## D4 — Settle was not reachable from a bill — **FIXED**

Collecting against a bill meant leaving it, finding the party, and picking the
bill out of a list — while the customer stands at the counter holding the
money. The bill is where the shopkeeper already is when they get paid.

A **Settle** button now appears on the bill, only when it still owes something
and only for sale/purchase (a credit note is a refund, not something you
settle). It opens the Settle page pointed at that invoice with the due
pre-filled — still editable, because a part-payment is the ordinary case.

Back / Cancel / save now return to wherever Settle was opened from, instead of
always landing on the party profile.

---

## D5 — The bill showed a lump sum, not the payments — **FIXED**

The bill showed one `Settled later ₹400` line. A customer who pays ₹200 twice
and one who pays ₹400 once produced an identical row, so the shopkeeper could
not answer *"when did he pay, and how much?"* without leaving the bill — which
is exactly the question a customer asks while standing there.

Each settlement now appears with its **date and mode**. The API was already
returning every allocation with those fields; only the display was summing them
away.

---

## D6 — Two cache gaps, found while wiring the above — **FIXED**

1. `invalidateMoneyCaches` invalidated `['transactions']`, but the bill screen
   reads `['transaction', id]` — a **different key**, which prefix matching
   never reached. Settling a bill and returning to it showed the pre-payment
   figures until the staleTime lapsed, which is precisely when the shopkeeper
   looks to confirm the money landed.

2. **Nothing** invalidated `['day-summary']`. Every sale, payment and expense
   changes expected cash, so the one screen used to count money against could
   be showing figures from before the last few entries.

---

## D7 — "Collected Today" read as all collections — **FIXED (label only)**

The KPI counts udhaar settlements only; money paid at billing is not in it. On
the ₹600 sale it showed ₹400 and looked like a shortfall. The figure was
correct for what it measures, so only the label changed: **"Udhaar Collected
Today"**. Changing what a KPI measures is riskier than the ambiguity was.

---

## The accrual boundary — audited, **SOUND**

Rahul asked whether the settle workflow is correct "according to ledger …
including GST and all other places". The rule the ledger rests on:

> A **sale** books revenue and GST liability when it is invoiced.
> A **payment** moves cash and reduces the party's balance. It is not revenue,
> and it never changes tax.

Verified:

- **GST** — `gstr1-builder.ts`, `e-invoice.ts` and `gstr-export/route.ts` never
  read the Payment table or allocations. Returns are built from invoices.
  Correct: GST is filed on invoices, not on collections.
- **Dashboard** — payments are aggregated separately, with the reason stated in
  the source: *"These are NOT revenue (revenue was already booked when the sale
  was created)."*
- **Drawer** — was the one breach. Now fixed.

Both invariants are now covered by
`src/__tests__/lib/audit-accrual-boundary.test.ts`, including an assertion that
the GST source list is non-empty (so the loop cannot pass vacuously).

---

## Verification

- `tsc` clean, `eslint` clean
- **2562 tests across 125 suites**, including 12 new drawer tests and 11 new
  accrual-boundary tests
- Production build clean
- The drawer tests encode Rahul's exact case (₹600 / ₹200 / ₹400 → ₹600) and
  include a test asserting the **old** formula produced ₹1,000, so the suite
  demonstrably fails if the bug returns

---

## Still open — logged, not fixed

| # | Item |
|---|---|
| 9 | Onboarding tour fires for established accounts (20 parties, 42 transactions) |
| 10 | Theme picker re-appears for existing users |
| 11 | Audit remaining payment surfaces against the accrual boundary — statement/PDF, P&L and cash-flow reports, insights, WhatsApp reminder, bank reconciliation |

Areas still never examined: offline sync / queue replay, bank reconciliation
matching, staff permission behaviour, and ~15k LOC of admin business logic.
