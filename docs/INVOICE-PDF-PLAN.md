# The invoice PDF: research, and a plan in six phases

**Written 2026-08-05. Status: awaiting Rahul's go-ahead on scope and order.**

Rahul asked for an invoice system better than every app already out there, built
in phases after real research rather than guessed at. This is the research and
the plan. Nothing here is built yet.

---

## 1. What we have today

One PDF layout, in `src/lib/invoice-pdf.ts` (468 lines, jsPDF) with
`src/lib/pdf/theme.ts` and `primitives.ts` beneath it. It is not bad: brand band
with the logo, a Bill To card, an item table with HSN and zebra striping, a
totals block, amount in words, a UPI QR for the balance due, signature block and
footer. It renders on-device, so it works offline.

What it is not: **choosable**. Every shop in India using EkBook prints the exact
same document. There is no paper-size option, no theme, no per-shop
customisation, and — the important one — **no thermal receipt at all**.

E-invoicing is already handled (`src/lib/e-invoice.ts`, `/api/e-invoice/irn`),
so IRN and the signed QR exist as data. They are not yet placed on the printed
invoice in a way the plan below assumes.

---

## 2. What the competition actually ships

| | Themes | Paper | Thermal | Custom fields | Notes |
|---|---|---|---|---|---|
| **myBillBook** | 8 | A4, A5 | — | vehicle no, batch, e-way bill | Has an AI "custom theme" prompt editor |
| **Vyapar** | 12 regular + 2 thermal | A4, A5 | **2in / 3in / 4in** | yes | Text-size controls; Word/Excel/PDF export |
| **Zoho Books** | Preloaded set | A4/Letter | — | yes | Full **HTML/CSS** custom templates |
| **EkBook today** | 1 | A4 only | **none** | none | — |

Rahul is right that myBillBook is the stronger of the two Indian apps on
document design. But the finding that matters most is Vyapar's:

> **Thermal receipt printing is the real gap.** A kirana counter does not hand a
> customer an A4 sheet. It hands them a 2- or 3-inch slip off a thermal printer.
> An app that cannot print one is not usable at the counter, whatever its A4
> looks like. This is table stakes we do not have, and it outranks every theme.

---

## 3. The legal floor (this is not optional)

- **Rule 46, CGST Rules** — 16 mandatory fields on a tax invoice: supplier name,
  address and GSTIN; a serial number of at most 16 characters; date; recipient
  details; HSN/SAC; description, quantity, taxable value; rate and amount of tax
  per head; place of supply; whether tax is payable on reverse charge; signature.
- **HSN digits scale with turnover** — 2 digits (₹1.5–5 cr), 4 (₹5–10 cr),
  6 (above ₹10 cr). Printing too few is a defect, not a style choice.
- **E-invoicing** is mandatory above ₹5 crore AATO from 1 April 2026
  (Notification 17/2025-CT). Where it applies, the IRP's **signed QR code** must
  be printed on the invoice.
- Getting these wrong can deny the BUYER their input tax credit and carries a
  penalty up to ₹25,000 under s.122 — so a wrong invoice hurts our user's
  customer, which is how a shop loses customers.

---

## 4. Where we can be genuinely better

Themes are table stakes; matching twelve of them wins nothing. Four things would
actually put EkBook ahead:

1. **A compliance engine, not just a template.** Check the invoice against
   Rule 46 *before* it prints and say precisely what is missing — "no HSN on
   3 items, and your turnover band needs 4 digits", "place of supply missing on
   an inter-state invoice". No competitor does this; every one of them will
   happily print a defective invoice. This is the differentiator, and it fits
   the standing requirement that the data be regulator-defensible.
2. **Thermal + A4 from ONE definition.** Vyapar maintains two separate theme
   sets. If the receipt and the invoice are generated from the same document
   model, they cannot disagree about the total — which is the bug that matters.
3. **Bilingual invoices.** Hindi/Gujarati/Tamil alongside English. Most kirana
   customers do not read English invoices; every competitor is English-only.
   The Unicode font work is already done (`registerUnicodeFont`).
4. **A preview that cannot lie.** The same lesson as the business card: one
   renderer, so what is previewed is byte-for-byte what prints. Competitors
   preview in HTML and print via a different engine, and they drift.

---

## 5. The plan

Six phases. Each is independently shippable and leaves the app working.

### Phase 1 — The document model and template registry
Split "what is on the invoice" from "how it is drawn", exactly as
`card-templates.ts` did for the card. One `InvoiceDocument` built from the
transaction; templates are registry entries that draw it. Adding a theme becomes
one entry rather than a new 468-line file.
*Ships:* no visible change. This is the foundation the rest depends on.

### Phase 2 — Thermal receipt (58mm / 80mm)
The biggest gap, so it comes before prettier A4. Renders from the same
`InvoiceDocument`. Covers 2-inch and 3-inch rolls, with the compressed layout a
receipt needs (no columns, stacked totals, QR at the foot).
*Ships:* a shopkeeper can print at the counter. **This is the phase that makes
EkBook usable in a real shop.**

### Phase 3 — Paper sizes and a theme set
A4 and A5. Six to eight A4 themes covering the range myBillBook has — classic,
modern, minimal, bold-header, bordered, GST-detailed — plus a colour choice per
theme rather than a fixed palette per theme, which is more range for less code.
*Ships:* the visible "multiple designs" Rahul asked for.

### Phase 4 — Per-shop customisation
Logo size and placement, accent colour, terms and conditions, signature image,
bank details block, and toggles for optional columns (HSN, batch, expiry,
vehicle no, e-way bill). Stored per shop, previewed live.
*Ships:* the shop's invoice looks like the shop's.

### Phase 5 — The compliance engine
Validate the document against Rule 46 before printing. Block nothing — warn
clearly, name the field, offer the fix. Includes the HSN-digit rule by turnover
band and correct placement of the e-invoice IRN and signed QR where it applies.
*Ships:* the differentiator.

### Phase 6 — Bilingual invoices
Second language beside English, per shop. Field labels first (they are a fixed
vocabulary), then the amount in words.
*Ships:* the thing no competitor offers.

---

## 6. Order, and what I would cut

If the whole thing is too much, the honest priority is:

- **Phase 2 is not optional.** Without thermal printing the app cannot be used
  at a shop counter, and no amount of A4 styling fixes that.
- **Phases 1 and 3 are the visible win** Rahul asked for and should follow.
- **Phase 5 is where EkBook beats the competition** rather than matching it.
- **Phases 4 and 6 are genuine but can wait** if time is short.

I would build 1 → 2 → 3 → 5 → 4 → 6, which puts the differentiator earlier than
the polish.

## 7. What I need from Rahul before starting

1. **Is there a thermal printer to test against**, and what width — 2 inch or
   3 inch? Bluetooth or USB? I can build to the ESC/POS standard, but printing
   is the one thing that cannot be verified in a browser, exactly like the
   Capacitor share bug.
2. **Reference invoices you like** — the same way you sent card artwork. If you
   have myBillBook or Vyapar output you rate, send it; otherwise I will design
   the set and show you.
3. **Confirm the order above**, or reorder it.
