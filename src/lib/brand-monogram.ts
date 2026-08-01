/**
 * Brand monogram — the DEFAULT logo, derived from the shop and owner name.
 *
 * 🎨 NEW 2026-07-29. Every card design has a logo slot, and most shopkeepers
 * will never upload a file. A card with an empty slot looks unfinished, and a
 * dashed "+" placeholder is fine while editing but embarrassing once shared.
 *
 * So the logo is never empty: a monogram is derived from the names the user has
 * already given us. Upload replaces it; nobody is ever forced to.
 *
 * WHICH INITIALS — the rule, in priority order:
 *   1. The SHOP name, when it yields two or more initials
 *        "RK Enterprises"        -> RK
 *        "Sharma Kirana Store"   -> SK   (stop words dropped, see below)
 *   2. Otherwise the OWNER's name
 *        shop "Bakery", owner "Rahul Kothari" -> RK
 *   3. Otherwise the first two letters of whatever exists
 *        "Bakery" -> BA
 *
 * The shop wins over the owner because that is the brand on the signboard.
 * "Sharma Kirana Store" giving SKS would be wrong — nobody writes three
 * letters on a card — so generic trade words are dropped first.
 */

/**
 * Words that describe the TRADE rather than name the business. Dropping them is
 * what turns "Sharma Kirana Store" into SK instead of SKS.
 *
 * Deliberately conservative: a word only belongs here if it is almost never the
 * distinctive part of a name. "Kumar Medical" should still give KM.
 */
const TRADE_WORDS = new Set([
  'store', 'stores', 'shop', 'shoppe', 'mart', 'market', 'bazaar', 'bazar',
  'traders', 'trading', 'enterprise', 'enterprises', 'agency', 'agencies',
  'and', 'the', 'of', 'co', 'company', 'pvt', 'ltd', 'limited', 'private',
  'llp', 'inc', 'corporation', 'corp', 'sons', 'bros', 'brothers',
])

/** Honorifics — never the initial anyone means. "Mr Rahul Kothari" is RK. */
const HONORIFICS = new Set(['mr', 'mrs', 'ms', 'miss', 'dr', 'shri', 'smt', 'sri'])

function meaningfulWords(input: string): string[] {
  return input
    .normalize('NFD')
    // Strip combining marks so Devanagari and accented Latin still yield a
    // usable first letter rather than a stray diacritic.
    .replace(/[̀-ͯ]/g, '')
    .split(/[\s.\-_/&,]+/)
    .map(w => w.trim())
    .filter(Boolean)
    .filter(w => {
      const lower = w.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '')
      if (!lower) return false
      if (HONORIFICS.has(lower)) return false
      return true
    })
}

/**
 * True when a word is ALREADY an initialism: "RK", "SKT", "ABC".
 *
 * These must be used whole rather than reduced to their first letter. "RK
 * Enterprises" means RK — taking one letter per word would give RE, which is
 * not what is painted on the shop.
 */
function isInitialism(word: string): boolean {
  const letters = word.replace(/[^\p{L}]/gu, '')
  return letters.length >= 2 && letters.length <= 3 && letters === letters.toUpperCase()
}

function initialsFrom(input: string | null | undefined, dropTradeWords: boolean): string {
  if (!input) return ''
  let words = meaningfulWords(input)

  // An initialism anywhere in the name IS the monogram.
  const acronym = words.find(isInitialism)
  if (acronym) return acronym.replace(/[^\p{L}]/gu, '').slice(0, 2).toUpperCase()

  if (dropTradeWords) {
    const kept = words.filter(w => !TRADE_WORDS.has(w.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '')))
    // Drop trade words ONLY when two initials survive.
    //
    // "Sharma Kirana Store" -> SK: correct, "Store" is not the distinctive part.
    // "Kirana Store"        -> KS: dropping "Store" leaves one initial, and a
    //                              one-letter monogram is worse than including
    //                              a generic word. An earlier version only
    //                              checked `kept.length > 0`, which quietly
    //                              produced "KI" — the first two letters of a
    //                              single word, which reads as a truncation
    //                              rather than initials.
    if (kept.length >= 2) words = kept
  }

  const letters = words
    .map(w => {
      const m = w.match(/\p{L}|\p{N}/u)
      return m ? m[0] : ''
    })
    .filter(Boolean)

  return letters.slice(0, 2).join('').toUpperCase()
}

/**
 * The monogram shown when no logo has been uploaded.
 *
 * Always returns something renderable — never an empty string, because the
 * caller would then have to handle a blank badge, and one of them eventually
 * would not.
 */
export function deriveMonogram(
  shopName?: string | null,
  ownerName?: string | null,
): string {
  const fromShop = initialsFrom(shopName, true)
  if (fromShop.length >= 2) return fromShop

  const fromOwner = initialsFrom(ownerName, false)
  if (fromOwner.length >= 2) return fromOwner

  // Single-word shop: take two letters from the word itself. "Bakery" -> BA.
  const shopWords = meaningfulWords(shopName ?? '')
  if (shopWords.length > 0) {
    const first = shopWords[0].replace(/[^\p{L}\p{N}]/gu, '')
    if (first.length >= 2) return first.slice(0, 2).toUpperCase()
    if (first.length === 1) return first.toUpperCase()
  }

  if (fromShop) return fromShop
  if (fromOwner) return fromOwner

  const ownerWords = meaningfulWords(ownerName ?? '')
  if (ownerWords.length > 0) {
    const first = ownerWords[0].replace(/[^\p{L}\p{N}]/gu, '')
    if (first.length >= 2) return first.slice(0, 2).toUpperCase()
  }

  // Nothing usable at all — the app's own initial beats an empty badge.
  return 'EK'
}

/**
 * A deterministic hue for the monogram badge, derived from the name.
 *
 * Two shops should not look identical, and the colour must be STABLE — a
 * monogram that changes shade on reload reads as a rendering bug. Used only
 * where a design does not dictate its own logo colours.
 */
export function monogramHue(seed: string): number {
  let h = 0
  for (let i = 0; i < seed.length; i++) {
    h = (h * 31 + seed.charCodeAt(i)) % 360
  }
  return h
}
