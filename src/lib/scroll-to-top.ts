'use client'

/**
 * Put the window back at the top of the page.
 *
 * WHY THIS IS NOT JUST window.scrollTo(0, 0):
 *
 * globals.css sets `scroll-behavior: smooth` on <html>, which applies to
 * programmatic scrolls too. Without an explicit `behavior`, switching tabs
 * would ANIMATE the old screen upward for a few hundred milliseconds while
 * the new screen was already rendering — you would watch the wrong content
 * slide past. 'instant' opts this one call out of that.
 *
 * WHY IT EXISTS AT ALL:
 *
 * Views in this app are swapped by store state, not by routing, so nothing
 * ever resets the scroll offset. Scroll to the bottom of the dashboard, tap
 * Sales, and the ledger opens at the same pixel offset — mid-list, for no
 * reason the user can see.
 *
 * That was always true, but it was easy to miss while the header scrolled
 * away with the page: the whole screen simply looked "scrolled". Now that the
 * header stays pinned, a pinned header sitting above content that starts
 * mid-way reads unmistakably as a bug.
 *
 * Deliberately NOT wired into the store's setView: back navigation goes
 * through the same setView, and a user returning from a transaction to a long
 * ledger should land where they left it, not at the top. This is called from
 * the places that mean "take me to this screen" — tab taps and nav actions —
 * so going back keeps its position.
 */
export function scrollToTop() {
  if (typeof window === 'undefined') return
  window.scrollTo({ top: 0, left: 0, behavior: 'instant' })
}
