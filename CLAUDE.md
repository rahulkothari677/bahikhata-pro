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

### A tick requires evidence in this session, not intention

**I ticked "tasklog updated" without having edited the file.** Rahul asked; the
file still said `NOT STARTED`. A false tick is worse than a missed step,
because the whole point of publishing the checklist is that he does not have to
re-check it.

**So: no box is ticked from memory or intent.** Each tick names the evidence —
the command that ran, the file that was edited, the screenshot that was taken.
If I cannot name it, the box is ❌ and the item gets done before I report.

**Ticks that need a named artefact:**
- *tasklog updated* → the Edit call, in this session
- *screenshot* → the screenshot call
- *verify green* → the command output
- *pushed* → the commit hash
- *test data cleaned* → the re-check showing the books restored

---

## EVERY REPORT OPENS WITH TWO PLAIN SENTENCES

*Rahul, 12 Aug: "explain me in simple words about the work you do… because I
didn't understand at all. That you completed C1 or not."*

He had to ask whether a finished task was finished. That is a failure of the
report, not of his reading. Before any table, any gate, any detail:

> **Sentence 1 — what I did**, in words a shopkeeper would use.
> **Sentence 2 — is it finished: yes, no, or partly** (and if partly, what is left).

Then the detail, and **keep that simple too**. Rules for the whole report:

- **No jargon without the plain word beside it.** "pg_trgm (fuzzy matching —
  finds names spelt slightly wrong)".
- **Short sentences.** If a sentence needs a comma to survive, split it.
- **Say the thing, then explain it.** Never build up to the point.
- The gate tables are proof I did the work — they are **evidence, not the
  report**. They go after the plain explanation, never instead of it.

A report Rahul has to decode costs him the time this whole process exists to
save.

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
- **A simulated network is not a network.** I "verified" offline behaviour by
  flipping `navigator.onLine` and stubbing `fetch`. Hours later Rahul's phone
  showed **5G in the status bar while every request failed to resolve** — so
  the flag I had been flipping was the very thing that lies, and the app was
  logging him out and stranding him on `/api/auth/error`. When I simulate a
  failure I am testing my assumption about it, not the failure. Say which was
  simulated, and put anything network-shaped on Rahul's list for the device.
- **`navigator.onLine === false` is trustworthy. `true` is not.** It means the
  device has a network interface, never that the server can be reached. I
  learned this from #63 and then, in the same hour, shipped #64 by asking the
  same flag one file over. **When a fix teaches me a fact, grep for every other
  place that assumes the opposite before I call it done.**

---

## THE STANDING GOALS — in front of me every session

**§0** — a compliance engine, not a register.
**§2** — the moat is Rule 88C: we tell them whether the return will survive.
**§4** — the design bar: 48dp targets, 16dp margins, 24dp icons, nothing under
12px, money is the largest thing on screen.

**The five-year question, asked every phase:** will this still be right when
every app has an AI? The capability registry is in the industry-standard
tool-calling shape *specifically* so EkBook can one day be called by ChatGPT or
Claude on a shopkeeper's CA's behalf. Decisions like that are the job.

---

## BUILD FOR MILLIONS — THIS IS NOT A PROTOTYPE

*Rahul, 12 Aug: "you are making the architecture for millions and billions of
users and transactions… these kind of mistakes should never happen again."*

I chose a name-matcher that works for one shop over one that works for a
million, because the small one was easier to test. That is the wrong trade for
this company, and it was mine to raise with him, not to settle quietly.

**Before writing any query, list or lookup, answer these — in the reply:**

1. **What happens at 10,000 rows? At 10 million?** If the answer is "it gets
   slower", fine. If the answer is **"it returns a different number"**, stop:
   that is a wrong answer, not a performance issue, and it is invisible.
2. **Does the database do the work, or does the app?** Totals, filtering,
   sorting and searching belong in the database. Pulling rows into memory to
   count them stops working long before anyone notices it started failing.
3. **Is there a `take:` or `limit`?** Then say — on screen — that the answer is
   partial, or remove the need for it. **A silent cap is a lie with a number
   on it.**
4. **Does one shop's data depend on our code remembering to filter it?** That
   is not isolation, it is discipline. The database must refuse.
5. **Would this still work if a shop had five years of history?** Reports that
   re-read every transaction ever written do not survive year two.

**Anything failing these goes in the tasklog the moment I see it**, even
mid-task, even if I am not fixing it — flagged so Rahul can hand it to another
agent. Noticing and moving on is the failure; the tasklog is how a finding
survives me.

---

## THE RULES ARE A FLOOR, NOT A CEILING

*Rahul, 12 Aug: "if you find any other changes which can improve the
functioning of the app… you must add that too in your rules and not just only
blindly follow the existing rules… don't want to follow the rules too strictly
that it hampers the better functioning."*

So:

- **A better way beats the written way.** If a rule would make the work worse,
  take the better path and **say so in the report, with the reason**. Silent
  deviation is still a defect; a reasoned one is the job.
- **A rule that earns its keep gets written down.** When something I learn
  would have prevented a bug, it goes in this file the same day, under its
  cause — not into a chat message that disappears.
- **Judgement over ceremony.** Running a two-minute build for a markdown-only
  change, or re-verifying something already proven this session, is cost with
  no evidence attached. Skip it and name what makes it safe.
- **What is never negotiable:** the HARD RULES table, money correctness, and
  the evidence rule. Those exist because breaking them is invisible.

---

## THE MISTAKES, ORGANISED BY CAUSE

Not by date — cause is what predicts recurrence. A broken rule goes **under its
cause**, never as a new line at the bottom.

**Cause 1 — Working from memory instead of opening files**
· Built Ask for a week without reading §0 — built a register, not the moat
· Claimed I couldn't read a video; ffmpeg was installed and I never checked
· Started building PDF export, and voice parsing, that already existed
· 12 Aug: cited §0/§4 in Gate 1 *from memory* for several tasks without opening them

**Cause 2 — Two things describing one thing**
· Parties filtered in one route, not another · Settle's allowlist lacked 'ask'
· Capability names vs intent names · two OPEN_VERB regexes
· `dataLivesAt` doing double duty as ViewType and destination id (#61, #68)
· **The process docs themselves** — three files stating the same gates, which
  diverged within 24 hours. That is what this consolidation fixes.

**Cause 3 — A refusal that isn't a refusal**
· Advice/predictions returned null from the parser; the model answered them
· **Then the identical thing with impossible dates, hours later**
· **And a third time (12 Aug):** a follow-up with no history returned null from
  `resolveFollowUp`, and the model invented a subject. Null from any parser
  means "no rule matched" — never "refused".

**Cause 4 — Verifying the wrong layer**
· Reported work without opening the browser · verified by API only
· Verified expenses against a shop with NO expenses — a ₹0 answer proves nothing
· Claimed keywords fixed search without checking; they didn't
· **12 Aug: "verified" offline by flipping `navigator.onLine`** — the very flag
  that lies. A simulated failure tests my assumption, not the failure.

**Cause 5 — Saying a thing instead of logging it**
· Reported the period flash in chat and never logged it — twice in one day

**Cause 6 — Inferring a fact instead of reading it**
· Settle direction from a balance sign · "1 supplier" from which way money pointed
· **12 Aug: reported #67 as a bug from a screenshot** without testing the phrase.
  It already worked; the card was an older answer. Rahul had to tell me to just
  type it in.

**Cause 8 — Changing what I cannot check**
· 12 Aug: swapped C1's database-side matching for my own because I could not
  confirm the extension — Rahul's call to make, not mine to settle quietly
· 13 Aug, the near-miss that earned this rule: I was one instruction from
  enabling row-level security. Rahul ran the check first and it returned
  `rolbypassrls = t` — our database user bypasses RLS entirely, so every
  policy would have been ignored **while the app looked perfect**. I would
  have reported it done and been wrong, and no amount of clicking would have
  shown it.
· **The rule: when a change cannot be tested from here, do not make it
  carefully — find the ONE question whose answer decides everything, and ask
  Rahul to run it first.**

**Cause 7 — A guard that does not guard**
· Wrote guards that passed on broken code, twice
· **12 Aug: a guard whose window was a fixed 900 characters** — my own comment
  pushed the thing it checked outside it, and it passed with the bug present.
· 12 Aug: a guard that matched its own explanatory comments, which quote the
  numbers it bans.
· **13 Aug: a guard that read a 700-character window, so a `userId` belonging
  to the query ABOVE satisfied the one below.** I deleted a real tenant filter
  and it stayed green.
· 13 Aug: a receipts guard read a TypeScript **type annotation** (`id: string`)
  as a receipt id.
· **14 Aug, the fifth — and the first to accuse someone else's correct work.**
  The migration guard split files on `\n` only. Windows checkouts end every
  line with a carriage return, and JavaScript's `.` **cannot match a carriage
  return**, so `/--.*$/` stripped nothing. The other agent's migration — which
  only ADDS a column — was reported as destructive DDL because its comment
  described its own rollback. **I first wrote that "main went red". It had
  not:** CI checks out Unix line endings, so GitHub was green throughout. The
  failure was local, on my machine only — which I should have checked before
  saying it, and which is Cause 6 wearing a new coat.

**Five in three days, all one shape: measuring nearby text instead of the
structure.** Match the actual thing — balance the braces, parse the argument,
split on `/\r?\n/` — and **only "reintroduce the bug and watch it fail" ever
proves it.**

· **15 Aug, the sixth — and the first that could not fail at all.** A sweep of
  all 226 test files found five assertions satisfiable by a COMMENT. Proved by
  deleting every call to `computePartyBalance` from the party route, leaving
  only its comments: the guard written to stop "three screens, three balances"
  **passed 9 of 9**. Then the guard-on-guards built to catch that class was
  caught by the same defect — it skipped files whose *comments* mentioned
  `readCode`, so it stayed silent on the very revert used to test it.

**The rule this earned: a guard must be RUNNABLE against a known-good and a
known-bad input.** Four of the five were rules buried inside a directory walk
or a regex sweep, so the only way to exercise them was to commit a real bug.
A rule I cannot call with two arguments is a comment with a green tick next to
it. **Extract the rule into a function, then test it both ways** — that is what
turns "I believe this guards" into "I watched this catch it".

**And: my checkout is Windows, CI is Linux.** Anything that reads a file as
text — line splitting, `$` anchors, path separators — can pass in one place and
fail in the other. Handle both, or the guard is only guarding my machine.

---

## IF RAHUL CATCHES SOMETHING

That is a defect in this file. **Fix this file the same day**, under the cause
it belongs to — not as a new dated line at the bottom.
