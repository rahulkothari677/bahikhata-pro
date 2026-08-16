# The invoice engine — restructuring plan

**Written 2026-08-15.** Rahul supplied 13 myBillBook screenshots and 20 reference invoice designs, and asked for a plan that beats myBillBook *and* the global leaders, without copying anyone.

**What this serves (§0):** a compliance engine, not a register. An invoice is the one artefact that is simultaneously the shop's face, its legal record under Rule 46, and the thing that gets it paid. Every competitor treats it as a print job.

---

## Part 1 — What myBillBook actually has

Read from the 13 screenshots, grouped by what they *do* rather than where they sit in that app's menu.

| Group | Controls |
|---|---|
| **Delivery** | Share as PDF or Image (radio) · Print to A4/A5 or Bluetooth thermal · "select Old format if modern doesn't work with your printer" |
| **Identity on the doc** | Invoice number prefix + starting serial · Phone on invoice (with its own on/off + editable number) · Email on invoice · Terms & Conditions · Signature (draw by hand / camera / gallery / empty box / *receiver's* signature field) · Bank account + Payment QR · Tagline |
| **Visibility toggles** | Show Party Balance · Item Description · Alternate Unit · Price History (last 5 prices for this party) · Free Quantity · Time on invoice · Item image |
| **Extensibility** | Add fields to **party** (industry-suggested, e.g. FSSAI for fmcg) · Add fields to **invoice** (PO Number, Vehicle Number) · Add/remove **columns** (Quantity, Rate, MRP) · custom columns (Batch no., Exp. date, Mfg date) · "Add Custom Field/Column" everywhere |
| **Look** | Theme Styling presets (named "Uttarakhand", "Uttarakhand 2"…) · tiers: Luxury (NEW) / Stylish / Advance GST (crown = paid) · 7 colour swatches · "Create your own Invoice Theme" |
| **Tax behaviour** | Discount **before** tax (split among items) vs **after** tax |
| **Compliance** | Generate e-Way Bills & e-Invoices, with GSP credentials |

**The one thing they do that matters most:** *every* settings screen shows a **live preview of the actual invoice at the top**, with the field being edited highlighted in a red dashed box (see the Phone Number and Invoice Prefix screens). You never guess what a toggle does.

### Where myBillBook is weak — our openings

1. **Their preview is a picture of a stale invoice.** Same sample data every time. It cannot show *your* longest item name overflowing.
2. **Theme names are meaningless.** "Uttarakhand 2" tells a shopkeeper nothing. Naming is a UX decision they lost.
3. **Their free tier is watermarked** — the sample shows *"Invoice created using myBillBook · Download now at [Play Store] [App Store]"* printed on the customer's bill. The shopkeeper's customer sees a competitor's ad on the shop's own invoice.
4. **Settings are scattered across five screens** with no search, and no way to see "what does my invoice look like right now" in one place.
5. **Nothing is per-customer or per-document-type.** One global setup for every buyer and every document.
6. **No language.** Every screenshot is English-only. Their user is the same kirana shopkeeper who prefers Hindi.

---

## Part 2 — What EkBook has today

| | |
|---|---|
| **Has** | 8 colour themes (`invoiceTheme`) · send format auto/image/pdf · optional share link · round-off toggle · e-invoice applicability · shop logo · UPI QR when a VPA exists · IRN + signed QR when registered |
| **Missing** | Terms & conditions · signature · bank details · invoice number prefix · custom fields (party or invoice) · custom columns (batch/expiry/MFG/MRP) · field visibility toggles · discount before/after tax · thermal printing · **live preview of any kind** |

### Two structural faults to fix before any design work

**Fault 1 — the theme setting is lying.** The setting says *"Used on the bill picture, the bill link and the PDF."* It is not used on the PDF. `src/lib/invoice-pdf.ts` hardcodes `brand: {r:217, g:110, b:27}` (saffron) and never receives `invoiceTheme`. Pick Midnight: the WhatsApp image and the link turn dark blue, **the PDF stays orange**.

**Fault 2 — the PDF is off the shared document layer.** `src/lib/invoice-document.ts` exists so the arithmetic happens once and renderers only draw. The PDF ignores it and defines its own `InvoiceData`. It shares `computeInvoiceDue`, so the money agrees *today* — but nothing structural keeps it that way, and every new field has to be added twice.

**Fixing these is not preparation for the feature. It IS the feature's foundation.** Adding 30 customisation options to two renderers that disagree doubles the bug surface.

---

## Part 3 — Research: what makes an invoice good, beyond looking nice

Numbers worth designing against:

- Clear layouts with online payment options are paid **28–32% faster**; firms offering online payment are paid **more than twice as fast** ([LeanLaw](https://www.leanlaw.co/blog/a-guide-to-invoice-design-layout-tweaks-that-get-you-paid-faster/), [Pricefic](https://www.pricefic.com/post/hidden-psychology-invoice-design-makes-clients-pay-faster))
- Putting **Pay Now at the top** rather than the bottom produces **15–20% more "pay now" decisions** ([BillingBee](https://www.billingbee.co/blog/invoice-psychology-trick-get-paid-faster/))
- **"Please pay by 15 December" beats "Net 30"** — specific dates outperform jargon ([BillingBee](https://www.billingbee.co/blog/invoice-psychology-trick-get-paid-faster/))
- **Gratitude microcopy** ("Thank you for your business") is associated with up to **21% faster** payment ([Pricefic](https://www.pricefic.com/post/hidden-psychology-invoice-design-makes-clients-pay-faster))
- Elaborate graphics hurt: an invoice's job is communicating payment information clearly ([InvoiceGen](https://www.invoicegenfree.com/blog/best-practices-for-invoice-design))

From the global tools ([Zoho](https://www.zoho.com/us/invoice/help/invoice/invoice-preferences.html), [Zoho Books custom fields](https://www.zoho.com/us/books/videos/sales/custom-field-invoice.html)): custom **fields**, custom **columns**, editable field *labels* (not just values), per-template overrides, and recurring/scheduled invoices are table stakes at the top end.

**The synthesis nobody in India is doing:** these findings are about *getting paid*, and every Indian competitor treats the invoice as a *print job*. An invoice that carries the amount due at the top, a real payment button, a specific due date and a thank-you line is a **collection instrument**. That is a product difference, not a skin.

---

## Part 4 — What we build: five layers

The principle throughout: **one document definition, many renderers, zero duplicated arithmetic.**

### Layer 1 — `InvoiceDocument` becomes the only truth
Extend `src/lib/invoice-document.ts` to carry everything any renderer could print: terms, signature, bank block, custom fields, custom columns, visibility flags, due date, thank-you line. Every renderer — A4 PDF, WhatsApp image, share link, thermal — consumes only this. **Nothing renders from a Transaction directly, ever.**

Guard: a test that fails if any renderer imports Prisma types or recomputes a total.

### Layer 2 — the template contract
A template is **data**, not code: paper size, band style, table style, which blocks appear and in what order, type scale, colour roles. Like `card-templates.ts`, which already works this way.

This is what makes "20 designs" cheap instead of 20 files to maintain — and it is how we avoid copyright exposure: we are not reproducing anyone's layout, we are defining our own grammar and composing original arrangements within it.

### Layer 3 — the customisation model (three kinds, deliberately separated)

myBillBook mixes these; separating them is clearer *and* less code:

1. **Visibility** — show/hide something the document already knows (party balance, item description, time, HSN, item image)
2. **Content** — text the shopkeeper supplies once (terms, tagline, bank details, signature, thank-you line, prefix)
3. **Extension** — fields and columns that do not exist yet (batch, expiry, MFG, MRP, PO number, vehicle number, FSSAI, hallmark/HUID)

Extensions are typed (`text | number | date | money`), so a date column sorts and formats correctly and a money column joins the totals — rather than being a string that happens to look like a date.

### Layer 4 — presets by trade
The 20 reference designs already cluster by trade: pharma needs batch/expiry/MRP and a drug-licence header; transport needs e-way bill, vehicle, LR number, consignor/consignee; retail needs a compact memo; services need SAC and hours.

So: **"What kind of shop is this?" → kirana / pharma / textile / electronics / transport / services / jewellery**, and the right columns, fields and template are switched on together. One question replaces twenty toggles. This is the single biggest usability win over myBillBook, where the shopkeeper must know they need a "Batch no." column and go find it.

Presets are a **starting point, never a lock** — every toggle stays editable afterwards.

### Layer 5 — live preview, the honest kind
A preview panel on every invoice-settings screen, like myBillBook — but rendering **the shop's own most recent real invoice**, not a stock sample. If their longest product name breaks the layout, they see it while choosing, not after sending.

Plus the thing myBillBook cannot do: a **format switcher** on the preview — A4 · WhatsApp image · share link · thermal — so one glance answers "what does my customer actually receive?"

---

## Part 5 — Execution phases

Each phase ships and is verifiable on its own.

| Phase | What | Why this order |
|---|---|---|
| ~~**1**~~ ✅ | ~~Put the PDF on `InvoiceDocument`; make `invoiceTheme` reach it~~ | **Done 15 Aug** — see below |
| ~~**2**~~ ✅ | ~~Template contract~~ | **Done 15 Aug** — see below |
| ~~**3**~~ ✅ | ~~Content settings: terms, signature, bank, prefix, tagline, thank-you, due date~~ | **Done 15 Aug** |
| ~~**4**~~ ✅ | ~~Visibility toggles + the live preview panel~~ | **Done 15 Aug** — see below |
| **5** | Extensions: custom fields (party + invoice) + custom columns, typed | The schema-heaviest piece; needs 1–4 stable |
| **6** | Trade presets | Only sensible once 3–5 exist to switch on |
| **7** | New template designs, informed by the 20 references | Design last, on a working engine |
| **8** | Thermal (58/80mm) + A5 | Needs Rahul's printer; deferred by his own instruction |

### Phases 1–2, as built (15 Aug)

**Phase 1.** `generateInvoicePDF` now takes an `InvoiceDocument` and nothing else.
The rival `InvoiceData` / `ShopSetting` shapes are gone, along with the PDF's own
calls to `computeInvoiceDue` and `amountToWords`. `send-bill.ts` hands it the
document it had already built instead of the raw source behind two `as never`
casts.

`pdf/palette.ts` converts an `InvoiceTheme` to jsPDF's RGB, flattening `rgba()`
over its own backdrop because a PDF has no alpha for text. Status colours stay
unthemed.

Two things this turned up:

- **A second hardcoded palette in `pdf/primitives.ts`.** The footer rule and the
  "Made with EkBook" line drew in saffron regardless of theme, so a Midnight
  invoice had a saffron stripe across the bottom. Found in a stray jsPDF font
  warning — *not* by the guard, whose first version only checked the chosen
  colours were present. It now also asserts the old one is absent.
- **A real arithmetic drift.** The PDF printed `paidAmount` (paid at the till)
  beside a due figure that accounted for later settlements, so a part-paid bill
  could read "Paid ₹200" and "Balance Due ₹0" on one page. Reading `doc.paid`
  forces them to agree.

**Phase 2.** A template is now data: header (`band` / `rule` / `frame`), table
(`zebra` / `grid` / `rows`), totals (`bar` / `panel` / `plain`), density, and a
display face. Six ship. **Layout and colour are separate controls** — 8 × 6 = 48
looks from 14 entries — which is the one thing myBillBook gets wrong.

A template may not add, remove or rename a field; a test fails if a key like
`showGstin` appears in an entry. `standard` resolves to the exact metrics the
renderer hardcoded before (32mm band, 7mm rows, 9pt, 5mm baseline), verified by
rendering unset vs named and comparing text operators — so nobody's invoice
changes until they ask.

**Evidence:** `npm run verify` green — 238 suites, 4,069 tests, 0 lint errors,
build clean. Both guards were proved by reintroducing the bug: re-adding
`computeInvoiceDue` to the PDF fails the import guard; reverting the primitives
fix fails the absence check.

---

**Phases 1–2 were the ones to do first.** They are correctness, not features.

---

## Part 6 — Copyright

We take from the references: which *fields* Indian trades need, and layout *conventions* (header band, party block, item table, totals right, terms bottom-left, signature bottom-right). Those are industry standards and legal requirements — Rule 46 dictates most of them.

We do not take: their exact proportions, colour values, ornaments, type pairings, or theme names. Every template is composed in our own grammar with our own tokens. The one thing we will never copy is the watermark: **no EkBook advertisement on a shopkeeper's invoice, on any plan.** Their customer is not our billboard.

---

## Part 7 — What I need from Rahul

**Answering his question — yes, filled, and body only.** Specifically:

1. **Fully filled with realistic data.** Empty cells hide the real problems. The `transport_b2b_logistic` reference has blank PACKAGES / WEIGHT / RATE-PER-TON and an amount-less freight row, so I cannot see how that layout handles numbers.
2. **The body — the whole document, edge to edge.** No phone status bar, no app chrome, no browser frame, no desktop shadow. The `billbook_modern_gold` and `minimalist_slate_corporate` files are exactly right.
3. **At least 5 line items**, and one deliberately long product name — that is where layouts break.
4. **Show the totals block**, including tax breakup and amount in words.
5. **One image per design.** Multi-page only if the design does something specific on page 2.
6. **Legible resolution** — roughly 1200px wide or more. Several current files are ~150KB and go soft when zoomed.

**Not needed:** app settings screenshots (I have those), or the same design in several colours — colour is a token, one is enough.

**Also useful, if easy:** a photo of a real invoice from a shop near him. Reference designs are idealised; a real one shows what actually gets printed.

---

## Phase 4, as built (15 Aug)

### Four of myBillBook's seven. The other three were checked, not copied.

Part 1 of this document lists seven toggles read off Rahul's screenshots. Before
building any of them I read the schema, because **a toggle for data that does
not exist is a placebo** — the same defect as the App Lock that locked nothing
and the "Coming Soon" shop switcher.

| Toggle | Data in EkBook | Built? |
|---|---|---|
| Show party balance | `computePartyBalance()` | ✅ |
| Item description | `Product.notes`, editable in ProductDialog | ✅ |
| Alternate unit | `enteredQuantity`/`enteredUnit`, snapshotted per line | ✅ |
| Time on invoice | `Transaction.date` is a DateTime | ✅ |
| Free quantity | **no column anywhere** | ❌ needs schema + entry UI |
| Item image | **no image field on `Product`** | ❌ **and Rahul does not want it on the bill** (15 Aug) |
| Price history (last 5 for this party) | needs a query per LINE | ❌ see below |

**Price history is not a missing feature, it is a rejected one.** Five prior
prices for each item on the bill is one query per line, and it puts the
shopkeeper's own pricing history on a document the customer keeps. It fails the
BUILD FOR MILLIONS check and it is the wrong audience. If it returns it belongs
on the item-entry screen, where the shopkeeper is deciding the price.

### The architecture: toggles are applied once, not four times

`buildInvoiceDocument` resolves every toggle to **a value or to null**. A hidden
field is simply absent from the document, so the PDF, the WhatsApp image, the
shared link and the live preview never see a setting at all.

This is the direct fix for the class of bug that produced `invoiceTheme`: four
renderers each had to remember to honour one setting, and one of them didn't.
**A renderer handed `null` has nothing left to get wrong.** A test reads all four
renderer files and fails if any of them mentions a toggle key.

### §0 — the registry refuses to hide the law

`src/lib/invoice-visibility.ts` is the single list: schema column, label,
default, and how the toggle applies. Beside it sits `MANDATORY_INVOICE_FIELDS`
— the Rule 46 particulars — and a test that fails if any of them is ever
offered as a switch.

Every competitor treats "customise your invoice" as a free-for-all. A shopkeeper
who switches off their GSTIN has not customised their bill, they have issued a
document that is not an invoice, and they find out from a notice. Refusing is
the difference between a register and a compliance engine, applied to a
settings screen.

### Two defects found and fixed while building this

1. **The shared bill link was a release behind.** `/b/[token]` built its shop
   object by hand with nine fields and silently dropped the terms, bank block
   and signature Phase 3 added — so a customer opening the link got a different
   bill from one sent the same invoice as a PDF. All four call sites now use one
   `invoiceShopFromSetting()` mapper, and a test asserts they do.
2. **A second money formatter, caught by the guard.** The balance label
   originally baked in its own rupee string, bypassing `formatPDFMoney`'s Indian
   digit grouping — so a lakh-rupee balance would have printed in a different
   grouping from every other figure on the same page. The document now hands
   over the words and each renderer formats the figure with its own formatter.

### What is NOT verified

The code is green (242 suites, 4,134 tests, 0 lint errors, build passes) and
both new guards were proved by reintroducing the bug and watching them fail.
**It has not been driven in a browser.** The local dev database was recreated on
a new port and the embedded browser would not accept typed credentials, so
Rahul checks this one on the deployed app.

---

## The shareable bill link, removed (15 Aug)

Rahul: *"remove the link which we can share with the bill in pdf … i just want
a section in the app where the user can add the image of there QR or add upi id
for billing so if the customer wants to pay they can pay. sharing link or
directly paying option sometimes cause fear in the mind of general public."*

**He is right, and this reverses a decision made in this document.** Part 3
argued that a payment link makes an invoice a collection instrument, citing
research that online payment gets bills paid 28–32% faster. That research is
about Western B2B invoicing, where a payment link from a supplier is normal.
It says nothing about a kirana shop's customer receiving a WhatsApp message
with a URL asking for money — where the whole country has been trained, by
years of real fraud, to treat exactly that as a scam. A number from the wrong
population is not evidence.

### Gone

`/b/[token]`, `/api/bill-share`, `lib/bill-share`, the `textWithLink`
annotation on the PDF, the link in the WhatsApp caption, and the "Also send a
bill link" switch.

### Kept, deliberately

The **`BillShare` table and every row in it.** Links a shopkeeper already
minted are their record. Old links 404 because the page is gone, not because
anything was erased. `Setting.docShareLink` stays for the same reason, but the
API no longer accepts it — a setting the app saves and never reads is how a
dead feature comes back by accident.

### New: Invoices & Bills → Payment

One place for "how does my customer pay me", replacing a UPI id buried in Shop
Profile and a link switch under Sending.

- **UPI ID** → the bill prints a `upi://pay` QR that already carries the
  amount. Nothing to type.
- **Your own QR** → upload a photo of the code on your counter. Most shops
  already have a laminated PhonePe or Paytm code their regulars have scanned
  fifty times; that one is more trusted than anything this app generates, and
  the money lands in the account they actually use.

**When both exist the uploaded image wins**, in the PDF *and* the WhatsApp
picture — decided in two files, so a test asserts the order matches. If they
diverged, the file and the image would show the customer different ways to pay.

**One honest difference is printed on the bill.** A generated code carries the
amount; a photographed one cannot. So the uploaded QR says "Scan to pay /
Enter ₹567" rather than "Scan to pay ₹567". Printing an amount over a code
that opens an empty box would be a small lie on a legal document, and the kind
that ends with someone paying the wrong number.

### Also fixed: "make your first sale"

The preview told a shop with 33 sales that month to make its first sale,
because a **failed fetch** and an **empty ledger** both arrived at the same
flag. Rahul watched it happen while Vercel's DDoS rule was challenging his
requests. Both queries now throw on a bad response, and the caption has three
states — the app only claims the books are empty when it actually knows.

---

## Phase 5, part 1 — the foundation (15 Aug)

**Status: the storage, typing, rules and rendering are done. The screens are
not.** A shopkeeper cannot yet define a field or fill one in — that is part 2.
Nothing here is user-visible.

### Why this is §0 work, not customisation for its own sake

A pharmacy must record the **batch number and expiry date** of every medicine
it sells. That is the Drugs and Cosmetics Act, not GST, and Drug Inspectors
cross-reference billing records against it. EkBook can store neither, so a
chemist cannot use this app for their actual job.

Checked rather than assumed, and it corrected me: putting the **HUID on a
jewellery invoice is voluntary** — hallmarking itself is what is mandatory. So
it is a useful field, not a legal one, and nothing here claims otherwise.

### Where the values live, and why

Definitions in a table (`CustomFieldDef`); **values in a JSONB column on the
record itself** — `Party.customFields`, `Transaction.customFields`,
`TransactionItem.customCols`.

The BUILD FOR MILLIONS question decides it. The dominant access pattern is
"load one bill, draw it" — every renderer, every share, the preview. A values
table puts a join on that hot path for every render, thirty million rows deep,
to print a grocery bill. JSONB carries the fields on the row already, and
Postgres can still index into it with GIN for the rare search by PO number.

### Values are snapshots, including their labels

Each stored value carries its **key, label, type and whether it printed** —
not just the value. That is the rule `TransactionItem.hsn` already follows:
*"editing a product's HSN next year cannot rewrite a filed return."*

Rename "Batch" to "Lot No." in March and every invoice issued before March
still prints "Batch", because a customer is holding that paper. Storing
`{key: value}` and looking the label up at render time would silently rewrite
history on every old bill. A test proves it.

### §0 again: a custom field cannot forge a legal one

`RESERVED_FIELD_LABELS` refuses GSTIN, HSN, Invoice No, Taxable Value, CGST,
Total, Place of Supply, IRN and their variants — compared with spacing and
punctuation collapsed, so "gst  no" and "GSTIN" are the same refusal.

A bill carrying **two GSTINs that disagree** is worse than one carrying none:
it looks authoritative and is wrong. Refused with a reason, because the
shopkeeper is one tap from invalidating their own invoice.

### Three smaller decisions worth recording

- **Money custom fields stay in rupees, never paise.** The paise extension
  intercepts named columns on known models; a number inside a JSON blob is
  invisible to it, so storing 45000 for ₹450 would be the 100x bug with a new
  hiding place — and one the money tests would not catch, because it is not a
  money column.
- **Deleting a field is always soft.** Issued bills carry values for it and
  must keep printing them. Retiring only stops it being offered on new records.
- **Ten fields per entity.** A cap, because there must be one; without it a
  bill grows columns until it stops fitting the page, and the person who finds
  the limit is a shopkeeper mid-sale.

### What is left for part 2

1. The **write path** — saving values when a bill or party is created or edited.
2. **Settings UI** to define fields (Invoices & Bills → a new section).
3. **Entry UI** to fill them, on the sale screen and the party form.
4. Rendering the **invoice-level and party-level** fields. Item columns already
   draw on all three surfaces; PO number and FSSAI reach the document but are
   not yet laid out.

---

## Phase 5, part 2 — the screens (15 Aug)

**Now usable.** A shopkeeper can define their own fields, fill them in on a
sale, and see them on the bill.

### Where it lives

**Account → Invoices & Bills → Your own fields**, with three lists that say
plainly where each one lands:

| List | Appears | Real example |
|---|---|---|
| On every item | Under each line of the bill | Batch No., Expiry, MRP |
| On the whole bill | Once, near the bill number | PO Number, Vehicle Number |
| On a customer | Saved with the customer | FSSAI Licence, Route |

**Three lists rather than one "Add Custom Field" button**, because the mistake
is expensive: a batch number added as a *bill* field appears once on a bill
with nine medicines on it, which is not the record the Drugs and Cosmetics Act
asks for. myBillBook offers the same button on six screens without the
distinction, and their help pages are full of people asking why their column
printed once.

Each list carries a real example rather than "Custom Field 1" — a chemist
reading "Batch No., Expiry" knows immediately this is their row.

### Two switches per field

- **Must be filled** — the bill cannot be saved without it. Enforced on the
  SERVER, so an offline client replaying a queued sale cannot skip it.
- **Print on the bill** — off keeps it in the shop's records only. A shop's own
  cost price is the case that matters: recorded, never shown to the customer.

### Where the boxes appear

Per-line boxes sit **inside each item's own card**, under its numbers. A
chemist filling batch and expiry on a nine-item bill can see which medicine
each pair belongs to; a separate panel would make that a memory test.

The **field's type drives the keyboard** — a date opens a date picker, a number
opens the numeric pad. Someone entering an expiry on every line does it dozens
of times a day, and a plain text box there is the difference between a feature
used and one abandoned.

### The trap this phase walked into

`validation.ts` carries a warning that Zod strips undeclared keys, written after
an HSN code sent on a free-text line was discarded before the line-item code
ever saw it. A custom field would have vanished the same way — typed in, saved,
gone. Both keys are now declared, and a test fails if either is removed. Proved
by deleting one and watching the guard fail.

### What is deliberately still open

- **Editing a bill** does not yet re-save custom values — only creating one does.
- **Party fields** save and reach the document, but are not laid out on the bill
  yet. Item columns and bill fields both print.
- **Trade presets** (Phase 6) will offer "you sell medicines?" and create batch
  and expiry in one tap, instead of typing them by hand.

---

## Phase 6 — trade presets (16 Aug)

**"What do you sell?"** sits above the three lists in *Your own fields*. Pick
Medicines and you get Batch No., Expiry and MRP in one tap.

### Why this is §0 work and not a convenience

Phase 5 lets a chemist add a batch number. It does not tell them they are
**required** to record one — and a shopkeeper who does not know the rule never
goes looking for the setting. They find out from a Drug Inspector.

So every preset field carries `basis`: **`law`** (with the rule named) or
**`practice`**. The screen shows a ⚖ and "required by law" for the first and a
plain ✓ for the second. Every competitor offers "industry suggested fields".
None of them says which ones you can be penalised for missing.

### Only two things in this whole file are marked as law

`pharmacy:Batch No.` and `pharmacy:Expiry` — the Drugs and Cosmetics Rules,
and Drug Inspectors cross-reference billing records against them. **A test
pins that list exactly**, so adding a third legal claim fails until somebody
writes down which rule it comes from.

Everything else is `practice`. In particular:

- **HUID is NOT law.** Hallmarking is mandatory; printing the HUID on the
  invoice is voluntary. I assumed otherwise, checked, and was wrong — the app
  now tells jewellers the truth rather than repeating my mistake to someone
  who would believe it.
- **Vehicle number is NOT required on the invoice.** It is needed to raise an
  e-way bill, which is a different document.

**Only a `law` field may be `required`**, and a test enforces that. A required
field blocks a sale; doing that for a convention would stop a shopkeeper
billing a customer over something nobody asked them for.

### Applying a preset is ordinary and repeatable

It creates plain `CustomFieldDef` rows through the Phase 5 rules — reserved
names, per-entity cap, everything. A preset that wrote rows by a private path
would be a second vocabulary for "a field this shop has".

Tapping a trade twice adds nothing and says so. Existing fields are **skipped,
never overwritten** — the shopkeeper may have renamed one or stopped printing
it, and a re-run that reset those would undo a deliberate choice.

### Verified in a browser, on a real chemist's shop

- Medicines applied → `added: [Batch No., Expiry, MRP]`
- Applied again → `added: []`, `skipped: [all three]`
- Stored as `Batch No./text/required`, `Expiry/date/required`, `MRP/money/optional`
- **A sale with no batch is refused: `400 — "Batch No. is needed."`**
- The same sale with a batch saves, and the bill prints
  `Batch No.: AMX-7741 · Expiry: 31 Jan 2028 · MRP: —`
- Screenshot taken and looked at: ⚖ + "required by law" on the two legal
  fields, plain ✓ on MRP.

Guard proved by marking HUID as `law`: three tests fail. Restored: 12 pass.

---

## Two gaps Rahul found (16 Aug)

### 1. A field could not be edited

*"once i add any field there is no option to edit it."*

Correct. I wrote the PATCH route, wrote a `patch` handler in the card, covered
the route with tests — and **never rendered a button for either**. A tested API
with no way to reach it is dead code with a green tick.

Now: a pencil on each field opens rename, retype, and both switches. The rename
box carries the sentence that matters — *"Bills you have already made keep the
old name."*

### 2. The fields did not appear on a downloaded bill

*"these aren't appear in the real bill when i downloaded it or shared on
whatsapp."*

**The renderer was not at fault.** Proved by rendering a real PDF from the
exact stored shape: batch, expiry and the bill field all print.

The bill was raised **before the field existed**, so it carried no value and
correctly printed none — a bill is a legal record and cannot be back-filled by
a later settings change. But there was no way to put a value in afterwards
either: **only CREATE ever stored a custom value.** So the field was
permanently invisible on every bill made before it was defined.

Editing a bill now re-snapshots its custom values, and the edit dialog offers
the boxes.

**That fix introduced a sharper risk, which is the part worth recording.** The
server re-snapshots on every edit — so an edit dialog that did not send the
existing values back would **erase a batch number on the first unrelated
change**. Silent data loss on a legal record. The dialog therefore PRELOADS
what the bill already carries, and a test fails if it stops sending them.

### What my verification had missed

I created every Phase 5 test sale **through the API**, never through the sale
screen. The entry boxes were never checked in the real UI. They do work — one
appears under each item once a product is added — but I had no right to
believe that, and the gap is exactly where Rahul's report landed.

**Verified this time, in the browser:** the pencil opens the edit panel; a bill
edited from `Batch No.=TEMP` to `FIXED-9001` keeps the new value and shows it
in the preview; the sale screen shows `Batch No. * (required) | Expiry *
(required) | MRP` under an added item.

---

## The reachability sweep (16 Aug)

Rahul, after finding two of these himself: *"first sweep the rest of the
invoice settings."* Right call. The class is **built, tested, and impossible
to reach — or reachable and connected to nothing.**

Twenty-seven invoice settings were checked, in both directions: can a
shopkeeper SET it, and does anything READ it.

### It found one, and it was the worst of the three

**`invoicePrefix` and `invoiceNextNumber` did nothing at all.**

Saved by the settings screen. Validated by the API. Read by **nothing**. A
shopkeeper typed `RG/26-27/`, watched the screen promise *"your next bill will
be RG/26-27/47"*, tapped Save — and every bill still came out `INV-0001`.

That is the `invoiceTheme` bug for the third time, and it was my own Phase 3
work.

**Why my test missed it.** `invoice-content-fields.test.ts` asserts the API
*validates* `invoiceNextNumber`. It does. That is not the same sentence as
"something uses it", and the whole bug lived in the gap between them.

### Both halves had to be fixed

1. **The formatter** (`lib/invoice-number.ts`) applies the prefix. With no
   prefix the output is byte-identical to before — `INV-0001` — because an
   invoice series that changes shape mid-year is exactly what Rule 46(b) is
   about.
2. **The counter is seeded** when the next number is set. Storing the number
   and leaving the counter where it was is the other half of the same defect.

**The counter is never rewound.** Going backwards would re-issue numbers
already printed on bills a customer is holding. A shopkeeper who asks for a
lower number is told: *"Your bills have already reached 47. The next one will
be 48 — going back would repeat a number that is already on a bill."*

### Verified in the browser

| | |
|---|---|
| Prefix `VM/26-27/`, next number 47 | Bill came out **`VM/26-27/47`** |
| Asked to go back to 5 | Refused with the sentence above |
| Next bill after that | **`VM/26-27/48`** — did not repeat 47 |
| Prefix cleared | **`INV-0049`** — old format restored exactly |

### The other flags were false alarms, checked not assumed

- The four visibility toggles render from a registry, so their names appear in
  no component. Verified working in the browser earlier.
- `roundOffEnabled` is read in an API route, not `lib/`.
- `eInvoiceApplicable` is read by the e-invoice card.
- `/api/transactions/[id]/audit-trail` is called via a template literal.
- `docShareLink` is dead **on purpose** — the withdrawn share link. A test
  now asserts that absence, so restoring it means coming here and reading why.

### The guard that replaces the sweep

`settings-are-reachable-and-used.test.ts` names, for every invoice setting,
the file that consumes it. Adding a setting means adding a line saying what
reads it — and if you cannot, the setting does nothing and should not ship.

Deliberately a list rather than a directory walk: the walk produced five false
positives, and a sweep that cries wolf gets ignored, which is worse than none.

---

## Phase 7 — designs, and what checking them found (16 Aug)

Rahul, handing over 18 reference invoices: *"i want you to analyse that every
image should work properly with all the field which user will add."*

That instruction turned out to be worth more than the designs.

### What the references actually teach

Two read closely — a pharmacy bill and a transport bill. They share one
grammar with every other Indian invoice: **band → party cards → table with
the trade's own columns → terms left, totals right.**

The important detail is that **batch and expiry are real COLUMNS**, not a note
under the item name. That is the format an inspector reads down a page, and it
is what Phase 5's sub-line was standing in for.

### One new design, not two

**Dispensary** — batch and expiry as real table columns, compact rows.

A second, *Consignment*, was written and then **deleted**. Its only
distinguishing feature was a `metaStrip` flag, and that flag broke the
template contract: it would have let a design decide whether the bill's own
fields appear at all. A template composes the page; it may not remove a field
the shopkeeper asked for. Without the strip it was byte-identical to `ruled` —
an existing guard said so — and shipping a duplicate to claim one more design
is padding.

`extraColumns` survives the same rule because it changes **where** a field is
drawn, never **whether**.

### The guard, and the four bugs it found

Every template is rendered against a deliberately hostile invoice — every
toggle on, three custom columns per line, 34 lines, long names, terms, bank,
signature, QR — on A4 **and** A5, and the PDF's own coordinates are read back
to prove nothing left the paper.

It found four real defects, none of them visible on screen:

1. **The footer ran off the bottom of the page** on four of eight templates. A
   long terms block plus bank details, on a bill whose items had filled the
   sheet, printed at y = −2mm, −5mm, −9mm. Gone. The item rows have paginated
   since Phase 2; this block never asked.
2. **The item table never fitted A5.** Every column position was a hardcoded
   millimetre figure chosen for A4 — AMOUNT sat 168mm out, on a 148mm-wide
   sheet. Every bill printed on a half sheet since Phase 2 had its rate and
   amount columns off the edge. I had checked the SHEET was the right size and
   not the table on it.
3. **The receiver's signature printed below an A5 page**, 7.6mm past the edge,
   whenever a payment QR was present.
4. **The batch number was silently truncated** on the default template when an
   item also had a description: the sub-line put the description first and
   clipped the rest. A batch number is a legal record; a description is a
   courtesy. Order reversed.

### And one caught before shipping

The PDF grew the column layout and **the preview did not** — so choosing
Dispensary changed the file and left the preview identical. That is the report
Rahul filed twice already, and it would have been a third. The preview now
lays out the same columns by the same rule.

### Honest note on the guards

Disabling the footer pagination fails six tests, so that fix is proven. The
bottom-block reservation is **defensive** — this suite does not independently
prove it, and it is not claimed to.

---

## Phase 7b — six more designs (16 Aug)

**Thirteen designs now.** Six added from the reference set, each mapped to one
of Rahul's images and each a structure not already in the list:

| Design | From | Suits |
|---|---|---|
| **Slate** | corporate consulting | services and B2B — no band, lots of air |
| **Ledger** | classic counter bill | daily trade — boxed cells, bold total bar |
| **Emerald** | green GST bill | hairline rows, the total carrying the weight |
| **Gold Leaf** | royal gold | jewellers — framed page, the one serif name |
| **Memo** | retail memo | least ink per bill, for printing all day |
| **Register** | Tally grid | stock-heavy trades — ruled throughout, batch/expiry as columns |

Every one was checked against the maximal invoice — all toggles on, custom
columns, 34 lines, A4 and A5 — before it could ship. **That test is why six
designs took an hour rather than a day.**

### The distinctness test was measuring the wrong thing

It compared TEXT POSITIONS, and reported the six new designs as duplicates.

But what makes one design look unlike another is a **filled band versus a
hairline rule**, **striped rows versus boxed cells**, **a solid total bar
versus an outlined panel** — all of which are fills and lines. None of them
moves a single word. So the test could not see the very thing it claimed to
check.

It had passed on seven templates by coincidence: those happened to differ in
density, which does move text. **I nearly reshaped six good designs to satisfy
a broken ruler.** It now compares the whole drawing stream — rectangles,
lines and text alike — and all thirteen are genuinely distinct.

### Note on the preview

The column layout in the preview was fixed in Phase 7, before that commit
shipped. Re-confirmed here: `ITEM | BATCH NO. | EXPIRY | QTY | RATE | AMOUNT`.

---

## Phase 7c — layout, style and palette pulled apart (16 Aug)

Rahul: *"the design and layout is different."* He was right, and it is the
diagnosis this whole phase needed.

### What was wrong

What I had called a template was a muddle of three things:

- it carried **style** choices (striped rows, spacing)
- it *pretended* to carry **layout** choices
- and the layout was **hardcoded and identical for all of them**

So the one thing that makes a bill look unlike another — the bones — was the
one thing no design could change. Thirteen designs, one bill, thirteen times.
His verdict, *"almost every design looks the same and useless"*, was accurate.

### Three vocabularies now

| | | |
|---|---|---|
| **Layout** | `invoice-layouts.ts` | where blocks sit — frame, header kind, meta strip, party block, columns, table fill, totals |
| **Style** | `invoice-styles.ts` | how they are dressed — rules, zebra, density, line weight, title face, ornament |
| **Palette** | `invoice-themes.ts` | accent, soft tint, ink |

**10 layouts × 6 styles × 15 palettes.** Guards hold the separation: a layout
that grows a colour, or a style that grows a block, fails a test — because the
day they merge again is the day the next ten designs look like one.

### Presets, then customise — Rahul's choice (c)

Ten named presets, each a real reference bill: Classic Indigo, Royal Gold,
Tally Maroon, Pharmacy Green, Transport Rust, Corporate Slate, Formal Purple,
Counter Memo, Bill Book Blue, Boutique Teal.

A preset is a **shortcut, not a fourth thing** — it writes layout, style and
palette and the renderer never reads it. `Setting.invoicePreset` exists only so
the picker can show which is selected, and clears the moment anything is
changed by hand, because at that point "which preset am I on" honestly has no
answer.

### Seven more palettes

Rahul: *"you have added very less colour and most are either similar or not
good."* Fair — eight single accents, several of them neighbours on the wheel,
is not a colour system.

Added Ocean, Maroon, Forest, Rust, Plum, Graphite and Prussian, each a **three
-colour combination**: one accent, one soft tint for fills, one neutral ink.
The tint is what makes a bill look considered rather than coloured-in — it is
the cream behind the gold on the Jaipur reference.

### Illegal pairs fall back rather than printing broken

An ornament needs a frame; eleven GST columns do not fit an airy style or an
A5 sheet. A shopkeeper can reach an illegal pair by customising, so the style
falls back to its nearest legal sibling and the bill still looks deliberate.

### Still to do — recorded from Rahul's requirements

1. **The renderer** must draw from the layout spec. Nothing above changes a
   printed bill yet; this is the foundation, and it is honest to say so.
2. **Multi-page rules.** Totals, bank, terms and signature belong on the LAST
   page, once. Pagination currently pushes them to a new page without
   guaranteeing they are last.
3. **Legibility.** Column positions scale for A5; font sizes do not — so text
   can overflow a narrowed column. Measurable, and untested today.
4. **The 8-item PDF threshold should be measured, not fixed** — decide per bill
   whether the picture can hold it.

---

## Phase 7d — the renderer draws from the layout (16 Aug)

The old template system is **deleted**. `invoice-templates.ts` and its test are
gone; the PDF, the preview, the picker and the settings API all read the three
new vocabularies.

### Royal Gold — three of six blocks built

Built and proved:

- **Double frame with corner ornaments.** Two thin rules and four L-brackets,
  drawn as lines so they scale with the sheet and need no font. On the Jaipur
  reference this is the entire premium cue.
- **The twelve-column GST breakup** — No, Description, HSN, Qty, Unit, Rate,
  Disc %, Taxable, CGST %, SGST %, Cess %, Total. Offered only on A4 with a
  dense style; `layoutFitsPaper` and `styleFitsLayout` refuse the rest rather
  than printing off the page.
- **Empty ruled rows padding the table**, and only while they fit on the page —
  padding that spilled onto a second sheet would be paper the shopkeeper pays
  for.

Measured against Classic on the same bill: **720 drawing operations against
104**, 299 lines against 18, and DISC/TAXABLE/CESS columns that Classic has no
concept of. It is a different page, not a recolour.

### Still to build for Royal — stated plainly

- The **boxed invoice-details card** top right (currently plain right-aligned)
- The **full-width ruled "Bill To" strip** (currently the one-card block)
- **Totals as a ruled mini-table** — `ruled` currently falls through to the
  outlined panel

Three of six. The next session finishes those, and only then moves to the
second design — Rahul's instruction was one at a time, verified.

### Also carried forward

Multi-page rules (totals/bank/terms/signature on the LAST page, once), font
sizes not scaling with A5 columns, and measuring the PDF threshold per bill
rather than fixing it at 8 items.

---

## Royal Gold — all six blocks (16 Aug)

| Block | Proved by |
|---|---|
| Double frame + corner ornaments | reading the PDF operators — L-arms at (8,289)→(17,289) and (8,289)→(8,280) |
| Boxed invoice details, no band | `TAX INVOICE - ORIGINAL`, `Invoice No`, `Place of Supply` on the page |
| Full-width ruled Bill To strip | `Bill To` on the page |
| Twelve GST columns | `DESCRIPTION`, `DISC`, `TAXABLE`, `CESS` on the page |
| Empty ruled padding rows | 304 line operators against Classic's 18 |
| Totals as ruled cells | a bordered cell drawn per totals line |

### One honest gap

**There is no automated check for the frame itself.** I tried three and all
three failed to discriminate:

- counting lines — passed with the frame deleted, because 150-odd remain from
  the ruled cells
- looking for a page-sized rectangle — jsPDF strokes the frame rather than
  emitting one
- looking for any drawing in the outer margin — found none, although the
  ornament arms are provably there

Rather than ship a fourth guess, the test file says so. The frame is verified
by reading the operators by hand. **A guard I cannot make fail on broken input
is a comment with a green tick beside it**, and this codebase's history has
enough of those.

The other three Royal checks do discriminate: they assert text only those
blocks emit.
