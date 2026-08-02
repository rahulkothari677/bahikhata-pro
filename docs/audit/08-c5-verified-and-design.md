# Report 8 — C5 verified as real, with the implementation design

**Date:** 2026-08-02
**Status:** verified, designed, **not yet implemented** — deliberately. See §5.

---

## 1. Confirmed: this is a real, reachable defect

After being wrong about C3, every remaining finding gets checked against the code before
anything is built. C5 survives that check.

**Both entry points exist and are user-reachable:**

| Path | Evidence |
|---|---|
| Invoice-level payment | `TransactionEntry.tsx:107` — a "Paid Amount" input on the sale form |
| Standalone payment | `PartyProfile.tsx:210` — "Settle Payment" → `POST /api/payments` |

**Both reduce the balance independently** (`party-balance.ts`):

```
balance = openingBalance
        + Σ(sale.totalAmount − sale.paidAmount)   ← invoice-level payment
        − Σ(payment.amount WHERE type='received') ← standalone payment
        …
```

Nothing links a `Payment` row to the invoice it settles.

---

## 2. The case the existing guard misses

`payments/route.ts` warns when a payment **exceeds** the party's outstanding balance. That
catches the obvious case. It does not catch this one:

| Step | Reality | App shows |
|---|---|---|
| Invoice A ₹1,000, marked paid at billing | settled | — |
| Invoice B ₹5,000, unpaid | owes ₹5,000 | ₹5,000 |
| Shopkeeper records ₹1,000 (meaning A) | still owes ₹5,000 | **₹4,000** |

₹1,000 does not exceed ₹5,000, so no warning fires. **The balance is understated by ₹1,000**,
silently, and the shopkeeper under-collects.

The app cannot do better without knowing *which invoice* a payment settles. That is the
missing concept, and it is why allocation — not a smarter warning — is the fix.

---

## 3. Why a better warning is not sufficient

Any heuristic ("this payment matches a recently-paid invoice") is guessing at intent. It
would be noisy on legitimate repeat payments of similar amounts — common in a kirana shop —
and alert fatigue is what killed the previous M-NEW-1 heuristic, which fired on ~95% of
payments until it was replaced. Adding a second noisy warning would repeat that mistake.

---

## 4. Design

### 4.1 Schema

```prisma
model PaymentAllocation {
  id            String      @id @default(cuid())
  userId        String
  paymentId     String
  transactionId String
  amount        Int         // paise, like every other money column
  createdAt     DateTime    @default(now())

  payment     Payment     @relation(fields: [paymentId], references: [id], onDelete: Cascade)
  transaction Transaction @relation(fields: [transactionId], references: [id])

  @@unique([paymentId, transactionId])
  @@index([userId, transactionId])
  @@index([paymentId])
}
```

`onDelete: Cascade` on payment only. A transaction is soft-deleted, never hard-deleted, so
its allocations must survive to keep the audit trail intact.

### 4.2 Invariants (each becomes a test)

1. `Σ(allocations for a payment) ≤ payment.amount` — the remainder is an on-account advance.
2. `Σ(allocations for an invoice) + invoice.paidAmount ≤ invoice.totalAmount` — **this is the
   invariant that makes the §2 bug impossible.**
3. Allocation amounts are strictly positive.
4. Both sides belong to the same `userId` **and** the same party.
5. Soft-deleting a payment excludes its allocations from every balance.

### 4.3 Balance formula

Unchanged in shape — allocation constrains what can be *entered*, it does not re-derive the
balance. That is deliberate: `party-balance.ts` is the most sensitive file in the app and was
the centre of the M11 incident. Invariant 2 prevents over-payment at write time, so the
existing formula stays correct without being touched.

### 4.4 Migration and backfill

No live users, demo data only, so **no backfill is required** — the table ships empty.
Existing rows keep working: an unallocated payment behaves exactly as today.

### 4.5 Rollout order

1. Schema + migration (additive; nothing reads it yet)
2. Invariant enforcement on `POST /api/payments`, inside the existing transaction
3. Allocation UI in the settle-payment flow, defaulting to oldest-invoice-first
4. Ageing and statements read allocations where present, fall back to today's behaviour
5. Remove the now-redundant `exceedsOutstanding` warning **only after** 2–4 are proven

Each step is independently deployable and revertable. Steps 1–2 alone close the defect;
3–5 are the usability layer.

---

## 5. Why it is not implemented in this session

The standing instruction is *"make sure you don't create any bug or error"* and *"no existing
part should be corrupted."*

This change adds a table, changes a write path inside a transaction, and touches ageing and
statements — with `party-balance.ts` adjacent to all of it. It is the largest single change
in this audit, and it is the one where a mistake corrupts what a customer owes.

Every fix so far was verified by reverting the code and watching the new test fail. That
discipline is what caught a tautological reconciliation check, a regex guard that protected
nothing, and a CRLF substitution that silently did not apply. Doing this build at the tail of
a long session, with the care budget that is left, is how the mistake gets made.

The design above is deliberately complete — schema, invariants, ordering — so implementation
is execution rather than rediscovery.

---

## 6. Status

| ID | State |
|---|---|
| C5 | **Verified real. Designed. Implementation pending.** |

Steps 1–2 close the defect and are perhaps half a session's work. Steps 3–5 are the
usability layer and can follow separately.
