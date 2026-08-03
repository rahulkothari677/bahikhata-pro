# 13 — Feature-promise sweep: does the app actually do what it says?

**Date:** 2026-08-03
**Commits:** `b3e9477`, `415a21e`
**Method:** control + treatment probes against the live deployment
**Tests:** 2696 passing / 134 suites

---

## The question this round was answering

> "It should not happen that everything is present in the app but not working correctly."

Unit tests could not answer that. They mock the database, so they prove the code
does what the code says — never that the *promise* on the pricing page or the
button is kept. So every check below was run against the real deployment, and
every one had a **control**: a second thing that should behave differently. A
test with no control passes for the wrong reason and you never find out.

---

## Status of everything checked

| # | Promise | Result | Status |
|---|---|---|---|
| 1 | Owner can hide profit from staff | Staff and CA see no margin, owner still does | ✅ Working |
| 2 | Removing a staff member revokes access | Session dies instantly (401), re-login refused | ✅ Working |
| 3 | Referral gives the new user 7 days of Pro | Probe account is on Pro, expires in 7 days | ✅ **Confirms an earlier fix** |
| 4 | Referral share link works | `https://bahikhata-pro.vercel.app/?ref=RAHUL997` | ✅ Working |
| 5 | Staff can only see their permitted modules | sales 200, reports/parties/dashboard 403 | ✅ Working |
| 6 | CA has read-only access | All reads 200, every write 403 | ✅ Working |
| 7 | One shop's data never leaks to another | Probe account sees zero of the owner's records | ✅ Working |
| 8 | Requests need a valid origin (CSRF) | Blocked without an Origin header | ✅ Working |
| 9 | Pro is capped at 3 shops | 4th refused, 402 with a clear message | ✅ Working |
| 10 | **Staff seats are an Elite feature** | **A Pro account created 3 staff, unrestricted** | 🔴 **FIXED** — `b3e9477` |
| 11 | **A refused action explains itself** | **Showed `plan_limit_reached` as the message** | 🔴 **FIXED** — `415a21e` |
| 12 | A shop can be managed after creation | No delete and no rename exists anywhere | 🟡 **LOGGED** — needs your decision |

---

## 🔴 Finding 1 — Staff seats were free for everyone (FIXED)

### In simple words

Your pricing has three tiers. Staff accounts are the thing that makes **Elite
(₹599) worth more than Pro (₹299)** — Free and Pro are meant to get zero staff.

They weren't getting zero. They were getting **unlimited**.

And the only people who *were* limited were the Elite customers who had actually
paid for the feature — capped at 5, while everyone else had no cap at all. The
tier was upside down.

### Why it happened

The pricing config used the number `0` to mean two opposite things:

```
products: 0        →  UNLIMITED   (Pro and Elite get unlimited products)
staff:    0        →  NONE        (Free and Pro get no staff at all)
```

One line in the limit checker read every `0` the same way:

```ts
if (limit === 0 || limit === Infinity) return { allowed: true }   // ← unlimited
```

So "you get zero staff seats" was read as "you get unlimited staff seats". One
character of ambiguity, an entire pricing tier given away.

### How it was found

Not by reading the code — by asking the live app to break its own promise:

- On a **Pro** account, I created three staff accounts. All three succeeded.
- On that **same account, in the same minute**, I created a fourth shop. It was
  correctly refused: *"You've reached the PRO plan limit of 3 shops."*

Same function, same route shape, opposite outcomes. That contrast is what
identified the `0` sentinel as the cause rather than a missing check somewhere.
Without the shop control I'd have had a failure with no explanation.

### It had already been half-fixed once

There is a comment in that file from an earlier audit explaining that the staff
count was changed to include CA sub-accounts, specifically to stop *"a Pro owner
(limit 0)"* creating unlimited CAs.

That fix was correct. It was also **unreachable** — it sat below the early
return, so for Free and Pro (the exact plans it was written for) the code never
ran. Nothing failed. The test suite stayed green. A fix placed below a
short-circuit is not a fix, and nothing in the system was capable of saying so.

### What changed

- Sentinels are now resolved in **one function**. Only `Infinity` means
  unlimited; `staff: 0` is honoured as a real zero.
- A zero grant is refused **without querying the database**. The old path had a
  `catch` returning `allowed: true` on a DB error — so a database hiccup would
  have handed out a paid seat.
- The upgrade prompt is derived from the price list instead of assumed. It used
  to say `plan === 'free' ? 'Pro' : 'Elite'`, which would have told a Free user
  to buy **Pro** to get staff seats — and Pro doesn't include them either. That
  would have sold a ₹299 upgrade that does not deliver what it was shown for.

### Nobody gets locked out

The limit gates **creation only**. Any sub-account created under the old
behaviour keeps working and keeps logging in. If you'd rather reclaim those,
that's a separate deliberate decision, not something a bug fix should do
silently.

### How to verify it yourself

Log in as a Free or Pro account, go to **More → Business → Staff & Access**, and
press **Add Staff**. You should see:

> Your PRO plan doesn't include staff. Upgrade to Elite for 5 staff.

On your own account (founder → Elite) it still works normally — I added and
removed a test staff member through the UI to confirm.

---

## 🔴 Finding 2 — The refusal was unreadable (FIXED)

Fixing Finding 1 made a second bug reachable. The staff screen displayed the
server's short machine **code** instead of the sentence written for the user, so
a shopkeeper would have seen:

> **Couldn't add the staff member**
> `plan_limit_reached`

instead of the actual explanation. A paywall a user can't read isn't a paywall,
it's a bug report — and it would have arrived as support tickets, not upgrades.

This had been invisible because the only way to previously reach that branch was
a validation slip, where the code happens to read like English.

The helper that gets this right (`readError`) already existed and is what every
other screen uses. These two screens simply weren't using it.

**Worth noting:** this is what browser testing catches and API testing doesn't.
The API was returning the correct sentence the whole time. Only the screen was
wrong.

---

## 🟡 Finding 3 — A shop can be created but never removed (LOGGED)

### In simple words

You can add a shop. You cannot rename it, and you cannot delete it. There is no
button, and there is no API behind a button — the only code in the entire
codebase that deletes a shop is "delete my whole account".

Combined with the caps that *do* work, this is a trap:

- **Free** gets exactly **1** shop. Create it with a typo in the name and that's
  the name of your business, permanently.
- **Pro** gets **3**. Burn one by mistake and you're at 2, forever.

The most likely victim is a brand-new user making a first-day mistake — the
worst possible moment to hit a permanent wall.

### Why I didn't just fix it

Because deleting a shop is a data question, not a button question, and it's your
call. Transactions, parties and products each carry a `shopId`. Deleting the
shop leaves those records pointing at something that no longer exists, and they
would likely vanish from the shop filter — the books would look like they lost
entries.

### My recommendation

Do these in order; the first is small and removes most of the pain.

1. **Rename first.** This solves the common case (a typo, a changed business
   name), carries no data risk at all, and is a small change. I'd ship this on
   its own.
2. **Then archive, not delete.** Hide the shop from the switcher while its
   records stay attached and intact. This matches how the rest of the app
   already treats removal (accounts are closed and retained, not destroyed, for
   the GST 72-month rule) and it cannot lose books.
3. **Only allow true deletion for an empty shop** — one with no transactions,
   parties or products. That covers "I just created this by accident" safely,
   and refuses exactly the cases that would cost data.

Tell me which of these you want and I'll build it.

---

## What I'd take away from this round

The three real defects here share one shape: **each one was invisible from
inside the code.** The sentinel bug looked correct in isolation. The error
message looked correct until a new branch became reachable. The missing shop
delete is invisible because absence is not something you can read — nothing is
there to look wrong.

What found them was asking the running app to keep a promise, with a control
alongside to show what "kept" looks like. I'll keep applying that to the
remaining promises.
