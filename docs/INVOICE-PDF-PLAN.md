# The invoice: research, and a plan in six phases

**Written 2026-08-05. Revised the same day after Rahul corrected the premise.**

---

## 0. The correction that reorders everything

My first draft made thermal printing the priority. Rahul:

> "the main idea is not providing them the bill but to share those bill to
> whatsapp. so you should also consider it."

He is right, and it changes the shape of the whole thing. **The invoice's
destination is a WhatsApp chat on someone's phone — not a printer.** Everything
below is re-ordered around that.

Two consequences follow immediately, and they are not small:

**1. We are sending the wrong kind of file.** `handleWhatsAppShare` today
generates a PDF and shares it. In WhatsApp a PDF arrives as a grey document card
with a filename on it. The recipient must tap it, wait for a viewer to open, and
then pinch and zoom around an A4 page on a 6-inch screen. An **image**, by
contrast, appears inline in the conversation, already readable, and is seen
without any decision being made. For a shopkeeper who wants their customer to
actually look at the bill and pay it, that difference is the entire feature.

**2. A4 is the wrong shape.** An A4 page is 1:1.41 portrait designed to be held
at arm's length. A WhatsApp image preview is roughly square-cropped in the chat
list and read on a phone. An invoice built for that surface has bigger type,
fewer columns, and the amount due where the thumb lands — it is a different
document, not a scaled-down A4.

So: **the shareable image is the primary artefact and the PDF is the fallback**,
not the other way round. That inverts my first draft.

Thermal printing stays in the plan, but last — Rahul has no thermal printer to
test with, and printing is the one thing a browser cannot verify. Shipping it
unverified is how the Capacitor share bug happened: correct in a browser,
completely dead on the phone. I would rather build it when it can be proven.

---

## 1. What we have today

One PDF layout, in `src/lib/invoice-pdf.ts` (468 lines, jsPDF) over
`src/lib/pdf/theme.ts` and `primitives.ts`. It is decent — brand band with logo,
Bill To card, item table with HSN, totals, amount in words, UPI QR, signature,
footer — and it renders on-device, so it works offline.

What it is not: choosable, phone-shaped, or shareable as anything but a PDF.
There is no theme, no paper size option, no per-shop customisation, and no
image.

E-invoicing already exists as data (`src/lib/e-invoice.ts`,
`/api/e-invoice/irn`); it is not yet placed on the printed document.

---

## 2. What the competition ships

| | Themes | Paper | Thermal | WhatsApp |
|---|---|---|---|---|
| **myBillBook** | 8 | A4, A5 | — | PDF |
| **Vyapar** | 12 + 2 | A4, A5 | 2/3/4 inch | PDF |
| **Zoho Books** | preloaded + custom HTML/CSS | A4 | — | PDF/email |
| **EkBook today** | 1 | A4 | none | PDF |

Every one of them shares a **PDF** to WhatsApp. Nobody sends an image built for
the chat window. That is the gap worth taking, and it is worth more than a
thirteenth theme.

---

## 3. The legal floor (not optional, whatever the format)

- **Rule 46, CGST Rules** — 16 mandatory fields: supplier name, address, GSTIN;
  serial number of at most 16 characters; date; recipient details; HSN/SAC;
  description, quantity, taxable value; rate and amount of tax per head; place
  of supply; whether tax is payable on reverse charge; signature.
- **HSN digits scale with turnover** — 2 digits (₹1.5–5 cr), 4 (₹5–10 cr),
  6 (above ₹10 cr).
- **E-invoicing** above ₹5 crore AATO from 1 April 2026 (Notification
  17/2025-CT); where it applies the IRP's signed QR must be on the invoice.
- A defective invoice can deny the BUYER their input tax credit, plus a penalty
  up to ₹25,000 under s.122. A wrong invoice damages our user's customer, which
  is how a shop loses customers.

**This applies to the image too.** A shared image that omits a Rule 46 field is
not a tax invoice, and a shopkeeper who sends only the image must still be
sending something valid. The image carries the same fields; it arranges them for
a phone.

---

## 4. Where EkBook can be genuinely better

1. **A WhatsApp-native invoice image.** Phone-shaped, readable without opening
   anything, amount due prominent, UPI QR and a pay link on the image itself so
   the customer can settle from the chat. No competitor does this.
2. **A compliance engine, not just a template.** Check against Rule 46 *before*
   sending and say exactly what is missing — "3 items have no HSN, and your
   turnover band needs 4 digits", "place of supply missing on an inter-state
   invoice". Every competitor will happily print a defective invoice.
3. **One document model, three surfaces.** Image, PDF and (later) receipt all
   built from the same `InvoiceDocument`, so they cannot disagree about the
   total. Vyapar maintains separate theme sets for regular and thermal.
4. **Bilingual invoices.** Hindi/Gujarati/Tamil beside English. Most kirana
   customers do not read English. The Unicode font work is already done.
5. **A preview that cannot lie.** One renderer, so what is previewed is what is
   sent — the lesson from the business card, where a second renderer drifted
   from the first and the export truncated an address the screen showed in full.

---

## 5. The plan

### Phase 1 — The document model
Split "what is on the invoice" from "how it is drawn", as `card-templates.ts`
did for the card. One `InvoiceDocument` built from the transaction; every
surface renders it. *Ships: no visible change; everything else depends on it.*

### Phase 2 — The WhatsApp invoice image ← **the main event**
A phone-shaped image built for a chat window: shop header, party, items, a large
amount-due block, UPI QR, and the Rule 46 fields. Shared as an image so it
appears inline. Reuses `lib/share-file.ts`, which already handles the Capacitor
share sheet correctly. *Ships: the thing the app is actually for.*

### Phase 3 — Themes and paper sizes for the PDF
Six to eight A4 themes plus A5, with a colour choice per theme rather than a
fixed palette each — more range for less code. The image gets the same themes so
the two stay recognisably one brand. *Ships: the visible "multiple designs".*

### Phase 4 — Per-shop customisation
Logo placement, accent colour, terms, signature image, bank details, and toggles
for optional columns (HSN, batch, expiry, vehicle no, e-way bill). Previewed
live, as the card editor now does. *Ships: the shop's invoice looks like theirs.*

### Phase 5 — The compliance engine
Validate against Rule 46 before sending. Warn clearly, name the field, offer the
fix; block nothing. Includes the HSN-digit rule and correct placement of the
e-invoice IRN and signed QR. *Ships: the differentiator.*

### Phase 6 — Thermal receipt (58/80mm), when it can be tested
Same document model. Held to last because there is no printer to verify against,
and unverified printing is a promise we cannot check.

**Order: 1 → 2 → 3 → 5 → 4 → 6.**

---

## 6. Design of the themes

Rahul: *"first you try and if i don't like then i will provide it to you."* So I
design the set and show him rendered output, the same loop that worked for the
cards — render, look, measure, fix — rather than asking for references first.

---

## 7. Open question

**Should the WhatsApp message carry a caption?** For the business card the
answer was no: the caption repeated what the picture said. An invoice is
different — a one-line "Invoice #143 · ₹4,500 · pay by 12 Aug" is useful in a
chat list preview, where the image itself is only a thumbnail. My plan is a
SHORT caption with the amount and a UPI link, and the full detail on the image.
Easy to remove if Rahul disagrees once he sees it.
