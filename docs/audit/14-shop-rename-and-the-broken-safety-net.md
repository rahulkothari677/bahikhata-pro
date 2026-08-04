# 14 — Shop rename, and the safety net that wasn't catching anything

**Date:** 2026-08-04
**Commits:** `e9915b9`, `fbd3ab9` (main app), `9973e39` (admin)
**Tests:** main 2706 / 135 suites · admin 330 / 26 files · **CI green for the first time in 8 commits**

---

## Part 1 — Shop rename (shipped)

### What you asked for

> "rename only for now, because it's important that the shop owner is allowed to change
> their shop name every time they want"

### What I found when I opened it

There are **two different shop names** in this app, and only one of them was editable:

| | Where it lives | What it affects | Editable before? |
|---|---|---|---|
| **Business name** | `Setting.shopName` | Invoices, GSTR-1, e-invoice IRN, WhatsApp messages | ✅ Yes, in Settings |
| **Shop label** | `Shop.name` | The Manage Shops card, multi-shop reporting | ❌ **No — nothing could change it** |

The default shop's label is copied from your business name **once**, at signup. Nothing kept
them together afterwards. So the real bug was worse than "can't fix a typo":

> Change your business name in Settings, and the Manage Shops card keeps showing the
> **old** name forever. The app disagrees with itself about what your shop is called, and
> neither screen can fix it.

### What I built

1. **A rename control** on each shop, edited inline (one short field — a popup on a phone
   hides the list you're renaming within).
2. **The business name now carries across** to the default shop, so the two stop drifting.
3. **One direction only, deliberately.** Renaming a shop does **not** rewrite your business
   name. That name is printed on invoices and GST filings — changing a tax document
   identity is not something a rename box in a shop list should do as a side effect.
4. **Name only.** GSTIN, address and state drive GST calculation and appear on filings.
   Changing those is a different action with different consequences.

### Verified live, in the browser, on your account

- Renamed "My Shop" → "Rahul Kirana Store" through the UI. Card updated, toast confirmed.
- **Checked the invoice name was untouched** — still "My Shop". The one-way rule holds.
- Changed the business name in Settings → the shop card followed. Staleness fixed.
- **Everything restored to "My Shop".** Your account is exactly as I found it.

Also fixed in passing: the shop-creation error swallowed the server's message, so hitting
the 3-shop plan cap said *"Failed to create shop"* — no way to tell a plan limit from an
outage. Same defect I fixed in the staff screens yesterday; third instance of that pattern.

---

## Part 2 — The part I'm less comfortable reporting

While surveying for the re-plan, I checked whether the automated checks were actually
running. Three of them weren't.

### 🔴 I broke CI eight commits ago and didn't notice

Every push since "The referral reward granted nothing" has **failed CI**. I never looked,
because I was running `npx jest` locally and seeing green.

The cause was my own test. It asserted the *admin* app's behaviour by reading the admin
repo across the filesystem — which works on my machine, where both repos sit side by side,
and can **never** work in CI, which checks out one repo.

Fixed: the guarantee now lives in the admin repo, enforced by the admin repo's own CI. The
local cross-check remains and skips when the sibling isn't there. Verified by moving the
admin folder away and re-running.

**What I've changed about how I work:** I now run all four CI steps locally — lint,
typecheck, jest, and a full production build — before pushing. Running only the tests is
what let this sit for eight commits.

### 🔴 The lint step has never linted anything

CI ran `npx next lint` — **a command removed in Next 16**. It parsed "lint" as a directory
name and exited with an error on every run since the upgrade. And it was marked
`continue-on-error`, so nobody ever saw it fail.

A gate that always passes is not a gate. This one had been reporting success while doing
nothing, for as long as the project has been on Next 16.

Now runs the real linter and blocks. Your application source was already clean — all 17
errors were in `scripts/`, dev-only Node files where `require()` is correct.

### 🔴 The browser tests have never run

The Playwright E2E job is gated on `if: github.event_name == 'pull_request'`. All work here
goes to main by direct push, so **the job has been skipped every single time.** Three specs
exist — login/create-sale, PDF export, bill scanning — and none has executed.

This one stings, because those are the only tests that drive a real browser against a real
build, which is exactly the class of bug 2,700 unit tests can't see. The staff-limit bug and
the plan-message bug were both found by hand in a browser.

**Logged as task #22** rather than fixed now: the specs haven't run in a long time and have
probably rotted against the current UI, so enabling them is its own piece of work with its
own failures to fix. I didn't want to bundle that into a rename.

### 🟡 A test that failed depending on what else was running

The admin suite had a test that passed alone and failed in the full run. It builds ten
million objects to reach a 5,000,000-row ceiling, and minted every id with
`${Math.random()}${i}` — five million float-to-string conversions on top. It sat just under
the 5-second default timeout, and adding **one unrelated test file** tipped it over.

A test whose result depends on machine load is not a gate, and this one guards a DPDP s.11
legal-completeness rule. Fixed with a cheap counter and an explicit timeout. The whole admin
suite got **faster** — 11s → 5.5s — and now passes three consecutive full runs.

### ✅ One thing that *is* working

The nightly reconciliation — the "does the whole ledger tie out?" job — **has been running
every night and passing.** 1 Aug, 2 Aug, 3 Aug, all successful. That's the single most
important automated check you have, and it's healthy.

---

## Why these four faults are the same fault

Every one of them is a **check that reported success while doing nothing**: a lint step that
couldn't run, an E2E job that never triggered, a test that couldn't pass in CI, a timing
test that passed by luck.

That is the identical shape as the product bugs found in report 13 — the staff limit that
enforced nothing, the referral reward that granted nothing. In both cases the system said
"fine" and nothing was capable of saying otherwise.

**The lesson I'm taking forward: a green check is a claim, not evidence.** For the rest of
this audit I verify that each check can actually fail before I trust it passing — which is
already why I break every fix I write and confirm the test goes red.
