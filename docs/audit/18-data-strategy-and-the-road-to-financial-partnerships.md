# 18 — Data strategy, and the road to financial partnerships (Part 2 of 2)

**Date:** 2026-08-04
**Companion:** report 17 — compliance verification
**Purpose:** what to collect, what it's worth, and the legal path to monetising it

> Not legal advice. The regulatory path below is real and well-documented, but
> every step needs a fintech lawyer. I have flagged where.

---

## First — a correction to the premise, because it changes the strategy

You said:

> "only data can make it billion dollar company because once i would have the data
> then i can tie up bank and insurance company"

**Half right, and the wrong half is expensive.**

Here is the thing about India specifically: the government has spent a decade
**deliberately destroying data moats.** That is the entire point of India Stack.

- **Account Aggregator** exists so that a customer's bank data flows to *whoever
  they consent to*, instantly. If a lender wants your users' bank data, they can
  get it directly with the user's consent. They do not need you.
- **GSTN** already holds every GST invoice in the country. Lenders pull GST data
  through AA today. They do not need you for that either.
- **DPDP purpose limitation** means data collected to run a ledger cannot lawfully
  be repurposed for credit scoring without fresh, specific consent.

**So "hoard data, then sell access" is not a viable Indian strategy.** It is
illegal under DPDP, it is unnecessary given AA, and it is the exact business model
that got dozens of lending apps banned from Play in 2021.

### What is actually valuable

Ask why a bank would pay you, when they can get the data themselves. Three answers,
and none of them is "you have data":

1. **Distribution.** You are inside the shopkeeper's daily workflow. A bank cannot
   buy attention at the moment a shopkeeper realises they are short on working
   capital. **You can be there at that moment.** That is worth real money per
   qualified lead.

2. **Data the bank genuinely cannot get.** AA gives them bank statements. GSTN
   gives them filed returns. Neither shows **receivables ageing** — who owes this
   shop money, how old, how reliably they pay. Your udhaar book is *the* dataset
   for cash-flow lending and **it exists nowhere else.** This is your real asset.

3. **Trust and conversion.** A loan offer inside an app a shopkeeper already trusts
   converts many times better than a cold call. Lenders pay for conversion.

**The reframe:** you are not building a data warehouse to sell. You are building
the **origination surface** for MSME credit — with consent, per purpose, at the
moment of need. That is a legal business, a defensible one, and it is worth far
more than selling data ever could be.

---

## The asset you already have and are not capturing

Your `Party` + `Transaction` + `Payment` tables can already answer questions no
lender can answer from AA or GSTN:

| Signal | Where it lives now | Why a lender wants it |
|---|---|---|
| **Receivables ageing** | party balances + payment dates | The #1 cash-flow lending input. Invisible to AA |
| **Customer concentration** | sales grouped by party | One customer = 60% of revenue is a risk flag |
| **Collection discipline** | invoice date → payment date | Predicts repayment behaviour better than a credit score |
| **Seasonality** | 12+ months of daily sales | Sizes a working-capital line correctly |
| **Supplier payment behaviour** | purchase + payment history | Shows whether they honour obligations |
| **Margin trend** | you already compute `grossProfit` | Distinguishes growth from discounting |

**None of this requires collecting anything new.** You already have it. What you
lack is (a) consent to use it for this purpose and (b) the packaging.

---

## What to add — ranked by value per unit of legal risk

### 🟢 Tier 1 — add now, low risk, high value

1. **Consent architecture, before any feature needs it.**
   A `ConsentGrant` table: purpose, scope, granted-at, expires-at, withdrawn-at,
   evidence-of-grant. Purpose-specific and revocable, as DPDP requires. Build this
   *first* — retrofitting consent onto an existing dataset is the single most
   expensive mistake in this space, and I would rather you spend a week on it now
   than a year on it later.

2. **A derived, opt-in "Business Health" score, shown to the shopkeeper first.**
   Computed from data you already hold. Give it to *them* — it is genuinely useful
   ("your receivables are ageing", "one customer is 60% of your sales"). It builds
   the habit and the trust, and it means the underwriting signal is already
   computed and validated by the time a lender wants it.
   ⚠️ Show it as *business health*, not a credit score. A "credit score" invites
   CIC-regulation questions you do not want yet.

3. **Structured receivables ageing** (0–30 / 31–60 / 61–90 / 90+ buckets).
   Useful to the shopkeeper on its own. Also the exact shape a lender needs.

4. **Verified identity signals you already touch** — GSTIN validation status,
   UPI ID, business vintage. Cheap, and they raise lead quality substantially.

### 🟡 Tier 2 — valuable, needs consent design first

5. **Bank statement analysis.** You already store `BankStatement`. Today it is
   uploaded manually — which is exactly the flow regulators dislike. **Move this to
   Account Aggregator** when you can: consent-based, revocable, auditable, and it
   removes you from holding raw account numbers.

6. **GSTR filing history as a health signal.** On-time filing is a strong credit
   signal. You already compute GST returns.

7. **Purchase-side supplier data** → supplier financing and trade credit later.

### 🔴 Tier 3 — do not touch until the legal structure exists

8. **Anything called a credit score, shared with a third party.** Your previous
   agent removed exactly this and was right to.
9. **Selling or sharing customer (A2) data in any form**, including "anonymised
   aggregates" — re-identification risk in small-merchant data is high, and the
   consent basis is absent.
10. **Any in-app lending feature** before the RBI listing exists (see below).

---

## The regulatory path to bank and insurance revenue

There are three models. They differ enormously in cost and risk.

### Model A — Referral / lead generation (start here)
You surface an offer; the lender does everything else. You are paid per qualified
lead or per disbursal.
- **You need:** explicit, purpose-specific consent to share; a contract with the
  lender; clear disclosure that you are not the lender.
- **You do NOT need:** an NBFC licence, RBI registration, or to be an LSP.
- **Realistic revenue:** ₹500–3,000 per disbursed loan. At 10,000 active
  shopkeepers with 5% annual uptake, that is modest — but it is *this quarter*
  money, and it validates demand before you spend on licensing.
- **Start here.** It tells you whether lenders actually want your leads, which is
  the only question that matters before investing in Model B.

### Model B — Lending Service Provider (LSP) to a Regulated Entity
You run origination and servicing UX; an NBFC/bank holds the loan on its book.
This is the model most Indian fintechs use.
- **You need:** an RE partner contract, compliance with **RBI Digital Lending
  Directions**, **Key Fact Statement** at offer stage, no dark patterns, a
  grievance mechanism, and **your app listed on the RBI's DLA register**.
- **Play Store:** listing on the RBI DLA register is a **precondition** for
  publishing loan features in India — existing apps had until 28 Jan 2026. Get the
  listing *before* you ship the feature, not after.
- **Realistic revenue:** 1–3% of disbursed value. This is where the money is.

### Model C — Financial Information User under Account Aggregator
Registered FIU pulling bank/GST data with consent through an AA.
- **You need:** FIU registration, consent-management per DPDP, **7-year audit
  trails**, IT security compliance. As of Dec 2025 there were ~410 registered FIUs
  and 17 licensed AAs, so this is a well-trodden path, not frontier work.
- **Worth noting:** your admin app already has tamper-evident audit chains and
  retention logic. You are closer to the audit-trail requirement than most.

**Insurance** follows the same shape: start as a referral partner; an IRDAI
corporate-agent or broker licence is required to do more.

---

## Suggested sequence

**Now → 3 months (foundation)**
- Fix the three defects in report 17. Non-negotiable — they are cheap and they are
  the ones that get you removed from Play.
- Build the `ConsentGrant` architecture.
- Ship receivables ageing + Business Health to the shopkeeper. No third party yet.

**3 → 9 months (prove demand, hit the deadline)**
- **DPDP full compliance by 13 May 2027.** Work backwards from that date.
- Launch Model A with one lender. Measure conversion honestly.
- Instrument which signals actually predict approval.

**9 → 18 months (scale, if the data says so)**
- If Model A converts: pursue LSP status and the RBI DLA listing.
- Evaluate FIU registration for AA-based bank data.
- Consider insurance referral as a second line.

**Throughout**
- Every new data field gets a written purpose and a consent basis *before* it is
  collected. This is the discipline that decides whether you are acquirable or
  radioactive at Series B — acquirers' diligence teams look at exactly this.

---

## The honest risk

The failure mode for this plan is not regulatory. It is **trust**.

Your users are shopkeepers putting their real books — and their customers' names
and phone numbers — into your app. The moment they suspect the ledger is a
data-collection front for lending, you lose the ledger, and with it everything
downstream.

So the ordering matters more than the features: **be a genuinely excellent ledger
first, and let the financial products be something users ask for.** Every part of
this plan works better from that position, and none of it works without it.

That is also why the rest of this audit matters to the billion-dollar goal, not
just to correctness. A ledger that quietly gets the numbers wrong — deleted sales
still counted, GST in the wrong month, a backup that cannot restore — destroys
exactly the trust this entire strategy is built on.
