# 15 — Revised audit plan: what's done, what's left, what I got wrong about scope

**Date:** 2026-08-04
**Purpose:** you asked how many phases remain, and for me to re-analyse rather than just
read out the old list. This replaces the original 8-phase plan.

---

## Part 1 — The original plan, honestly scored

| Phase | Status | The honest version |
|---|---|---|
| 1. Money / paise integrity | ✅ Done | Guard tests in place. But **91 raw-SQL sites bypass the paise↔rupee converter** and only some are covered. Reopened as N1 below. |
| 2. Scale sweep | ✅ Done | Unbounded queries, N+1, sequential loops. Solid. |
| 3. Transaction lifecycle & atomicity | 🟡 **Partial** | Was marked in-progress and never closed. Payment edit/delete/restore routes are **untested**. See N2. |
| 4. GST correctness | 🟡 **Partial** | Report 06 covered filing. GSTR-2B import, e-invoice IRN and reconciliation were never audited. See N3. |
| 5. Auth & multi-tenancy | ✅ Done | Found the unreachable auth gate. Live-verified isolation, staff, CA. Strong. |
| 6. Offline sync, backup/restore, billing | ✅ Done | Found the backup that destroyed the udhaar book. Strong. |
| 7. Admin panel | ⬜ **Not started** | The whole thing. See below. |
| 8. Compile/test/build verification | ❌ **Was wrong** | Marked complete — but CI was red, lint never ran, and E2E never ran. Redone in report 14. |

**So: not "1 phase left". Three phases are incomplete, one was wrongly closed, and the
survey below found five areas the original plan never named at all.**

---

## Part 2 — What I got wrong about scope

The original plan was organised by **subsystem** (money, GST, auth). That found real bugs.
But look at what the last two rounds actually caught:

- staff limit enforcing nothing
- referral reward granting nothing
- share links that didn't open
- backup that couldn't restore
- lint that never linted
- E2E that never ran

**None of those are subsystem bugs. Every one is a promise that isn't kept.** A
subsystem-shaped audit reads the code and asks "is this correct?" — and each of those was
correct in isolation. They only fail in the gap *between* two correct things.

So the remaining phases are organised by **failure mode**, not by module. That's the change.

---

## Part 3 — The remaining plan

### Phase 7 — Admin panel (next, starting now)

The admin panel can read every shopkeeper's books and change their plan, and it has had no
audit at all. 46k LOC, 330 tests.

- **Authorization depth** — can a non-founder admin reach founder-only actions? Is every
  route behind `withAdmin`? Is step-up (2FA) enforced server-side, or only hidden in the UI?
- **Impersonation** — does it expire, is it logged, can it write as the user, can it be
  entered without consent?
- **Audit chain** — the tamper-evident log. Can an admin delete their own entries?
- **Break-glass** — the emergency-access path. Does it actually alert anyone?
- **DSAR / DPDP export** — completeness under the ceiling, and the erasure path.
- **Webhook engine + fraud rules** — do they fire, and what happens when they fail?
- **Blast radius** — every bulk action, re-checked for "reports success, does nothing".

⚠️ Sensitive admin actions return `STEP_UP_REQUIRED`. **I'll need you to enter your
authenticator code** when I reach those.

### Phase 9 — The promise sweep (continues #19)

Systematic, not opportunistic. Enumerate every claim the product makes — pricing page,
feature list, button labels, success toasts — and prove each one against the live app with
a control. This is the method that has found the most severe bugs, and it's maybe 40% done.

Named targets: recurring entries actually posting · reminders actually sending · budgets
actually enforcing · every plan gate (not just staff) · WhatsApp flows · PDF/e-invoice
output · the AI scanner and voice entry.

### Phase 10 — Money paths with no test (N1 + N2)

- **N1:** 91 `$queryRaw`/`$executeRaw` sites bypass the paise↔rupee conversion. Every one
  that touches a money column is a silent 100× error waiting to happen. Enumerate and prove.
- **N2:** untested money routes — `payments/[id]` (edit/delete), `payments/[id]/restore`,
  `bank-recon/reconcile`, `reconciliation`, `income-expense/summary`.

### Phase 11 — GST completion (N3)

Finish what phase 4 started: GSTR-2B import matching, e-invoice IRN payloads, GSTR-1 vs
GSTR-3B agreement, HSN validation, reverse charge, credit/debit notes. This is the area
where a bug becomes a **legal filing error for a real shopkeeper**, not just a wrong number.

### Phase 12 — Failure and recovery

Nothing so far has tested what happens when things break. Database unavailable mid-write ·
Redis down (which limits fail open vs closed?) · AI provider timeout · partial offline sync
· two devices editing the same invoice (task #18) · what a shopkeeper sees during each.

### Phase 13 — Restore the safety net

Fix the tooling so it can catch things again: E2E on push (#22) · account-level login
rate limiting (#17) · resolve the duplicate party names (#16) · concurrent-edit warnings
(#18) · shop archive/delete (#21).

---

## Part 4 — Recommended order, and why

1. **Phase 7 (admin)** — highest blast radius. One admin bug touches every shopkeeper at
   once, and it's the only major area with zero coverage.
2. **Phase 10 (money paths)** — wrong money is the worst bug this app can have.
3. **Phase 11 (GST)** — wrong filings have legal consequences for your users.
4. **Phase 9 (promise sweep)** — runs continuously alongside the others.
5. **Phase 12 (failure modes)** — matters at scale more than today.
6. **Phase 13 (tooling)** — do the E2E item early; it multiplies everything else.

**Honest estimate: about 6 substantial phases remain, not 1.** The original plan was
scoped for "audit the modules". Your actual bar — *"not just a ledger app, like a top
fintech app"* — is a higher bar than that plan was ever built to reach, and I'd rather
say so than report 7-of-8 done.

---

## Part 5 — Two things only you can decide

1. **Duplicate party names** (task #16, still open) — "rahul" and "RAHUL KOTHARI" exist
   twice. On a backup restore this costs **8 payments and 6 transactions**. I need you to
   say rename-or-merge; I won't merge someone's ledger on a guess.
2. **A fresh backup** — anything taken before commit `b19d602` cannot restore payments.
   Take a new one when convenient.
