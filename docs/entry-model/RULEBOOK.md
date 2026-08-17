# RULEBOOK — the entry-model programme

**Read this at the start of every phase. Update it at the end of every phase.**

This document exists because a ten-phase programme drifts. By phase 6 it is easy to be
solving an interesting problem that is not the problem, or to have quietly dropped a
constraint that was decided in phase 1. Everything below is either a decision the founder
made, a fact established by measurement, or a rule I committed to. None of it is
speculation — speculation goes in the phase reports, not here.

Last verified: **Phase 2 start, 17 Aug 2026**

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
| R9 | **Correct my own errors plainly** and keep going. | Two corrections already; both mattered. |

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

### Corrections I have already issued (do not repeat the original error)

1. **Unit conversion DOES exist** — `src/lib/units.ts` converts gm↔kg, ml↔ltr, cm↔m,
   dozen→pcs and normalises to the product's unit before money and stock maths.
2. **"Stock goes to −23" was wrong.** `box`/`packet`/`bag` have no conversion by design
   (the factor is per-product). Buying 1 box of 24 raises stock by **1** — under-counted,
   not negative.

---

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
| Chemist / pharmacy | Strips, **batch + expiry**, drug licence — the regulated data model |
| Cloth / garment | Metre and *than*, no barcodes, size×colour, the ₹1,000 rate split |
| Hardware / electrical | Sq ft, running foot, bundle, coil; loose and by weight |
| Restaurant / sweet shop | Recipes consuming raw stock; inventory ≠ what is sold |

---

## 8. PHASE LEDGER

| # | Phase | State |
|---|---|---|
| 01 | Field study at scale & standards research | ✅ Complete |
| 02 | Five trades, five catalogues | ▶ In progress — kirana account open, first-run captured |
| 03 | Catalogue acquisition (bill/PDF/Excel/barcode) | Blocked on supplier bill |
| 04 | The relevance engine (purpose + field switches) | Pending |
| 05 | Units, cess and CA-grade compliance completeness | Pending |
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
| Category is free text, producing junk categories | LOGGED |

---

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
