# 21 — The mobile shell, and the ledger nobody could read past

**Dates:** 2026-08-06 → 2026-08-07
**Trigger:** a screenshot from the Android build — the system clock drawn on top of the app header
**Scope:** safe-area handling, the app header, ledger information architecture, scroll position
**Method:** reproduce on production first, then fix, then measure the same thing again

---

## 0. What this session actually found

Six defects. Two were reported; four came out of verifying the fixes for the
first two. That ratio is the point of this report.

| # | Defect | Severity | Found by |
|---|---|---|---|
| 1 | Every safe-area inset read a channel Android had switched off | High | Reported |
| 2 | The header was never sticky, so content slid under the status bar | High | Verifying #1 |
| 3 | The header was 69px against a 56dp standard | Medium | Reported |
| 4 | Tab switches opened the new screen mid-scroll | Medium | Reported |
| 5 | The card layout crashed the whole app | **Critical** | Reported |
| 6 | Selection mode had no exit that said so | Medium | Reported |

---

## 1. env() was the wrong channel, and always had been

Every top bar asked Android for the status-bar height with
`env(safe-area-inset-top)`. On Android that is **always 0**, by design:

- From Android 15, apps targeting SDK 35+ are forced edge-to-edge. We target
  36. `StatusBar.setOverlaysWebView(false)` is a documented no-op — Capacitor's
  own `StatusBar.java#shouldSetStatusBarColor` returns `false` outright for
  apps targeting 16.
- Capacitor therefore passes insets to the web layer instead. It cannot use
  `env()`: Chromium miscomputes safe-area values in WebView < 140
  ([crbug 461332423](https://issues.chromium.org/issues/461332423)). So
  `SystemBars.java` **rebuilds the insets as `Insets.of(0,0,0,0)`** before
  handing them on — permanently zeroing `env()` — and injects the real dp
  values as `--safe-area-inset-*` on `documentElement`.

Neither half was buggy. They were talking past each other.

**Reproduced before touching anything.** On production, setting the same
variable Capacitor sets:

```js
document.documentElement.style.setProperty('--safe-area-inset-top', '48px')
```

Header `paddingTop` stayed `0px`. Height stayed `69`. Nothing moved.

**Fix.** `--safe-top/right/bottom/left` in `globals.css`, reading Capacitor's
variables first, `env()` second (iOS, browsers), `0px` last. `pt-safe` /
`pb-safe` utilities so a new screen inherits the behaviour from a class name
rather than a remembered inline style.

**Coverage was worse than the report suggested.** Only `Header.tsx` had ever
tried to leave room — and it was reading the dead channel. Five screen-level
bars had no inset at all: More, Account, GST & Tax, Money & Banking, Party
Settle. Plus three top-pinned banners, the toast viewport and the mobile
sidebar.

**A consequence worth naming.** The clock now sits on our header, not on a
saffron strip, so its colour must follow the app theme. It was pinned to one
value — in dark mode, a dark clock on a dark header. It now follows the `dark`
class via a MutationObserver.

The old comment on `setStyle` also had it backwards: `Style.Light` is "dark
text for light backgrounds". The enum is named for the background it sits on,
not the text it produces.

---

## 2. The header was never sticky (found by verifying §1)

With the inset applied, scrolling the dashboard to y=500 and measuring gave
`top: -500, bottom: -383`. The header had left the screen. `sticky top-0` had
never worked.

A sticky element can only travel inside its containing block. `AppShell`
wrapped the header in a bare `<div>` whose height was **exactly the header's
own** — 117px of box for a 117px element. Nowhere to travel, so it scrolled
away like static content, and on an edge-to-edge WebView whatever came next
slid up under the clock.

**Padding could never have fixed this.** Padding a bar that is already off
screen changes nothing. §1's fix and §2's fix look like one bug and are two.

**Fix.** Remove the wrapper; hang the visibility classes on `<header>` itself
so its containing block becomes the full-height flex column.

Splitting the class map was required to do that safely: `chromeClass` maps
`desktop-only` to `hidden lg:flex`, right for a wrapper `<div>` and wrong for
this element — `<header>` would become a flex container and its single child,
which carries the `justify-between`, would collapse to its content width.
`headerChromeClass` maps to `lg:block`. Nothing uses `header='desktop-only'`
today; the trap is closed before something does.

---

## 3. 69px of chrome against a 56dp standard

Three rules were fighting. The controls are 44px (minimum touch target, not
negotiable), the padding added 24px, and a `minHeight` of `3.5rem` asked for
56. 44 + 24 = 68 > 56, so **the minHeight never bound**. The correct intention
was written down and silently overridden.

`py-1.5` makes it 44 + 6 + 6 = 56 — the Android toolbar height WhatsApp, Gmail
and Material apps use — and the two rules now agree. Measured after: 57px,
being 56 plus the 1px divider, which is also how Material specifies it.

---

## 4. Scroll position

**Reported:** scrolling the dashboard then tapping another tab opened that tab
at the same offset.

**Not caused by the preceding changes.** No scroll reset has ever existed here.
Views swap on store state rather than routing, so the offset persists, and
`setView` was `set({ currentView: v })` and nothing else. What changed is
visibility: while the header scrolled away the whole screen merely looked
"scrolled"; a pinned header above content starting mid-way does not.

**First attempt was half a fix, and the report of it was wrong.** Calling
`scrollToTop()` from the tab buttons solved the reported case, and this report's
predecessor claimed Back would keep your place. Testing showed it did not: the
destination mounts empty and grows, and a browser cannot scroll to 900px inside
a 300px document — it clamps, and the position is gone. Nothing waited for the
content.

**Fix.** Per-view scroll memory (`src/lib/scroll-memory.ts`). `setView` is the
one choke point every navigation passes through, so it does the work: remember
the outgoing screen, start the new one at the top. Back sites pass
`{ back: true }` and the destination is restored, retried across animation
frames until the document is tall enough to hold the offset.

The forward/back distinction cannot be inferred inside `setView` — going back
sets `currentView` exactly like going forward. The six back sites declare it.

`behavior: 'instant'` is mandatory: `globals.css` sets `scroll-behavior: smooth`
on `<html>`, which applies to programmatic scrolls, so a plain `scrollTo` would
animate the OLD screen past the user while the new one rendered.

---

## 5. The ledger: seven bands of chrome

Search, view toggle, date button, voided toggle, Scan Bill, a "Select multiple →"
link and four sort buttons all held permanent space. The container was
`flex-col sm:flex-row` with every control a **direct child**, so below `sm`
each became its own full-width band — about a third of a phone screen before
the first transaction. A desktop toolbar degrading onto a phone, not a design.

Rearranging would have missed the point: **controls set once and then left
alone should not hold permanent space at all.**

**Fix.** One row — search, and a tune button carrying a count. Everything else
in `LedgerFilterSheet`. Active choices return as removable chips, so the screen
shows state rather than options, and an unexpectedly short ledger explains
itself instead of looking like missing data.

- Sort shows the **active** field (`Date ↓`). Four equal buttons showed the
  options and never the state.
- "Select multiple" was a 10px grey link — and the only route to bulk delete
  and bulk export. It sits beside the entry count now, at 44px.
- Scan Bill **deleted, not moved**: the scanner is already on the dashboard
  hero row, the dashboard quick actions, and the `+`. A fourth copy inside a
  list's filter bar is a create action where the user came to read.

Measured: 158px, 20% of the screen, from roughly 38%.

**Two follow-ups from verification.** The sheet said "This month" while its own
chip said "This Month" — a hand-written label list beside a shared helper. And
the bottom sheet, right for a thumb, stretched the full width of a desktop and
pushed over the app header; desktop now gets a bounded centred dialog, mobile
keeps the sheet, same body.

---

## 6. The card layout crashed the app (Critical)

Switching the ledger to card layout showed the error boundary — "Something went
wrong" — for the whole app.

```jsx
const { t } = useTranslation()      // the translator
...
{sorted.map((t) => (                // now `t` is a TRANSACTION
   <Badge>{t('stat.paid')}</Badge>  // calling a transaction
))}
```

`TypeError: t is not a function`.

Neither line is wrong alone, which is why review missed it — you have to hold
both at once and notice they share a name. TypeScript could not help: `t` is a
real value, and calling it is only a runtime error.

It also hid well. The crashing branch renders only when the layout toggle is on
**and** a fully paid entry is on screen, so the default view was healthy and the
bug waited for a user to change one setting.

**The same trap was live in five more places**, found by writing the guard
rather than by reading: the detailed list in the same file, the ledger's search
filter, `selectAll`, the CSV export, and two in `IncomeExpense.tsx`. All bound
`t` and all survived only because nothing inside them happened to call the
translator. One added label away, each of them.

**Guard.** `src/__tests__/components/no-translator-shadowing.test.ts` — for
every file that destructures `t` from `useTranslation()`, no callback parameter
may be named `t`. The rule is the **name**, not the crash.

**The guard was proved by breaking it.** Renaming one parameter back to `t`
fails the test with the exact file and line. A test that survives the bug it
was written for is not a test.

While fixing it, `grid-cols-1` became `grid-cols-2` on mobile: one card per row
was a worse version of the detailed list, so the toggle had no reason to exist
on a phone. The labels were also backwards — the "list" is the detailed view
and the cards are the compact one; they were named the other way round.

---

## 7. Selection mode had no exit

The only control that left the mode was labelled **"Clear"**, which reads as
"clear what I have ticked". The exit was hidden inside a control that appears
to do something else, and someone with five rows ticked would not risk it.

`clearSelection()` did two jobs. Now `exitBulkMode()` is the ✕ on the left —
where Gmail, Google Photos and WhatsApp put it — and "Clear" only unticks, and
only appears when there is something to untick.

---

## 8. What this session should be remembered for

**Four of six defects came from verifying, not from reading.** The sticky
header, the scroll-restore that never restored, the desktop dialog and the
label mismatch were all invisible in the diff and obvious in the product.

**One fix hid another, twice.** The safe-area bug hid the sticky-header bug —
fixing the first is what made the second visible. The permission error in
report 20 hid a type error the same way. This is now a pattern in this codebase
worth expecting: when a fix does not produce the result you predicted, look for
the second fault rather than adjusting the first.

**A claim made in a report was wrong and is corrected here.** Report 3 said
Back keeps your place. It did not. Saying so plainly costs less than leaving it
standing.
