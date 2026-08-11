# EkBook — read this before doing anything

This file loads automatically. It is not background reading; it is the procedure.

**Why it exists:** I broke four of my own rules in one day, and the same one
twice. The rules were not wrong — I worked from memory instead of opening
files, and produced no evidence that I had followed anything. So Rahul became
the person who caught my mistakes. That is the defect this file fixes.

**The principle: the output must PROVE the process ran.**

---

## GATE 1 — before any work. Post this in the reply.

1. **Open** `C:\Users\rjrah\Downloads\EKBOOK-MASTER-PLAN-V2.md` — read §0 and §4.
2. **Open** `EKBOOK-TASKLOG.md` — where does this task sit? Does anything logged
   (#1–#59) overlap? Overlapping work is merged, never duplicated.
3. **Open** `EKBOOK-OPERATING-MODEL.md` and `EKBOOK-RULEBOOK.md`.
4. **Write these three answers in the reply, before any edit:**

   - **Serves §0 how?** *"Every competitor built a register. We build a
     compliance engine."* If the honest answer is "it doesn't, it makes the
     register nicer" — **say so**. That is not a refusal; it is the sentence I
     failed to say for a week.
   - **Rules that apply to this task**, named.
   - **Research done** — what already exists? Never design from memory. A gap
     taken from a competitor's list is a claim about *them*, not about us.

**Do not skip to code. Research first, every time.**

---

## GATE 2 — while working

- **One vocabulary.** Before adding any list, map, regex or type: does one
  already exist? Two lists describing one thing **will** disagree. Four of my
  bugs were exactly this.
- **Read the stored fact; never infer it from a balance sign.** Two bugs.
- **Refusals go where the CALLER checks them, never in a parser.** `parseAsk`
  returning null means "no rule matched" — a model answers it anyway. I made
  this mistake **twice in one day**.
- **Guard the class, not the instance** — and prove it by reintroducing the bug
  and watching it fail.
- Small phases, done perfectly. Caution over speed.

---

## GATE 3 — before reporting. Run it, publish failures, THEN FIX THEM.

- [ ] `npm run verify` green · pushed · deployed
- [ ] **Screenshot taken — I have LOOKED at it**
- [ ] Real UI, not just API calls · both 375px and 1280px
- [ ] Numbers checked by hand against raw rows
- [ ] **Created the data and re-asked — no conclusion rests on a ₹0 answer**
- [ ] Every condition: empty / one / many / filtered / wrong filter / other
      period / after delete
- [ ] **Tapped every row and button**
- [ ] Test data deleted, books confirmed figure by figure
- [ ] Every issue **FIXED or LOGGED (#n)** — never mentioned and dropped
- [ ] Tasklog updated **in the same commit**
- [ ] Rulebook updated if I broke or learned a rule

**Reporting a miss is not fixing it. Go and do the missed items before
reporting.**

---

## EVERY REPORT CONTAINS

1. What it serves (§0), one line
2. What I did, in simple words
3. **Every issue: FIXED / LOGGED (#n) / NEEDS-APPROVAL — in the same sentence**
4. Gate 3 results **including what I failed and then fixed**
5. What I could **not** verify, explicitly
6. What's next, with a recommendation

---

## HARD RULES — no judgement call

| | |
|---|---|
| The AI never produces a number. It decides what was meant. |
| Every figure shows receipts that open the real record. |
| **Refusing beats guessing.** A wrong answer nobody notices never gets corrected. |
| Never invent a name. Ambiguity produces a choice, never a pick. |
| Permissions server-side, never by a model. |
| Nothing that changes data happens without confirmation. |
| A deleted record stays deleted, everywhere. |
| **No real users yet.** "Affects every user" is not a priority argument — the plan is. |
| No AI-written queries · no prose summaries of finances · the ledger never leaves · no predictions dressed as facts · I never enter passwords. |

---

## PROJECT FACTS

- Two other agents work these repos — **rebase and check before pushing**.
- `npm run verify` = lint + typecheck + tests + build (same as CI). Must be
  green before pushing.
- Push and deploy directly. **Then verify in the browser — compulsory, before
  reporting.**
- Reports are `.md` files saved to `C:\Users\rjrah\Downloads\`, in simple words.
- Test data is authorised (not launched yet) — but say what was created and
  clean it up.
- **A stale bundle looks exactly like a bug.** Hard-reload before believing it.
- **I cannot verify on a real phone** (§4.2 requires it). Say "checked at mobile
  width", never "verified on mobile", and ask Rahul for a phone check.

---

## IF RAHUL CATCHES SOMETHING

That is a defect in this file. **Fix this file the same day**, under the cause
it belongs to — not as a new dated line at the bottom.
