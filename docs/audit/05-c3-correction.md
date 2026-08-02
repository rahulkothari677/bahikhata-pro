# Report 5 — C3 was misdiagnosed. Correcting it.

**Date:** 2026-08-02
**Supersedes:** the C3 finding in `01-pass-1-findings.md` §1 (C3) and its restatement in
`02-pass-1-fixes-applied.md` Part B.
**Status of the code:** unchanged — and that is the conclusion, not an omission.

Earlier reports are left untouched, per the "new report each time" rule. This one records
that C3 as originally written was **wrong**, and why.

---

## What Report 1 claimed

> **C3. GST-inclusive (MRP) pricing does not add back up to the MRP.**
> A ₹100 MRP item at 18% bills as ₹100.01… **Fix:** derive GST by subtraction so the
> identity `taxable + gst == gross` holds exactly.

The observation was right. **The proposed fix was wrong**, and would have caused a worse
problem than the one it solved.

---

## What the filing code actually requires

`src/lib/gstr1-builder.ts:244`

```ts
/** Compute taxable value for an item: qty × unitPrice − discountAmount. */
function itemTaxable(item: Gstr1Item): number {
  return roundMoney(item.quantity * item.unitPrice - (item.discountAmount || 0))
}
```

GSTR-1 reports, per line: `rt` (rate), `txval` (taxable), and `camt`/`samt`/`iamt` (the tax).
The portal validates the tax against `txval × rt`. The same shape is used by
`gstr-3b/route.ts:72,95` and `gstr-export/route.ts:171,293`.

So the binding constraint is:

> **(A) Portal rule:** `tax === round(taxable × rate / 100)`

and the thing Report 1 wanted was:

> **(B) Customer rule:** `taxable + tax === MRP × qty`

---

## The two rules are not always simultaneously satisfiable

Money is stored as integer paise. For a ₹100 MRP line at 18%, every candidate taxable value
was enumerated:

```
taxable 8473 + tax 1525 = 9998
taxable 8474 + tax 1525 = 9999
taxable 8475 + tax 1526 = 10001     ← steps straight over 10000
taxable 8476 + tax 1526 = 10002
```

**There is no integer taxable value that yields exactly 10000 paise.** The sum skips ₹100.00
entirely.

A sweep of every inclusive line total from ₹0.01 to ₹2,000 across the four common GST slabs
(5/12/18/28%) — 800,000 cases — found:

| | |
|---|---|
| Cases checked | 800,000 |
| Cases where both rules **cannot** hold | **105,212** |
| Share | **13.15%** |

This is a property of the arithmetic, not a defect in this codebase. Any billing system that
prices at MRP and files GSTR-1 faces it.

*(Reproducible: `scripts/c3-inclusive-rounding-probe.js`.)*

---

## Therefore

**The current implementation is correct and must not be changed.**

`computeLineItems()` computes `gst = round(taxable × rate)`, and `gstr1-builder` recomputes
`taxable = qty × unitPrice − discount` from the stored columns. The two agree, so
**rule (A) holds and GSTR-1 passes portal validation.**

Had the Report 1 fix been applied — deriving GST by subtraction so the line ties to the MRP —
the stored tax would no longer equal `taxable × rate`, and **GSTR-1 would have started
failing portal validation on up to 13% of inclusive-priced lines.** That trades a ₹0.01
cosmetic difference on a bill for returns that cannot be filed. Strictly worse.

This is the reason C3 was held back from the first fix batch pending this audit. Patching it
in isolation would have broken filing.

---

## What can legitimately be done about the ₹0.01

The residual cannot be removed, only **placed** — either on the invoice total, or absorbed
into a round-off line. Options, in preference order:

1. **Enable invoice round-off** (`Setting.roundOffEnabled`, already built). The grand total
   rounds to the nearest rupee and the difference is shown as an explicit "Round off" line.
   This is standard on Indian retail invoices, is GST-neutral, and makes the residual visible
   rather than mysterious. **Recommended default for MRP-based shops.**
2. **Surface the residual as a round-off line even when whole-rupee rounding is off**, so the
   printed total equals MRP × qty exactly and the ±0.01 is an explicit, labelled line rather
   than an unexplained discrepancy. Small change, contained in the invoice renderer; does not
   touch stored tax and so does not affect filing.
3. **Do nothing.** A ₹0.01 difference on an MRP line is within normal tolerance and every
   competing product has it too.

**None of these changes stored tax values, so none affects GSTR-1.** That is the property
that makes them safe and the original proposal unsafe.

---

## G1 — checked, and it is clean

While reading the above I noticed the taxable value is computed in two different units, in
two different files, in two different rounding orders:

- `computeLineItems` works in **paise** — `multiplyPaise(qty, unitPricePaise)`
- `gstr1-builder.itemTaxable` recomputes in **rupees** —
  `roundMoney(quantity * unitPrice - discountAmount)`

For whole quantities they trivially agree. For **fractional** quantities (0.5 kg, 2.75 ltr,
0.333 kg — ordinary in a kirana shop) the differing rounding order could plausibly diverge by
a paisa, which would put the filed `txval` out of step with the stored tax and cause a
portal rejection.

**Tested rather than assumed. It does not diverge.**
`src/__tests__/lib/audit-g1-gstr1-taxable-parity.test.ts` — 23 assertions across fractional
quantities, all four GST slabs, and a multi-line bill with a distributed order discount.
Both invariants hold in every case:

1. the `txval` GSTR-1 files equals the taxable `computeLineItems` actually taxed, and
2. the stored tax equals `round(txval × rate)` — the rule the portal enforces.

The tests are kept because the property is non-obvious and is only accidentally true: nothing
in either file forces the two rounding orders to agree, so a future edit to either side could
break it silently. Now it cannot.

---

## Status change

| ID | Was | Now |
|---|---|---|
| C3 | Critical — open, blocked on GST audit | **Closed as "not a defect"** — current behaviour is correct; the proposed fix was unsafe |
| G1 | — | **Checked, clean** — no divergence; pinned by 23 tests |
