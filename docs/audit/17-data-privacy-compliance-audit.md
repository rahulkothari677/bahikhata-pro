# 17 — Data & privacy compliance audit (Part 1 of 2)

**Date:** 2026-08-04
**Scope:** what EkBook collects today, whether it is lawful, and what is misstated
**Companion:** report 18 — the data strategy for financial partnerships

> **I am not a lawyer.** This is an engineering-grade verification: I compared what
> your privacy policy *says* against what your code *does*, and both against the
> published requirements. Every finding below is a verifiable fact about your
> codebase. Take the conclusions to a lawyer for sign-off — especially anything
> touching lending.

---

## The headline

**Your previous agent did genuinely good work.** The consent model, the removal of
the credit-score pipeline, the break-glass design, the retention logic for closed
accounts — these are not box-ticking. They show someone who understood the law.

**But three claims in your privacy policy are not true of your code.** A privacy
policy that misdescribes your actual practice is itself the violation, regardless
of how good the underlying engineering is — and these are the easiest thing in the
world for a regulator or a Play reviewer to check.

---

## Part A — What EkBook actually collects

I inventoried every model in the schema. Four distinct categories, with very
different legal treatment:

### A1. The shopkeeper's own data (your Data Principal)
Email, name, phone, password hash, shop name, GSTIN, address, state, UPI ID, logo.
**Basis:** contract/consent. Straightforward.

### A2. The shopkeeper's *customers'* data — **the important one**
`Party` holds name, phone, email, GSTIN, address for every customer and supplier
your users enter. `Transaction` holds `payeeName`, `payeePhone`.

**These people have never heard of EkBook.** They did not consent to you. This is
third-party personal data, and it is the single biggest structural question in
your compliance posture.

The standard reading: the **shopkeeper is the Data Fiduciary** for their customer
list, and **EkBook is the Data Processor** acting on their instructions. That is
defensible and it is how every ledger/CRM works — *but it only holds while you
process that data solely on the shopkeeper's instructions for their purposes.*

**The moment you analyse customer data for your own purposes — scoring, insights,
selling aggregate intelligence, training models — you become a Fiduciary for
people who never gave you consent.** Report 18 covers how to build on this
lawfully. Flagging it here because it is the line that decides whether your
long-term plan is legal.

### A3. Financial data
`BankStatement.accountNumber`, `BankTransaction`, `Gstr2bImport.supplierGstin`.
Bank account numbers are "significant financial account data" under Play's 2026
rules — see Part C.

### A4. Telemetry
PostHog analytics, `AiUsageLog`, `AuditLog.ip`. Consent-gated (I saw the consent
dialog fire in the browser this session, and it defaults to nothing).

---

## Part B — 🔴 Three things your policy says that your code does not do

### B1. You disclose one AI provider. Your code uses three.

Your policy says:

> "Groq (AI): Processes bill images for OCR (images deleted after processing)"

Your code (`src/app/api/scan-bill/route.ts`) runs a fallback chain in this order:

1. **Google Gemini** — `generativelanguage.googleapis.com` — **the primary**
2. **OpenAI** — `api.openai.com`
3. Groq

So the provider you actually send almost every bill to — **Google** — is not named
anywhere in your policy, and neither is OpenAI.

**Why it matters more than it looks:** those bill images contain your users'
*customers'* names, phone numbers, GSTINs and amounts (category A2). You are
sending third-party personal data to two processors you have not disclosed. Google
Play's July 2026 update explicitly extended the User Data policy to third-party AI
integrations.

**Fix:** name all three, with the actual roles. One paragraph.

### B2. "Images deleted after processing" — they are never deleted.

`deleteBillImage()` exists in `src/lib/cloudinary.ts`. Its own comment says
*"when transaction is deleted"*. I traced every call site: it is invoked from
**exactly one place** — the shop-logo route, to replace an old logo.

It is **never** called after OCR. It is **never** called when a transaction is
deleted. Every bill image any user has ever uploaded is still on Cloudinary.

### B3. Deleting your account does not delete your bill images.

`src/app/api/account/delete/route.ts` — the docblock promises it removes
*"All bill images from Cloudinary"*. The implementation, in its own words:

```
// 2. Delete bill images from Cloudinary (best-effort, currently a no-op)
// TODO: Track publicIds in the DB for precise deletion.
```

The database rows are genuinely hard-deleted — that part works well. But the
images survive **forever**, and they contain both the shopkeeper's and their
customers' personal data.

This is the most serious of the three, because it defeats the right to erasure
(DPDP s.12) and Google Play's account-deletion requirement simultaneously.

**Fix:** store the Cloudinary `publicId` on the row when you upload — you already
have the value, you just discard it. Then deletion becomes precise and cheap.
This is a small change and I'd do it first.

---

## Part C — Gaps against DPDP Rules 2025

The DPDP Rules were **notified 13 November 2025** with an 18-month runway:
**full compliance by 13 May 2027**. That is roughly **nine months from today.**
This is not a someday problem.

| Requirement | Status | Note |
|---|---|---|
| Notice of purposes | ✅ Good | Clear, itemised, plain language |
| Consent for telemetry | ✅ Good | Opt-in, and genuinely defaults to off |
| Right to access / portability | ✅ Good | Full JSON export exists and works |
| Right to correction | ✅ Good | Editable in-app |
| Right to erasure | 🔴 **Partial** | DB yes, images no (B3) |
| Withdraw consent | ✅ Good | Analytics toggle |
| **Grievance officer named** | 🔴 **Missing** | Only `privacy@ekbook.app`. DPDP requires a named grievance mechanism with published contact details |
| **Retention schedule** | 🟡 **Vague** | "kept until you delete it" — but you *also* retain closed accounts for GST s.36. Both are true; the policy states only one |
| **Children's data** | 🔴 **Absent** | DPDP has strict child provisions (verifiable parental consent, no tracking/targeted ads). Even if you don't target children, you need a stated position |
| **Breach notification (72h)** | 🟡 **Unverified** | I found no documented breach-response runbook |
| Processor list | 🟡 **Incomplete** | See B1 |
| Cross-border transfer | 🟡 **Unstated** | Neon/Vercel/Cloudinary/OpenAI process outside India. DPDP permits this except to restricted countries, but the notice should say so |

### The retention contradiction worth resolving

Your policy tells the user "delete all your data anytime". Your admin app
implements `computeRetentionUntil()` and **deliberately retains books for the
GST s.36 72-month period** after an admin closes an account — with a well-reasoned
comment explaining that destroying them exposes the *shopkeeper* to penalties.

That reasoning is correct. But you now have **two contradictory deletion
semantics**: user-initiated delete destroys everything immediately; admin-initiated
closure retains for six years. And the policy describes only the first.

This needs a product decision, not just a wording fix. My recommendation is in the
"What I'd do" list below.

---

## Part D — Google Play

Two 2026 policy changes land directly on you:

**D1. Government IDs and financial account data.** Apps collecting Aadhaar/PAN/
passport **or significant financial account data** now face additional verification,
must demonstrate a legitimate business reason, and must implement specific security
requirements including end-to-end encryption. You store `BankStatement.accountNumber`
and GSTINs. **Action:** confirm your Data Safety declaration covers this honestly,
and be ready to evidence the business reason.

**D2. Third-party AI.** The User Data policy now explicitly covers third-party AI
integrations — disclosure, limited use, consent. This is B1 again, from Play's side.

**D3. If you ever add lending — read this before writing a line of code.** Only
apps on the RBI's *"Digital Lending Apps deployed by Regulated Entities"* list may
publish personal-loan features on Play in India. Existing apps had until
**28 January 2026** to get listed. There is no grace period for new entrants: the
RBI listing comes **first**, the feature second. Report 18 covers the path.

---

## What I'd do, in order

**This week — cheap, and closes the worst gaps:**

1. **Store Cloudinary `publicId`** on upload, then make deletion real in both the
   transaction-delete and account-delete paths. Fixes B2 and B3 together.
2. **Name Gemini and OpenAI** in the policy. One paragraph.
3. **Name a grievance officer** with a real contact route. DPDP requires it.

**This month:**

4. **Write the retention schedule** and reconcile the two deletion semantics.
5. **Add a children's-data section**, even if it just states you don't knowingly
   collect from under-18s and what you do on discovery.
6. **Re-check the Play Data Safety form** against the actual processor list.

**Before May 2027:**

7. **Breach-response runbook** with the 72-hour clock built in.
8. **Data Processing Agreements** with Neon, Vercel, Cloudinary, Google, OpenAI,
   Groq, PostHog — you are relying on them being "GDPR/DPDP compliant" in your
   policy, which is a claim you should be able to evidence.
9. **Decide the A2 question** (customer data) deliberately, in writing, before any
   feature analyses it. This one is architectural and gets expensive to reverse.

---

## Credit where it is due

I want to be clear that this codebase is in **better** privacy shape than most
startups at this stage. Specifically good:

- `CommunicationPreference` — absence of a row means **no** consent. Silence is not
  opt-in. That is the correct reading of both DPDP and TRAI, and most teams get it
  backwards.
- `CreditScoreCache` was **removed**, with a comment naming exactly what would be
  required to bring it back (merchant consent, NBFC contract, CIMS registration,
  KFS at offer). Someone chose not to ship a regulatory liability. That judgement
  is worth more than any amount of remediation.
- The activity feed masks PII (`A•••• P••••`) rather than showing founder-visible
  names.
- Account closure retains books for the statutory period *because destroying them
  would harm the shopkeeper* — that is thinking about the user's legal position,
  not just your own.

The three defects in Part B are real and should be fixed. They are also all
**gaps between documentation and implementation**, not design failures — which is
exactly the class of bug this whole audit keeps finding.
