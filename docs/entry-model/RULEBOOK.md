# RULEBOOK — the entry-model programme

**Read this at the start of every phase. Update it at the end of every phase.**

This document exists because a ten-phase programme drifts. By phase 6 it is easy to be
solving an interesting problem that is not the problem, or to have quietly dropped a
constraint that was decided in phase 1. Everything below is either a decision the founder
made, a fact established by measurement, or a rule I committed to. None of it is
speculation — speculation goes in the phase reports, not here.

Last verified: **Phase 5 complete, 17 Aug 2026**

---

## 1. THE PURPOSE (never lose this)

Build the entry system for an Indian ledger app that aims to be a market-leading company —
one that a shopkeeper still chooses in five years, and that a **chartered accountant is
willing to stake their advice on**.

The single sentence that decides whether a design is right:

> **A shopkeeper with 2,000 products, mid-rush, must never think that pen and paper would
> have been faster.**

If a proposal does not move that sentence, it is not the work.

### The 5-year bet (founder, phase 1 review)

Within 1–2 years most people will work by **giving a command** and having it done. The
design must be built on that foundation from the start — not retrofitted. Every feature
added must be drivable by a command on the day it ships.

---

## 2. STANDING RULES (from the founder, still in force)

| # | Rule | Why it exists |
|---|---|---|
| R1 | **Browser-verify after every deploy.** Never ask permission first. | Code-correct and test-green have repeatedly hidden real defects this session. |
| R2 | **Say FIXED or LOGGED explicitly** for every finding. | Ambiguity about what is done has burned us. |
| R3 | **Explain risk in simple words, then recommend.** | The founder decides; I make the choice clear, not the jargon. |
| R4 | **One bug found ⇒ assume siblings exist.** Sweep the class. | Every single-instance fix this session had siblings. |
| R5 | **Fetch before every push.** Another agent shares these repos. | Avoids clobbering. |
| R6 | **No shortcuts in verification.** A check needs a control that would differ on failure. | A shortcut check produced a false "deploy landed" this session. |
| R7 | **Test on fresh data, not old rows.** | Old rows hide the bug that only new data triggers. |
| R8 | **Surface blockers immediately.** Do not wait silently. | A silent wait reads as being stuck; the founder can often clear it in seconds. |
| R9 | **Correct my own errors plainly** and keep going. | Four corrections now; all mattered. |
| R10 | **Never assert a defect without reproducing it.** | I claimed the party picker was broken; it is not. Being right by luck is not a process. |
| R11 | **Record where every fact came from** — measured in the app, read in the code, or supplied. Supplied material is a hypothesis until grounded. | Six supplied bills were AI-generated; I had described them as genuine. |
| R12 | **End every task with a paste-back prompt** for the next task, which re-arms these rules. | The founder's mechanism against drift over a long programme. Format in §12. |
| R13 | **Re-read the phase outline (§8) at the start and end of every phase**, and IMPROVE it with what was just learned. The plan is a living document, not a contract. | "That's how great product is built" — founder, Phase 2 review. |

### My own hard lines (not negotiable, even on demo data)

- I do not create login accounts and do not handle passwords or 2FA codes.
  → The founder creates accounts and signs in; I work in whatever is open.
- The PAT is used only in a non-persisted remote URL and is redacted from all output.
- Destructive or outward-facing actions get confirmed first.

---

## 3. DECISIONS ALREADY MADE (do not silently revisit)

| Decision | Made by | When |
|---|---|---|
| Full restructure is authorised — not a quick fix | Founder | Phase 1 review |
| Scope is **all** functions a small/medium shop needs, CA-grade — not just cess | Founder | Phase 1 review |
| Five trades, my choice, to maximise unit/feature coverage | Founder | Phase 1 review |
| Five separate **logins** (multi-shop is not usable — see §5) | Founder | Phase 1 review |
| Real supplier bill to be provided before Phase 3 | Founder | Phase 1 review |
| AI-command-first is the architectural foundation, not a feature | Founder | Phase 1 review |
| A rulebook, verified each phase, to prevent drift | Founder | Phase 2 start |

---

## 4. ARCHITECTURAL PRINCIPLES (the foundation everything must satisfy)

**P1 — Intent before screen.**
Every capability exists as a typed, callable operation *before* it exists as a UI. The
screen, the voice button, an AI agent and the tests all call the same operation. If a
capability can only be reached by replaying a user interface, it is not finished.

**P2 — Structured ambiguity, never a guess.**
When input is ambiguous ("Tata Tea" — 250g or 500g?), the system returns *a question with
options*. It must never pick one silently. Silent guessing is how an AI corrupts a tax
return.

**P3 — Provenance on every row.**
Every record carries who made it: person, voice, AI agent, or bill import — and which
instruction produced it. A CA must be able to see an AI made an entry, and why.

**P4 — Confirm the unusual, post the routine.**
Small, normal entries go straight through. A new party, an out-of-range amount, or a stock
move that would go negative asks first. Everything is reversible.

**P5 — Correctness comes from structure; speed comes from AI.**
AI finds and fills. AI never decides what lands on a tax invoice. Rate, HSN and quantity
resolve to definite values or the system asks.

**P6 — Nothing is silently truncated, ever.**
Established the hard way: the backup kept 200 of 307 invoices; the product picker hides 22
of 52 matches. Any list that is cut must say so.

**P7 — Progressive disclosure by trade.**
A shop is shown only the fields its trade needs, with everything else switchable on. A
cloth merchant must not meet HSN, cess and barcode in their first minute.

**P8 — Degrade to simple.**
Every structure must collapse cleanly for the simplest user. A tailor with one service and
no GST must see an app that looks built for them.

---

## 5. ESTABLISHED FACTS (measured, not assumed — cite these, don't re-derive)

### Measured in the live app at 721 products (Phase 1)

| Fact | Value |
|---|---|
| Catalog payload per sale screen | 370 KB |
| Fetch time, good connection | 475 ms |
| Search "tata": matches / shown / **hidden with no indication** | 52 / 30 / **22** |
| Products hidden when picker opens | 691 of 721 |
| Category filter chips | 20 |
| Fields on the Add Product form | 16 (only `name` required) |

### Structural facts

- `Product` is flat. **No Brand, no Variant, no pack-size model.** Pack size lives in the
  name as free text, so `1kg` sorts before `100g`.
- Duplicate products are permitted. Confirmed live: two `Tata Tea Gold 500g` rows,
  49 @ ₹285 and 20 @ ₹255.
- `category` is free text — 20 products produced 16 categories including `"5"` and
  `"GSTTEST"`.
- **Multi-shop is scaffolding only.** `shopId` exists on Product/Party/Transaction but
  `/api/products`, `/api/transactions`, `/api/payments` mention it **zero** times. Two
  shops share one merged catalog and ledger. UI says "Soon". → **Logged as a defect.**

### Compliance facts

- **Cess: no rate field exists.** `csamt` is stored with nothing to divide it by; nothing
  writes a non-zero value. Tobacco, pan masala, aerated drinks cannot be billed correctly.
- **UQC: 38 codes are mandatory** on GSTR-1 B2B, e-invoice and export lines. The app maps
  units to UQC only inside `e-invoice.ts`, defaulting to `NOS`.
- **Units offered: 10** (`pcs kg gm ltr ml m cm box dozen packet`). Missing every
  trade-critical unit: strip, than, sq ft, running foot, bundle, quintal, bottle, pair.

### The central finding (Phase 2, from six real bills)

**Every real Indian bill puts the PACK inside the unit column.** `Strip (15 Tab)`,
`Bag (50 kg)`, `Sachet (21.8 gm)`, `250 g`, `Tin`. A shopkeeper does not think "15 tablets",
they think "one strip, which is fifteen". The app has one free-text unit string and a global
conversion table that refuses pack units because the factor is per-product.

**A per-product pack definition is the primitive to build.** The 15x chemist error, the box
that adds 1 instead of 24, and the pack sizes that sort as text are all this one gap.

Four dimensions the model needs, none of which exist today:
1. **Pack** — 1 strip = 15 tablets; stock always held in the base unit
2. **Lot** — batch/expiry on STOCK (also serial/IMEI, hallmark); enables FEFO and recall
3. **Attributes** — size/colour as ordered typed values, not words in a name
4. **Composition** — what a made item consumes (dish, sweet, stitched garment)

### Corrections I have already issued (do not repeat the original error)

1. **Unit conversion DOES exist** — `src/lib/units.ts` converts gm↔kg, ml↔ltr, cm↔m,
   dozen→pcs and normalises to the product's unit before money and stock maths.
2. **The party picker is NOT broken.** I asserted it had the same truncation bug as the
   product picker, without checking. It does not — `PartySelect.tsx:210` already prints
   "Showing 20 of N — keep typing to narrow it down." It is the MODEL to copy, not a defect.
3. **The supplied bills are AI-generated, not real invoices.** The founder confirmed this
   after I described them as "six genuine Indian invoices". Conclusions that rest only on
   those images must be re-grounded independently — see §5a.
4. **Cess is ABOLISHED, not merely unsupported.** Discontinued for most goods 22 Sep 2025 and
   abolished entirely 1 Feb 2026, replaced by a 40% GST slab. D-04 asked for a cess model;
   building it would have been building for a dead tax. The real defect is that no rate picker
   offers 40% (D-23). Lesson: **check whether the requirement still exists before designing
   for it.**
5. **"Stock goes to −23" was wrong.** `box`/`packet`/`bag` have no conversion by design
   (the factor is per-product). Buying 1 box of 24 raises stock by **1** — under-counted,
   not negative.

---

## 5a. DOMAIN KNOWLEDGE — Indian pharma distributor invoices
*(Source: published industry analysis of invoice extraction, Aug 2026. Independent of the
generated specimens. Grounds Phase 3.)*

- **PTR (Price to Retailer)** is the actual taxable base — **not MRP**. Confusing the two is
  the classic failure, and it cascades: wrong GST base → wrong purchase value → **inflated
  input tax credit claim → GSTR-2B mismatch**. That is a tax exposure, not a cosmetic error.
- **PTS (Price to Stockist)** exists alongside PTR; a distributor bill may show both.
- **Free goods carry NO GST** — free units are "not consideration" under GST. Tools that
  attribute tax to scheme quantities inflate the taxable base. My own earlier note on free
  goods covered the *costing* side and missed this *tax* side.
- **Schemes (10+1) are represented three different ways, with no standard:** a dedicated Free
  Quantity column; a separate zero-rate line below the paid line; or buried in the description
  text. An importer must handle all three.
- **9–12 columns per line** is normal.
- **Description collapse** is the main OCR failure: HSN, batch, mfg and expiry sit in the same
  horizontal band as a dense description, so generic extractors merge them into one blob.
- **Pharma HSN spans 3003, 3004 and 3006**, each with different GST rates — so tax must be
  captured per line, never averaged across the invoice.
- Lost batch data prevents expiry-driven compliance traces and **expired-stock ITC reversals**.

## 5c. COMPLIANCE THAT ALREADY EXISTS (verified Phase 5 — do not rebuild)

| Feature | State | Where |
|---|---|---|
| Reverse charge (RCM) | **Complete end to end** | UI checkbox → zod → `Transaction.isReverseCharge` → GSTR-3B 3.1(d) |
| E-way bill | **Complete** | `eway-bill.ts`, Rs 50,000 threshold, `ewayBillNeed()` |
| Composition scheme | **Complete** | rates incl. restaurant 5%, state limits, CMP-08, bill of supply |
| Advance tax | **Complete** | GSTR-1 11A/11B and 3B from one shared function |
| Blocked ITC | Present | `itcBlockedReason` on the transaction |
| E-invoice applicability | **Complete** | Rs 5 crore, "once crossed it stays" |

The compliance surface is **strong with a few sharp holes** — not thin. The remaining gaps are
the 40% slab, the pack ladder, UQC at entry, and a decision on specific duty.

### The pack ladder decision (Phase 5)

Compared three models. **Marg ERP** (the Indian pharmacy standard) uses TWO units plus a
conversion factor plus an explicit "allow loose/decimal" flag — not an arbitrary ladder.
**ERP UoM groups** (SAP/BC) add the insight that stock is held in a BASE unit with separate
purchase and sales units. **Chosen: base unit + one named pack, stock always in the base**,
with a box→pack factor asked once at purchase and remembered per supplier. An N-level ladder
was rejected as over-built: every extra level is somewhere a wrong factor can hide.

## 5b. A WORKING METHOD, EARNED THE HARD WAY

**Before designing a rule, look for where this codebase already solved it.** Three times now
the correct pattern was one file away from the broken one:

| Problem | Where the answer already lived |
|---|---|
| Silent list truncation | `PartySelect.tsx` — "Showing 20 of N — keep typing to narrow it down." |
| Extracted money must tie to the header | restore's quarantine of rows whose totals disagree with their items |
| What happens to a switched-off field | `api/custom-fields` DELETE — soft retire, values kept, re-create revives |

Checking first is cheaper than designing, and it keeps the app internally consistent — which
is worth more than any individual clever answer.

## 6. THE FOUR PROBLEMS, IN ORDER

Phase 1 established that this is not one problem. Solving them out of order wastes the work.

1. **Acquisition** — "how do my 2,000 items get in without typing?" *Nothing else matters
   until the catalog exists. This is the actual reason for the pen and paper.*
2. **Relevance** — "show me only what my kind of shop needs."
3. **Structure** — "show me one tea, not twenty-five rows of it." *(the Shelf Model)*
4. **Speed** — "the customer is standing here."

> The Shelf Model (first report) is answer **3**. It was presented as the whole answer.
> That was the error the founder caught.

---

## 7. THE FIVE TRADES AND WHAT EACH ONE TESTS

| Trade | The case it forces out |
|---|---|
| Kirana / general store | Volume, barcodes, pack sizes, cess, mixed GST rates |
| Chemist / pharmacy | Strips, **batch + expiry**, drug licence — **DONE, see D-15/D-16** |
| Cloth / garment | Metre and *than*, no barcodes, size×colour, the ₹1,000 rate split — **DONE, see D-17** |
| Hardware / electrical | Sq ft, running foot, bundle, coil; loose and by weight |
| Restaurant / sweet shop | Recipes consuming raw stock; inventory ≠ what is sold — **DONE, see D-13** |

---

## 8. PHASE LEDGER

| # | Phase | State |
|---|---|---|
| 01 | Field study at scale & standards research | ✅ Complete |
| 02 | Five trades, five catalogues | ▶ In progress — kirana account open, first-run captured |
| 03 | Catalogue acquisition (bill/PDF/Excel/barcode) | ✅ Complete — design done; real-photo accuracy still unmeasured |
| 04 | The relevance engine (purpose + field switches) | Complete |
| 05 | Units, cess and CA-grade compliance completeness | Complete |
| 06 | The entry surface, benchmarked | Pending |
| 07 | Purchase → inventory → sale as one motion | Pending |
| 08 | Mobile interaction design (real device) | Pending |
| 09 | The connected surfaces (parties, payments, reports) | Pending |
| 10 | Synthesis and migration | Pending |

---

## 9. DEFECTS FOUND ALONG THE WAY (not in the design scope, but real)

| Defect | State |
|---|---|
| Product picker hides matches with no indication (22 of 52) | LOGGED |
| Duplicate products permitted, splitting stock silently | LOGGED |
| Multi-shop unscoped — two shops share one catalog and ledger | LOGGED |
| Cess unsupported end to end | LOGGED |
| First run asks theme before trade; trade never asked | LOGGED |
| "Scan bill — auto-fill everything" never creates products | LOGGED |
| **No bulk product import exists at all** (~17h to type 2,000) | LOGGED |
| **Made goods cannot be sold correctly** — no recipe/BOM model | LOGGED |
| Unit field accepts any text; UQC degrades to NOS | LOGGED |
| Bill extraction asks for 7 fields; HSN/batch/expiry/MRP/PTR/pack/free absent | LOGGED |
| Scan cost per document is unbounded (usage limits count scans, not size) | LOGGED |
| Unregistered shop still asked HSN / GST rate / GST treatment | LOGGED |
| Field visibility exists for the printed bill, not the entry form | LOGGED |
| **40% slab missing from every rate picker — live under-charging** | LOGGED |
| Specific (per-quantity) duty cannot be expressed at all | LOGGED |
| GST rate list duplicated in five files | LOGGED |
| **Part-pack sale deducts whole packs — 15x stock error, silent** | LOGGED |
| Batch/expiry cannot attach to stock; no FEFO, no expiry guard | LOGGED |
| Sizes sort alphabetically (L, M, S, XL, XXL) | LOGGED |
| Mixed-unit bills print a meaningless total quantity | LOGGED |
| Category is free text, producing junk categories | LOGGED |

---

## 9a. IMPROVEMENTS ADDED TO THE PLAN (R13 — record each one)

| Phase | Improvement | Why, and when it was learned |
|---|---|---|
| 3 | Import must handle **three different scheme representations**, not one | Phase 2 research: no standard exists across distributors |
| 3 | Import must compute **landed cost** (free goods + apportioned scheme discount), never raw rate | Free goods make stock right and cost wrong, or vice versa |
| 3 | Import must read **PTR, not MRP**, as the taxable base | The classic failure; leads to inflated ITC and GSTR-2B mismatch |
| 3 | Accuracy must be measured on a **creased, skewed photo**, not a clean render | Every specimen so far is machine-perfect; the first real bill will not be |
| 5 | Add **PTR/PTS** to the price model alongside cost/MRP/sale | Three prices exist in pharma, the app models two |
| 5 | Free goods must be recorded as **zero-consideration**, no GST attributed | Free units are not consideration under GST |
| 9 | Copy `PartySelect`'s truncation pattern to `ProductPicker` rather than designing one | The correct pattern already exists in the codebase |
| 4 | Field visibility must switch per DOCUMENT TYPE too, not only per trade | A pharma import needs batch/expiry even if the sale screen hides them |
| 7 | Purchase → stock → payable is not a later integration; the import IS that motion | Phase 7 extends it rather than building it |
| 9 | Batch import requires **batch undo** | Fixing 2,000 wrong rows cannot be 2,000 taps |
| **NEW** | **Add a phase for AI cost & rate-limit economics** | Currently unowned; bill import makes it urgent (D-20) |
| 3 | The trade tile also selects the STARTER CATALOGUE — acquisition and relevance are one decision | Phase 4 |
| 5 | The trade tile selects the UNIT SET and pack vocabulary; units are per-trade, not global | Phase 4 |
| 5 | Cess visibility driven by WHAT IS STOCKED, not by a switch | Phase 4 |
| 6 | The entry surface must read fieldState() rather than hard-coding columns | Phase 4 |
| 9 | Reports and GSTR-1 must read HIDDEN values too | Phase 4 |
| **NEW** | **Add a phase for vernacular / language** — trade tiles are where it first bites | Phase 4 |

## 10. THE PRE-PHASE CHECK (run this before starting any phase)

1. Does the phase serve §1's sentence? If not, why am I doing it?
2. Which of the four problems (§6) does it address, and are the earlier ones done?
3. Does the design satisfy **every** principle in §4 — especially P1 (intent before
   screen) and P6 (nothing silently truncated)?
4. Am I about to re-derive something already in §5? Cite it instead.
5. Am I about to repeat a corrected error (§5)?
6. What would make this phase's conclusion **wrong**, and have I tested that?
7. Is anything blocking that the founder could clear in seconds? (R8)

## 11. THE POST-PHASE CHECK

1. Update §5 with what was measured, §8 with state, §9 with new defects.
2. Record any new founder decision in §3.
3. Record any correction I had to issue in §5.
4. Ask: has the purpose in §1 drifted? If the last two phases did not move that sentence,
   say so out loud rather than continuing.
5. **Improve the plan (R13).** What did this phase teach that changes a LATER phase? Record it
   in §9a and edit §8. A phase that taught nothing about the phases after it was probably too
   shallow.
6. **Write the paste-back prompt (R12)** for the next task, in the §12 format.

---

## 12. THE PASTE-BACK PROMPT FORMAT (R12)

Every task ends by handing the founder a block they can paste back to start the next one. It
must contain, in this order:

1. **The task** — one specific instruction, not a menu.
2. **What I must produce** — the deliverable, so "done" is unambiguous.
3. **The re-arming line**, verbatim:

> *Before you start: read `docs/entry-model/RULEBOOK.md`, run the §10 pre-phase check, and
> follow every rule in §2 — especially R6 (no shortcuts), R10 (never assert a defect without
> reproducing it) and R11 (record where every fact came from). Improve the phase plan per R13
> before you finish.*

The point is that the founder does not have to remember what I promised. The prompt carries
it.
