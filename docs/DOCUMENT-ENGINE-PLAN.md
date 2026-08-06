# The Document Engine

**Written 2026-08-05. Replaces INVOICE-PDF-PLAN.md, which was too small a
question.**

Rahul asked for a system that still works when EkBook is a billion-dollar
company, and gave me the call on how to get there. This is that plan, and it
starts by rejecting the framing of the last one.

---

## 1. Rahul was right, and here is the measurement

> "if the bills have so many items then it won't be possible to add everything
> in one images and sending multiple images can be an issue and also it might be
> slow compared to sending a pdf. so it's good for small bills."

Correct, and worse than he thought. **WhatsApp downsamples every image to about
1600px on its longest side.** A tall bill is therefore squeezed sideways:

| Items | Rendered | After WhatsApp | Verdict |
|------:|---------|----------------|---------|
| 4 | 1080×1860 | 929×1600 | readable |
| 8 | 1080×2172 | 796×1600 | marginal |
| 10 | 1080×2328 | 742×1600 | marginal |
| 15 | 1080×2718 | 636×1600 | **unreadable** |
| 30 | 1080×3888 | 444×1600 | **unreadable** |
| 50 | 1080×5448 | 317×1600 | **unreadable** |

The image is excellent up to about eight items and useless past fifteen. Since
a kirana bill is often 3–10 lines and a distributor bill is often 40, **neither
format wins outright**. Splitting into multiple images is worse than either —
the customer has to reassemble a bill in their head.

So the answer is not "image instead of PDF". It is a system that picks.

---

## 2. Where I disagree slightly, and why

Rahul: *"we should add all the features and according to user preference they
can select than they want jpg or pdf or other type of receipt."*

Agreed on capability. I would push back on one detail: **do not ask on every
send.** A shopkeeper billing forty customers a day does not want forty format
decisions. Every question at the moment of sending is a tax on the thing they
do most.

Instead:
- **Smart by default** — the app picks by bill length, and says which it chose.
- **One setting** to override the default for good ("always send PDF").
- **A quick change at the moment of sending**, for the exception.

Same capability, one-fortieth of the decisions. That is the difference between
a tool and a form.

---

## 3. The framing change: this is not an invoice feature

"Multiple invoice PDF designs" is a feature. It does not survive scale, because
the next six requests are the same feature again:

> quotations · delivery challans · credit notes · purchase orders · payment
> receipts · statements of account · GST workings · payment reminders

Every one of them is *a document, built from ledger data, styled to the shop's
brand, delivered over a channel, and subject to the same tax rules*. Built as
features, that is eight codebases and eight sets of bugs; and when the ninth
document type arrives, or when email is added, or when a new GST rule lands,
every one has to be touched.

Built once as an engine, it is four independent layers:

```
     DOCUMENTS          RENDERERS         DELIVERY         COMPLIANCE
  invoice, estimate,   image, PDF,     WhatsApp, SMS,     Rule 46,
  challan, credit      link, thermal,  email, print,      e-invoice,
  note, PO, receipt,   spreadsheet     download           HSN by turnover
  statement …
```

Adding a document type touches one layer. Adding an output format gives it to
every document type at once. Adding a channel likewise. That is an **N + M**
system instead of an **N × M** one, and it is the difference between shipping
the eleventh document type in a day and in a month.

The two pieces already built fit this: `invoice-document.ts` is the first
document model, `invoice-share-image.ts` the first renderer.

---

## 4. The strategic piece nobody in this market has: the link

For long bills there is a third option better than both, and it is what Stripe
and Razorpay actually do: **send a short link with a rich preview.**

- **Any length.** Forty items scroll. No compression, no file.
- **It can be paid.** A UPI button on the page — Razorpay report that instant
  WhatsApp payment confirmation cut "did my payment go through?" queries by
  around 80%.
- **It is always current.** Pay half of it and the page says so; a PDF sent last
  Tuesday says what it said last Tuesday, forever.
- **It tells us what happened.** Sent → delivered → *viewed* → paid. A
  shopkeeper chasing money wants to know whether the customer opened it, and
  "did they see it" is the single most useful thing we can tell them.
- **It costs nothing to send** on a 3G connection.

That last point is also the honest answer to Rahul's fundraising-grade data
requirement: documents viewed and documents paid are real engagement metrics,
not vanity counts.

**The privacy cost must be paid up front, not retrofitted.** A bill on the open
web is somebody's commercial data. Non-negotiable: an unguessable token (never
a sequential id), `noindex`, no personal data in the URL itself, an expiry the
shop controls, and revocation. Under the DPDP Act this is the shop's data being
processed by us, and the design has to be defensible on the day someone asks.

**The link does not replace the file.** A customer claiming input tax credit
needs the PDF to keep. The link is how a bill is *delivered*; the PDF is what it
*is*.

---

## 5. What the engine is made of

**1. Document model** — one per type, sharing primitives (party, line items,
tax summary, totals, payment state). Arithmetic happens once, here. Renderers
never compute; they lay out.

**2. Renderers** — image, PDF (A4/A5), link page, thermal (58/80mm), and
spreadsheet for the accountant. Each takes any document model.

**3. Theme system** — one theme applied across every type and every renderer, so
a shop's estimate, invoice and receipt look like one business. Themes are
registry entries, exactly as the card templates are.

**4. Delivery** — WhatsApp, SMS, email, print, download. One adapter each,
usable by every document. `lib/share-file.ts` is the first of these and already
handles the Capacitor share sheet correctly.

**5. Compliance** — Rule 46's sixteen fields, HSN digits by turnover band,
e-invoice IRN and signed QR. Validated on the document, so it is enforced no
matter which renderer or channel is used. **This is the differentiator**: every
competitor will happily print a legally defective invoice.

**6. Document ledger** — every document ever produced, with its status. This is
support ("what did I send them?"), it is the audit trail, and it is the
engagement metric.

---

## 6. The plan

| Phase | What | Why here |
|---|---|---|
| **1 ✅** | Document model | Done. |
| **2 ✅** | WhatsApp image renderer | Done. |
| **3** | **Smart format + delivery layer** | Wire image/PDF into the bill screen with the length rule and a preference. The app becomes usable for both bill sizes. |
| **4** | **The link** + document ledger | The strategic bet, and the metrics layer. |
| **5** | **Theme system** across image, PDF and link | The visible "many designs". |
| **6** | **Compliance engine** | The differentiator. |
| **7** | **Document types** — estimate, challan, credit note, receipt, statement | Proves the engine; each should be days, not weeks. |
| **8** | **Thermal**, when a printer exists to test on | Unverifiable today. |

Phase 3 first because the app currently sends a PDF nobody opens, and that is a
live problem. Phase 4 next because the link is the thing competitors do not
have and everything after benefits from the ledger underneath it.

---

## 7. The rule for Phase 3, concretely

Measured, not guessed:

- **≤ 8 items → image.** Readable after WhatsApp's compression.
- **> 8 items → PDF.** With a link too, once Phase 4 lands.
- **Shop can override** to always-image or always-PDF.
- **Change it at send time** in one tap, for the exception.
- The app **says which it chose and why** — "long bill, sending as PDF" — so it
  never feels arbitrary.

---

## 8. What I need from Rahul

1. **The caption question**, still open: image plus a one-line "Invoice #143 ·
   ₹5,062 due", or image only?
2. **The link needs a decision from you, not me.** It puts a page with a
   customer's bill on the public internet behind an unguessable token. I think
   it is right, and it is what Stripe and Razorpay do — but it is your data
   policy, and you have said user data protection comes before everything. Say
   yes and I will build it with expiry and revocation from the first commit.
3. **Nothing else.** The rest I can decide and show you.
