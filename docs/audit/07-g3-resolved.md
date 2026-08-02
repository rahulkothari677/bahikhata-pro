# Report 7 — G3 resolved: GSTR-3B 3.1(a) was filed gross

**Date:** 2026-08-02
**Follows:** Report 6, which left G3 open pending verification.
**Outcome:** confirmed as a real hazard, fixed additively.

---

## What Report 6 said to check, and what the answers were

Report 6 deliberately refused to change anything until three questions were answered. Here
they are, answered by reading `src/components/reports/Gstr3bReport.tsx`:

| Question | Answer |
|---|---|
| Does the GSTR-3B **screen** show 3.1(a) already netted? | **No.** Line 285 rendered `outwardTaxableValue` / `outwardCgst` / … — the gross figures. |
| Does the **CSV export** net them? | **No.** Line 110 emitted a row literally labelled `3.1(a),Outward taxable supplies` using the same gross values. |
| Is a netted figure available anywhere? | **No.** Credit notes appeared in a separate card lower down, labelled "Credit Notes (reduce output tax)", with no combined row. |

So the hazard was real. A row labelled **3.1(a)** contained the **gross** figure, and the
obvious action — copy the row labelled 3.1(a) into the box labelled 3.1(a) — **overstated
outward supplies and output tax.** The shop would pay GST on sales that had been returned.

`netTaxPayable` was always correct; it subtracts credit-note tax. The defect was purely one
of presentation — which, for a number a human copies into a government portal, is the same
thing as being wrong.

---

## Why GSTR-3B differs from GSTR-1 here

GSTR-1 has dedicated credit-note tables (CDNR for registered, CDNUR for unregistered), so
notes are reported *separately* there. **GSTR-3B Table 3.1 has no credit-note row at all** —
outward supplies are expected already net of credit notes issued in the period.

Presenting the two returns with the same shape is what created the trap.

---

## The fix, and why it was done in the component

Both the screen and the CSV now carry **two** rows:

```
(a) Taxable supplies (gross)                        <- the working
(a) Taxable supplies — NET of credit notes ← file this
```

The gross row is kept deliberately: it is the working, and removing it would make the
credit-note card below unreadable.

**The netting is computed in the component, NOT in `computeGstr3bValues()`.** That is a
deliberate choice:

`netTaxPayable` already subtracts credit-note tax at the source. Had the source been changed
to net 3.1(a) as well, any consumer that also nets — the snapshot writer, the export, a
future integration — would subtract a second time and **understate** liability. Understating
is the dangerous direction: it is the one that attracts interest and penalty.

An additive display row cannot double-count. This is the same reasoning that led C3 to be
closed as not-a-defect rather than "fixed".

Only **credit** notes are subtracted. In this app a debit-note is issued to a *supplier* (a
purchase return) and reduces ITC — it is not an outward supply and must not move 3.1(a).

---

## Caveat the filer needs to know

In a month where returns exceed sales, the net figure **can be negative**. The GST portal
does **not** accept a negative value in Table 3.1(a); the excess is carried forward and
adjusted against a later month.

The negative is displayed rather than clamped to zero, because clamping would hide the
carry-forward the filer has to act on. This is recorded in the component so the next reader
does not "helpfully" clamp it.

---

## What this does not cover

The fix makes the correct number **available and labelled**. It does not:

- change any stored value (`GstReturn`, `Gstr1Snapshot` still hold what they held);
- alter `netTaxPayable`, which was already right;
- audit `gstr-export/route.ts`, which produces the portal upload file and may have the same
  gross-vs-net question in a different form. **Still unaudited — 643 lines.**

---

## Status

| ID | Severity | State |
|---|---|---|
| G3 | High (filing) | **Fixed** ✅ — additive, cannot double-count |
| G1 | — | Verified clean |
| G2 | High | Fixed |
| C3 | — | Closed as not-a-defect, with proof |

**Still open:** `gstr-export` (643), `e-invoice` (436), `reconciliation` (484), CDNR/CDNUR/
NIL/DOC builders, the consolidated-report scan, and **C5** (invoice-wise payment allocation).
