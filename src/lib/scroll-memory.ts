'use client'

/**
 * Per-screen scroll memory.
 *
 * THE PROBLEM. Screens here are swapped by store state, not by routing, so the
 * window's scroll offset survives the swap untouched. Scroll to the bottom of
 * the dashboard, tap Sales, and the ledger opens at that same offset — mid-list,
 * for no reason the user can see.
 *
 * THE HALF-FIX THAT CAME FIRST. Calling scrollToTop() from the tab buttons
 * solved the reported case, and the obvious tidy-up — putting it inside setView
 * so nothing could be forgotten — would have broken something else: back
 * navigation goes through the same setView, and someone returning from a bill
 * to a 200-row ledger should land where they left it, not at the top.
 *
 * So position is remembered per screen instead. Forward: start at the top.
 * Back: restore exactly where that screen was. This is what Instagram, WhatsApp
 * and Gmail do, and it is the reason their tabs feel like places you return to
 * rather than pages that reload.
 *
 * WHY RESTORING NEEDS TWO FRAMES. The new screen mounts empty and grows as
 * React commits its rows. A browser cannot scroll to 900px inside a document
 * that is currently 300px tall — it clamps to the maximum and the position is
 * lost. Restoring is therefore retried across a few frames until the document
 * is actually tall enough to hold the offset. This is also why the earlier
 * "back keeps your place" claim did not hold in practice: nothing was waiting
 * for the content, so the clamp won every time.
 */

const positions = new Map<string, number>()

/** How far down a screen currently is. */
function currentY(): number {
  return window.scrollY || document.documentElement.scrollTop || 0
}

/** Remember where `view` is, to restore when the user comes back to it. */
export function rememberScroll(view: string) {
  if (typeof window === 'undefined') return
  positions.set(view, currentY())
}

/**
 * Jump straight to a position, bypassing the global `scroll-behavior: smooth`
 * in globals.css — which applies to programmatic scrolls and would otherwise
 * animate the OLD screen past the user while the new one renders.
 */
function jumpTo(y: number) {
  window.scrollTo({ top: y, left: 0, behavior: 'instant' })
}

/** Start a screen at the top. Used for every forward navigation. */
export function scrollToTop() {
  if (typeof window === 'undefined') return
  jumpTo(0)
}

/**
 * Put `view` back where it was.
 *
 * Retries across animation frames because the target screen is still filling
 * in — see the note above about clamping. Gives up after ~10 frames (about
 * 160ms), which is far longer than a list takes to commit, and lands on
 * whatever the page can offer rather than leaving the user somewhere arbitrary.
 */
export function restoreScroll(view: string) {
  if (typeof window === 'undefined') return
  const target = positions.get(view)
  if (!target) { jumpTo(0); return }

  let frames = 0
  const attempt = () => {
    jumpTo(target)
    // Landed, or the document simply cannot go that far yet — try again.
    if (Math.abs(currentY() - target) > 2 && frames++ < 10) {
      requestAnimationFrame(attempt)
    }
  }
  requestAnimationFrame(attempt)
}

/** Drop a screen's remembered position — for a view whose content was replaced. */
export function forgetScroll(view: string) {
  positions.delete(view)
}
