/**
 * Find the screen someone meant, by name.
 *
 * ── WHY WE RESOLVE THIS AND NOT THE MODEL ─────────────────────────────
 *
 * The obvious alternative was to put all 66 destination ids into the tool
 * schema as an enum and let the model pick one. I rejected it twice over:
 *
 *   · It bloats every routing prompt with 66 ids, on every question, even the
 *     ones that have nothing to do with navigation.
 *   · Ids are not what people say. `pl` is the Profit & Loss report; nobody
 *     types "pl". The model would have to be taught the mapping anyway, in the
 *     description, which is the same data twice.
 *
 * So the model passes the WORDS through and this resolves them, against the
 * `keywords` field that already exists on every destination because
 * GlobalSearch needed exactly this. One vocabulary (rule B6): the words that
 * find a screen in the search box are the words that find it by command.
 *
 * ── IT OFFERS, IT DOES NOT GUESS ──────────────────────────────────────
 *
 * Several matches come back as several matches. The caller shows them as a
 * choice list, the same way two customers named Ramesh are handled. Picking
 * the highest score and navigating there would be the app deciding what you
 * meant — and unlike a wrong figure, a wrong screen is loud, but it is still
 * not what you asked for.
 */

import { NAV_REGISTRY, type NavDestination } from '@/lib/nav-registry'

export interface NavMatch {
  destination: NavDestination
  score: number
}

/** Lower-case, strip punctuation, collapse spaces. */
function normalise(s: string): string {
  return s.toLowerCase().replace(/[^\p{L}\p{N}\s-]/gu, ' ').replace(/\s+/g, ' ').trim()
}

/**
 * Words that carry no meaning in a navigation request, in both languages the
 * app is used in. "gst report kholo" must match on "gst report", not on
 * "kholo" — otherwise every command scores against every screen.
 */
const STOP_WORDS = new Set([
  'kholo', 'khol', 'dikhao', 'dikha', 'batao', 'ka', 'ki', 'ke', 'ko', 'mera', 'meri',
  'open', 'show', 'me', 'my', 'the', 'a', 'go', 'to', 'page', 'screen', 'view', 'wala', 'wali',
  /*
   * Conjunctions, and they are not decoration. "profit and loss" failed to
   * find the Profit & Loss report because "and" had to match something and
   * never did, which cancelled the all-words bonus and let "bill profit"
   * outrank the actual report.
   */
  'and', 'aur', 'or', 'ya',
])

function meaningfulWords(s: string): string[] {
  return normalise(s).split(' ').filter(w => w.length > 1 && !STOP_WORDS.has(w))
}

/**
 * Destinations that can actually be navigated to.
 *
 * A destination whose action is a toast ("coming soon") is a real registry
 * entry and a real thing in the More menu, but sending someone there by
 * command would answer "open X" with a message saying X does not exist yet.
 * Better not to offer it as a destination at all.
 */
function isNavigable(d: NavDestination): boolean {
  if (d.actionKind === 'coming-soon') return false
  return !!d.view || !!d.actionKind
}

/**
 * Score a destination against the words asked for.
 *
 * Deliberately simple and explainable — an exact id or label match must always
 * beat a keyword brush. A clever similarity metric here would be a second
 * thing to debug when someone lands on the wrong screen.
 */
function scoreDestination(d: NavDestination, words: string[]): number {
  const id = normalise(d.id)
  const label = normalise(d.label)
  const keywords = normalise(d.keywords || '')
  const phrase = words.join(' ')

  if (!words.length) return 0

  // Whole phrase is the id or the label — unambiguous, nothing should outrank it.
  if (phrase === id || phrase === label) return 1000

  /*
   * AN EXACT PHRASE BEATS SCATTERED WORDS, and this rule is what broke three
   * ties that word-counting could not:
   *
   *   "profit and loss"  tied P&L Statement with Bill-wise and Item-wise
   *                      Profit at 90 each — every one contains "profit".
   *   "annual return"    tied GSTR-9 with Sale Return and Purchase Return.
   *   "dead stock"       tied Inventory Aging with two other stock screens.
   *
   * In each case one destination has the whole phrase in its keywords and the
   * others merely share a word. Someone who says "annual return" means the
   * annual return, not a sales return — and scoring words in isolation cannot
   * tell those apart.
   */
  let score = 0
  if (keywords.includes(phrase) || label.includes(phrase)) score += 200

  for (const w of words) {
    if (id === w) score += 100
    else if (id.includes(w)) score += 40
    if (label === w) score += 100
    else if (label.split(' ').includes(w)) score += 30
    else if (label.includes(w)) score += 15
    if (keywords.split(' ').includes(w)) score += 20
  }

  /*
   * Every word must land somewhere. "sale report" should not match the plain
   * "Sales" screen as strongly as it matches a sales report — requiring all
   * words to contribute is what separates the two.
   */
  const matchedAll = words.every(w =>
    id.includes(w) || label.includes(w) || keywords.includes(w))
  if (matchedAll) score += 50

  return score
}

/**
 * Destinations matching a spoken or typed name, best first.
 *
 * Returns [] when nothing matches — the caller says so honestly rather than
 * opening whatever came closest.
 */
export function findDestinations(query: string, limit = 5): NavMatch[] {
  const words = meaningfulWords(query)

  /*
   * "P&L" is how people write the Profit & Loss report, and it found NOTHING:
   * punctuation strips to "p l", both single letters, both discarded as too
   * short to score with. Squeezing the query down to its letters and testing
   * it as an id catches the abbreviations that ARE the id — pl, gstr-1 — and
   * costs one comparison.
   */
  const compact = normalise(query).replace(/[^\p{L}\p{N}]/gu, '')
  if (compact) {
    const exact = NAV_REGISTRY.find(d => isNavigable(d) && normalise(d.id).replace(/-/g, '') === compact)
    if (exact) return [{ destination: exact, score: 1000 }]
  }

  if (!words.length) return []

  const scored = NAV_REGISTRY
    .filter(isNavigable)
    .map(destination => ({ destination, score: scoreDestination(destination, words) }))
    .filter(m => m.score > 0)
    .sort((a, b) => b.score - a.score)

  if (!scored.length) return []

  /*
   * A CLEAR WINNER IS A WINNER. If the best match scores well ahead of the
   * next, the shopkeeper meant that one and a choice list would be noise.
   * "Ahead" is twice the runner-up, or an exact id/label hit.
   */
  const [best, second] = scored
  if (best.score >= 1000 || !second || best.score >= second.score * 2) {
    return [best]
  }

  return scored.slice(0, limit)
}
