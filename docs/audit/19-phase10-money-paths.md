# 19 — Phase 10: the money paths

**Date:** 2026-08-05
**Commits:** `43d29fe` (raw-SQL unit guard), `79d89d9` (udhaar fix)
**Tests:** 2771 passing / 139 suites
**Method:** fresh data through the real UI, with a control at every step

---

## The headline

> **Udhaar sales were being recorded as fully paid.**
>
> A shopkeeper could select "Credit (Udhaar)", follow the field's own
> instructions, and the debt would not exist.

This is the most serious defect found in the whole audit, because it is not a
wrong number on a report — it is the one thing a khata app exists to do.

---

## 🔴 1. Udhaar sales recorded as paid in full (FIXED)

### How to reproduce it (this is exactly what I did)

1. **New Sale**
2. Pick a customer
3. Add an item — ₹129.80
4. **Payment Mode → "Credit (Udhaar)"**
5. **Leave "Paid Amount" empty** — which is precisely what the field said to do:
   *"Leave empty for full payment"*
6. Save

### What the app stored

| Field | Value |
|---|---|
| Total | ₹129.80 |
| Paid | ₹129.80 |
| **Outstanding** | **₹0** |
| **Customer balance** | **₹0** |

I did this twice, for ₹1,129.80 of udhaar in total. The customer's balance
stayed at **zero** throughout.

### Why it happened

`paymentMode` and `paidAmount` were **completely independent**. Choosing
"Credit (Udhaar)" changed nothing about the paid field. The server then applied
the ordinary sale rule — *empty means paid in full* — because it had never been
told which mode the sale was.

It is the same shape as a bug fixed earlier and sitting **directly above it in
the same file**: a default that is correct for one case, applied where it means
the opposite. Both halves looked right in isolation. That is why nothing caught
it.

### What real damage this does

A shopkeeper hands over ₹1,000 of goods on credit and records it exactly as
designed. The app says the customer owes nothing. They never chase the payment.
Repeat across a month of udhaar and the khata — the whole reason they installed
the app — is silently empty.

### The fix

- The server now knows the payment mode. An empty paid field on a **credit**
  sale or purchase resolves to **0**.
- **Both** write paths pass it. Fixing only creation would mean *editing* an
  udhaar sale silently marked it paid — the same bug through the other door.
- The field now reads **"Unpaid: 0"** and *"Leave empty for full udhaar —
  ₹129.80 stays owing. Enter an amount if they paid part of it."* A server-only
  fix would have left the interface still telling people to do the thing that
  lost the debt.
- **Part payments are untouched** — ₹300 against a ₹1,000 udhaar sale still
  works exactly as before.

### Verified after deployment, through the same UI flow

| | Before | After |
|---|---|---|
| Paid | ₹129.80 | **₹0** |
| Outstanding | ₹0 | **₹129.80** |
| Customer balance | ₹0 | **₹129.80** |

19 tests, including the controls that cash/UPI/card/bank keep "empty means paid
in full" — breaking *that* would swing the error the other way and show every
counter sale as unpaid.

---

## ✅ 2. Payment create, delete and restore are correct

These routes had **no tests at all**, so I drove them against a live udhaar of
₹129.80 and checked the balance after every step:

| Step | Balance | Expected | |
|---|---|---|---|
| Udhaar sale of ₹129.80 | ₹129.80 | ₹129.80 | ✅ |
| Record payment of ₹50 | ₹79.80 | ₹79.80 | ✅ |
| Delete that payment | ₹129.80 | ₹129.80 | ✅ |
| Restore it | ₹79.80 | ₹79.80 | ✅ |

**Delete and restore both reverse cleanly.** That is the property that matters
and it holds.

**A note, not a defect:** editing a payment returned 405. There is no
payment-edit endpoint — payments are create-and-delete only, and no UI offers
editing. So the 405 is correct behaviour. Correcting a mistyped payment means
deleting and re-entering it, which preserves the arithmetic. Worth knowing;
not worth "fixing" without you asking for it.

---

## ✅ 3. Raw SQL never hands paise to rupee code

Money is stored as integer **paise**, and the conversion layer cannot see raw
SQL — so every raw statement must handle the unit itself. A miss is a silent
**100×** error.

**57 raw statements, 40 touching a money column, every one correct.** Each
converts in SQL, names the column `...Paise`, or converts in JS. I checked by
hand the eight the scan could not classify.

### But the scan lied to me three times first

Worth recording, because each version produced a *confident clean result*:

1. The extractor matched `$queryRaw<[^>]*>`, which stops at the first `>`.
   Real generic arguments nest across lines, so it examined **8 of 57** and
   reported everything fine. **A scan with bad coverage looks exactly like a
   clean codebase.**
2. `SELECT[\s\S]*?"totalAmount"` ran past `FROM` into the `WHERE`, so
   *filtering* on money counted as *reading* it — burying real findings.
3. Per-column matching cannot follow a SQL alias (`ti."cgst"` → `"totalCgst"`).

The committed guard therefore **asserts its own coverage** (>40 statements
examined). If the extractor regresses, the test fails loudly instead of
reporting a clean sweep of almost nothing. It also states the bar it actually
enforces rather than implying proof it cannot deliver.

---

## What I take from this phase

The udhaar bug was not found by reading code. It was found by **doing the thing
a shopkeeper does** and checking the number afterwards. Two thousand seven
hundred unit tests passed the whole time it was broken, because every piece was
correct on its own.

The pattern across this entire audit is now unmistakable: **the defects live
between correct components, and only using the product finds them.**
