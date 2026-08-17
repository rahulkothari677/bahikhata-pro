# DEFECT LOG — found during the entry-model programme

Bugs and gaps found while researching the entry model. **None of these are being fixed as
part of that programme** — they are recorded here so they can be scheduled separately.

Each entry states what was *measured*, not what was suspected. If an entry says "confirmed
live", it was reproduced against the running app, not inferred from code.

Status: `OPEN` · `FIXED` · `WONTFIX` (with reason)

---

## D-01 · Product picker hides matching products with no indication
**Status:** OPEN **Severity:** High **Found:** Phase 1, confirmed live at 721 products

`src/components/common/ProductPicker.tsx` renders `filtered.slice(0, 30)`. There is no
"showing 30 of 52" line, no "keep typing to narrow", nothing. The empty-state message only
appears when the match count is exactly zero.

**Measured:** searching `tata` matched **52** products, displayed **30**, hid **22**
silently.

**Why it matters:** the shopkeeper concludes the product is not in the app and types it in
again by hand — which creates D-02, splitting the stock of a product they already had.
This is the same class as the backup that kept 200 of 307 invoices: silent truncation that
looks like a complete answer.

**Suggested fix:** show the count and the remainder whenever the list is cut. Better, move
the search server-side (see D-06) and return a total alongside the page.

---

## D-02 · Duplicate products are permitted, splitting stock silently
**Status:** OPEN **Severity:** High **Found:** Phase 1, confirmed live

Nothing prevents two products with the same name. Confirmed in the founder's own shop:

```
Tata Tea Gold 500g   49 units   ₹285
Tata Tea Gold 500g   20 units   ₹255
```

**Why it matters:** stock reports, valuation and profit are all wrong, and the same product
sells at two different prices depending on which row was tapped. Nobody is warned. Parties
already have a duplicate-name warning (added earlier this session); products have none.

**Suggested fix:** the same warning-on-create treatment parties received, plus a merge tool
for rows that already exist. A uniqueness constraint alone would fail on existing data.

---

## D-03 · Multi-shop is scaffolding — two shops share one catalog and ledger
**Status:** OPEN **Severity:** High **Found:** Phase 1 review, confirmed live

`shopId` exists on `Product`, `Party` and `Transaction`. A shop can be created through
`POST /api/shops` (returns 200). But the data is never scoped to it:

| Route | `shopId` mentions |
|---|---|
| `/api/products` | 0 — never written on create, never filtered on list |
| `/api/transactions` | 0 |
| `/api/payments` | 0 |
| `/api/parties` | 1 (partial) |

The UI shows "Manage Shops — **Soon**", so the feature reads as unreleased. But the Shop
rows are real and creatable through the API.

**Why it matters:** a merchant who opens a second branch and creates a second shop gets one
merged catalog and one merged ledger, with no warning. Their two shops' stock is added
together. The schema makes it look finished.

**Suggested fix:** either scope the data properly, or make shop creation impossible until it
is scoped. The current half-state is the dangerous one.

---

## D-04 · Compensation cess is unsupported end to end
**Status:** OPEN **Severity:** High (compliance) **Found:** Phase 1

There is no cess **rate** field anywhere. `TransactionItem` stores `csamt` (an amount) with
nothing to divide it by, and nothing in the app ever writes a non-zero value. The code says
so itself, in `src/lib/e-invoice.ts`:

> `CesRt` is 0 because this app has no cess RATE field … nothing in the app writes a
> non-zero `csamt`

**Why it matters:** cess applies to tobacco, pan masala, gutkha, aerated drinks and coal —
ordinary lines for a kirana or paan shop. Those shops cannot produce a correct invoice, and
their GSTR-1 understates liability. This is a segment the app cannot legally serve, not a
convenience gap.

---

## D-05 · Unit list is too small, and UQC mapping is not applied at entry
**Status:** OPEN **Severity:** Medium (compliance) **Found:** Phase 1

The app offers **10** units: `pcs kg gm ltr ml m cm box dozen packet`.

- GST requires one of **38 UQC codes** on GSTR-1 B2B lines, e-invoices and export invoices.
- Mapping happens only inside `src/lib/e-invoice.ts`, defaulting anything unrecognised to
  `NOS`.
- Every trade-critical unit is missing: **strip** (chemist), **than** and metre (cloth),
  **sq ft** / running foot / bundle (hardware), **quintal** (grain), bottle, pair, set.

**Why it matters:** a chemist cannot record a strip of tablets; a cloth merchant cannot
record a than. They will not use the app. Separately, a wrong UQC on a B2B line is a filing
error.

---

## D-06 · The whole catalog is downloaded to the phone on every sale
**Status:** OPEN **Severity:** Medium (performance) **Found:** Phase 1, measured

`/api/products` returns up to 5,000 rows; the picker filters them in the browser.

**Measured at 721 products:** 370 KB, 475 ms on a desktop connection. A shop phone on
patchy 4G is worse. This repeats for every bill.

**Why it matters:** industry guidance is blunt that software comfortable at 500 items
degrades past 2,000. At 2,000 products this is roughly a megabyte before the first item can
be typed.

**Suggested fix:** server-side search with a small page, which also fixes D-01.

---

## D-07 · `category` is free text, producing junk categories
**Status:** OPEN **Severity:** Medium **Found:** Phase 1, confirmed live

20 products had produced **16** categories, including `"5"`, `"GSTTEST"` and
`"Uncategorized"`. Every distinct value becomes a filter chip in the picker, so at scale the
filter row is longer than the list it is meant to shorten (20 chips at 721 products).

**Suggested fix:** a chosen list per trade, editable, rather than an open text field.

---

## D-08 · Pack size lives inside the product name, so sizes sort as text
**Status:** OPEN **Severity:** Medium **Found:** Phase 1, confirmed live

```
Tata Tea Gold 1000g
Tata Tea Gold 100g
Tata Tea Gold 250g
Tata Tea Gold 500g
Tata Tea Gold 50g
```

1000 before 100 before 250 before 500 before 50. There is no arrangement of that list a
person can learn, because it is not in any order that means anything.

**Note:** this is the defect the Shelf Model redesign addresses directly. Recorded here in
case the redesign is deferred.

---

## D-09 · `box` / `packet` / `bag` have no pack factor, so case-buying under-counts stock
**Status:** OPEN **Severity:** Medium **Found:** Phase 1

`src/lib/units.ts` converts gm↔kg, ml↔ltr, cm↔m and dozen→pcs correctly. But `box`,
`packet` and `bag` deliberately convert to nothing, because a box is not a fixed number of
pieces — the factor is per-product and no per-product factor exists.

**Effect:** buying 1 box of 24 raises stock by **1**, not 24. Under-counted, not negative.

> Correction: an earlier report of mine claimed this produced negative stock (`1 − 24 =
> −23`). That was wrong. Recorded so the error is not repeated.

---

## D-10 · First run asks for a colour theme before anything useful, and never asks the trade
**Status:** OPEN **Severity:** Medium (UX) **Found:** Phase 2, fresh account

Observed in a brand-new account with zero products. The first decision the app puts in front
of a shopkeeper is a **theme picker** — Saffron, Emerald, Ocean Blue, Royal Violet, Rose
Pink, Teal Cyan, then Light/Dark, then "Confirm Theme".

The app **never asks what the shop sells**. Checked directly: no trade, business-type or
purpose question appears anywhere in first run.

**Why it matters:** the trade answer is the single most useful thing the app could learn in
the first ten seconds — it determines the units, the categories, the tax fields and which of
the 16 product fields are even relevant. Instead the first question is cosmetic, and the
most valuable one is never asked.

---

## D-11 · "Scan a bill with AI — we'll auto-fill everything" never touches the catalog
**Status:** OPEN **Severity:** Medium (misleading) **Found:** Phase 2

The first-run screen offers: *"Or: Scan a bill with AI — Snap a photo, we'll auto-fill
everything."* `POST /api/scan-bill` returns line items as tuples for filling a
**transaction**:

```
{"items":[["Rice",2,"kg",50,0,100,0.9]]}
```

It never calls `db.product.create`. The scanned lines do not become products.

**Why it matters:** on a first run with an empty catalog, this is the one control that looks
like it solves the real problem — getting a shop's goods into the app. It does not, and the
copy says "everything".

---

## D-12 · There is no bulk product import anywhere in the app
**Status:** OPEN **Severity:** High (adoption) **Found:** Phase 2

`product.createMany` does not appear anywhere in the codebase. The only bulk inserts are for
bank reconciliation and payments. There is no Excel import, no CSV, no bill-to-catalog, no
starter catalog.

**Effect:** every product must be entered by hand through a 16-field form, one at a time. A
shop with 2,000 products faces roughly **17 hours** of continuous data entry at 30 seconds
each — before the first bill can be raised.

**Why it matters:** this is the arithmetic behind "the shopkeeper prefers pen and paper". It
is not a preference; it is the only rational choice given the alternative. Every other
improvement in this programme is downstream of fixing it.

---

## D-13 · Anything MADE from other stock cannot be sold correctly
**Status:** OPEN **Severity:** High (whole trades unusable) **Found:** Phase 2, restaurant account, confirmed live

There is no recipe, bill-of-materials or component model anywhere — confirmed against the
schema. A product can only consume *itself*. So a shop that makes what it sells has two
options, and both are wrong.

**Reproduced end to end in the restaurant account:**

| Step | Result |
|---|---|
| Sell 2 plates of a dish with `tracksInventory: true` | **400 — refused** |
| The message the cook is shown | *"Paneer Butter Masala: have 0, selling 2, would go to −2. Record a purchase first, or enable Allow overselling in Settings."* |
| Set the dish to `tracksInventory: false`, sell again | 200 — accepted |
| Raw stock afterwards | Paneer **10 → 10**, Onion **30 → 30**, Oil **15 → 15** |

**Path A** — leave stock tracking on: the sale is blocked, and the app instructs the cook to
*record a purchase of a cooked dish from a supplier*. Nobody buys Paneer Butter Masala
wholesale. The only shop-wide escape is disabling overselling protection, which is exactly
the guard the raw materials need.

**Path B** — mark every dish a service: billing works, and **nothing is ever consumed**. The
kitchen shows 10 kg of paneer forever. Consequences: stock reports permanently wrong,
reorder alerts never fire, food cost and per-dish margin cannot be computed at all, and
closing stock on the balance sheet is fiction.

**Why it matters — this is not only restaurants.** It is every shop that makes or assembles:
sweet shops, bakeries, a tailor consuming cloth, hardware assembling a fitting, a mobile
shop using spares. The app can take the money and file the GST, but cannot run the
business.

**Note on the near-miss:** the codebase already fixed the *service* case — `tracksInventory`
was added because a tailor selling "Blouse stitching" hit this same wall. Manufactured goods
are a third case that was never separated: they DO consume stock, just not their own.

**Suggested direction:** a component list per product (item → consumes N of another item),
applied on sale inside the same transaction that already maintains `currentStock`.

---

## D-14 · The unit field accepts any text, so UQC and reporting silently degrade
**Status:** OPEN **Severity:** Medium **Found:** Phase 2, confirmed live

The 10-unit list is a **UI dropdown only**. `POST /api/products` accepted `unit: "plate"`
without complaint and stored it.

**Why it matters:** two ways.

1. `mapUnitToNicUqc()` falls back to `NOS` for anything it does not recognise, so `plate`,
   `strip`, `than` and every typo are all reported to GSTN as `NOS`. The GSTR-1 HSN summary
   aggregates by UQC, so genuinely different units merge into one row under a unit that is
   not any of them.
2. It is the same free-text chaos as `category` (D-07) — `pcs`, `Pcs`, `piece`, `pieces` and
   `nos` become five different units that never aggregate.

Flexibility here is right — the fixed list is too small (D-05). But it needs to be a
*chosen* value from an extensible list mapped to a UQC, not an open text field.

---

## Cross-reference

The programme rulebook is `docs/entry-model/RULEBOOK.md`. Section 9 there carries a summary
of this file; this file is the detail.
