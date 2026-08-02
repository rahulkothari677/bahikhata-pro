# Report 6 — GST filing audit (partial)

**Date:** 2026-08-02
**Scope covered:** `gst.ts`, `gst-states.ts`, `gstr1-builder.ts` (B2B/B2CL/B2CS/HSN/note
classification), period-boundary handling in `gstr-1` and `gstr-3b`, and the GSTR-3B value
assembly.
**Not yet covered:** `gstr-export.ts` (643), `e-invoice.ts` (436), `reconciliation.ts` (484),
and the CDNR / CDNUR / NIL / DOC builders.

---

## Fixed

### G2 — HSN summary added quantities across different units ✅

`gstr1-builder.ts` `buildHSN()` aggregated by `hsn|gstRate` and took the UQC from **whichever
item was seen first**, then summed every quantity into it.

A shop selling one HSN both loose and in packets filed a single Table 12 row reading
**"15 KGS" for 5 kg + 10 packets**. The unit was decided by row order.

It survived because the **value and tax columns stayed correct** — only the quantity became
meaningless. Nothing in the app or the return looked wrong, and nothing reconciles against
that column.

Fixed by keying on `(hsn, rate, uqc)`. Verified against the pre-fix code: it produced 1 row
where 2 are required. 5 tests, including one pinning that single-unit shops still get a
single aggregated row rather than fragmented output.

**If you have already filed a return where one HSN was sold in two units, that quantity was
wrong.** Values and tax were not.

---

## Corrected (see Report 5 for the full argument)

### C3 — was misdiagnosed; the proposed fix would have broken filing

Report 1 recommended deriving GST by subtraction so an MRP line ties back to the MRP exactly.
GSTR-1 files `txval` and the tax **separately**, and the portal validates one against the
other, so that change would have made stored tax disagree with `taxable × rate` on up to
**13.15%** of inclusive-priced lines.

Proven by exhaustive enumeration (`scripts/c3-inclusive-rounding-probe.js`): for ₹100 at 18%
the sum steps from 9999 to 10001 paise, never landing on 10000. **Current behaviour is
correct and was left unchanged.**

---

## Verified clean

| Area | Finding |
|---|---|
| **Inter-state derivation** (`gst.ts`) | Correct. The per-instance state cache was already removed — it could serve a stale shop state for up to 5 min after a change on serverless, producing the wrong CGST/SGST-vs-IGST split. Direct PK lookup now. |
| **B2CL / B2CS threshold** | No gap and no overlap at exactly ₹1,00,000. B2CL is `> threshold`, B2CS is `≤ threshold`, and intra-state short-circuits to B2CS at any value. Threshold is a single exported constant used by both. |
| **Credit-note classification** | `resolveNoteClassification()` correctly classifies a note by its **original** invoice rather than its own (possibly edited) values, falling back to its own when the original is outside the period. |
| **B2CS negative rows** | Credit notes net into B2CS as negative adjustments, which the portal accepts. Correct — they must not go to CDNUR. |
| **Period boundaries** | **IST-correct in both returns.** Both use `istMonthStartOffset()`. A UTC boundary would have put transactions dated 1st-of-month in IST early hours into the previous month's return — a classic and expensive filing bug. Not present. |
| **G1 — taxable parity** | The taxable value is computed in *paise* in `line-items.ts` and recomputed in *rupees* in `gstr1-builder.ts`, in different rounding orders. Tested across fractional quantities and all four slabs: **no divergence.** 23 assertions now pin it, because the property is only accidentally true. |

---

## Open — needs verification, NOT yet confirmed as a bug

### G3 — does GSTR-3B Table 3.1(a) net credit notes?

`gstr-3b/route.ts:190` computes

```ts
const outwardTaxableValue = roundMoney(rawOutwardTaxable - nilRatedValue - exemptValue)
const outwardCgst = roundMoney(outwardSalesAgg._sum.cgst || 0)
```

Credit notes are **not** subtracted from either the value or the tax columns. They are
returned separately as `creditNoteTaxableValue` / `creditNoteCgst` / etc.

`netTaxPayable` (line 225) **does** subtract `totalCreditNoteTax`, so **the tax figure is
correct.**

The open question is presentation. GSTR-3B Table 3.1 has **no separate credit-note row** —
outward supplies there are expected net of credit notes. If a user copies the 3.1(a) figures
straight into the portal, they would overstate outward supplies and output tax, even though
the app's own `netTaxPayable` is right.

**What must be checked before changing anything:**
1. Does the GSTR-3B screen display 3.1(a) already netted, or show the credit-note line
   separately for the user to net themselves?
2. Does `gstr-export` net them in the exported file?
3. Does `Gstr1Snapshot` / `GstReturn` store the gross or net figure?

**Do not "fix" this by subtracting in `computeGstr3bValues` without answering those.** If the
UI or export already nets, subtracting again would understate liability — which is the
dangerous direction. This is the same trap C3 set, and the reason that one is now closed as
not-a-defect.

Also noted while reading: the credit-note aggregate has no `isReverseCharge` filter, unlike
the sale and purchase aggregates around it. A credit note against an RCM purchase would net
into outward supplies. Likely rare; worth confirming.

---

## Still unaudited

| File | Lines | Why it matters |
|---|---|---|
| `gstr-export/route.ts` | 643 | Produces the file actually uploaded to the portal |
| `e-invoice.ts` | 436 | IRN payload; rejected payloads block invoicing |
| `reconciliation.ts` | 484 | The header-vs-item tolerance checks |
| CDNR / CDNUR / NIL / DOC builders | ~250 | Credit-note and document-series sections |

---

## Status

| ID | Severity | State |
|---|---|---|
| G1 | — | Verified clean, pinned by tests |
| G2 | High | **Fixed** ✅ |
| G3 | Unknown | **Open — verify before acting** |
| C3 | — | Closed as not-a-defect, with proof |
