/**
 * WHO OR WHAT DID THEY MEAN — the resolver. Phase C2a.
 *
 * ── THE PROBLEM, MEASURED (C1) ────────────────────────────────────────
 *
 * Every lookup in this app is one SQL trick: `name contains "<what they
 * said>"`. A SUBSTRING search. That is why:
 *
 *   "anil kumaar"        finds nothing — one letter breaks a substring (#50)
 *   "आम"                 finds nothing — Devanagari shares no letters with
 *                        "Aam", so every Hindi voice entry returns ₹0 (#56)
 *   "Ramesh aur Suresh"  finds nothing — searched as one name (#62)
 *
 * Three different failures wearing one costume.
 *
 * ── WHY THIS IS PURE, AND WHY NO MODEL IS INVOLVED ────────────────────
 *
 * A model would have to be shown the shop's customer list to pick between two
 * Rameshes. "The ledger never leaves — it sees the question, never the books",
 * and a customer list IS the books. It would also break "never invent a name",
 * and a wrongly-chosen customer puts money against the wrong person's ledger
 * where nobody will see it.
 *
 * So: ordinary arithmetic over strings, running on our own server, with the
 * same answer every time. The model keeps its existing job — deciding WHAT was
 * asked — where a mistake shows the wrong screen instead of a wrong figure.
 *
 * ── WHY JAVASCRIPT AND NOT pg_trgm ────────────────────────────────────
 *
 * C1 recommended Postgres's `pg_trgm`. Building it, I could not confirm the
 * extension is enabled on our Neon instance — the credentials are in Vercel,
 * not here — and shipping a matching layer I cannot test is worse than a
 * slower one I can. This runs over candidate names fetched by the caller:
 * pure, unit-testable to the last threshold, no migration, no extension.
 * Revisit if a shop ever holds more names than is comfortable to scan.
 *
 * ── IT NEVER PICKS WHEN IT IS UNSURE ──────────────────────────────────
 *
 * The output is a DECISION, not a best guess: one clear winner, or a list to
 * choose from, or nothing. "Ambiguity produces a choice, never a pick."
 */

/** A thing that could be meant: a customer, a supplier, a product, a category. */
export interface Candidate {
  id: string
  name: string
  /** Names this shop has already taught us for it — C2c writes these. */
  aliases?: readonly string[]
  /** When the shop last dealt with it. Ties break towards the recent one. */
  lastActivityAt?: number | null
}

export interface Scored {
  candidate: Candidate
  /** 0–1. 1 is an exact match after normalising. */
  score: number
  /** Which layer claimed it — shown to nobody, but it makes failures readable. */
  via: 'exact' | 'alias' | 'transliterated' | 'starts-with' | 'fuzzy'
}

export interface Resolution {
  /**
   * `exact`     — answer it, say nothing.
   * `confident` — answer it, but SHOW what we took it to mean.
   * `ambiguous` — offer the list. Never pick.
   * `none`      — say we could not find it. Never invent.
   */
  status: 'exact' | 'confident' | 'ambiguous' | 'none'
  /** Best first. For `ambiguous`, this is the list to offer. */
  matches: readonly Scored[]
}

/*
 * ── THRESHOLDS ────────────────────────────────────────────────────────
 *
 * PROVISIONAL. C1 said plainly that these must be chosen against the real
 * names in Rahul's 7 voice recordings, not picked because they sound right.
 * They live here, named, so that tuning them is one edit and every test moves
 * with them.
 */

/** Below this, a name is not a candidate at all. */
export const FLOOR = 0.45
/** At or above this, a single match may be answered without asking. */
export const CONFIDENT = 0.72
/** ...but only if it beats the runner-up by this much. Two similar names must ASK. */
export const MARGIN = 0.15
/** Never offer more than this — a wall of names is not a choice. */
export const MAX_CHOICES = 5

/**
 * Devanagari → Latin, for matching only.
 *
 * NOT a transliteration library and not trying to be readable: the output is
 * never shown to anyone, it only has to land near the Latin spelling the shop
 * typed. "आम" → "aam", "रमेश" → "ramesh", "चाय" → "chay" (which scores well
 * against "chai" on the fuzzy layer, which is the point).
 */
const DEVANAGARI: Record<string, string> = {
  'अ': 'a', 'आ': 'aa', 'इ': 'i', 'ई': 'ee', 'उ': 'u', 'ऊ': 'oo', 'ए': 'e',
  'ऐ': 'ai', 'ओ': 'o', 'औ': 'au', 'ऋ': 'ri',
  'क': 'k', 'ख': 'kh', 'ग': 'g', 'घ': 'gh', 'ङ': 'n',
  'च': 'ch', 'छ': 'chh', 'ज': 'j', 'झ': 'jh', 'ञ': 'n',
  'ट': 't', 'ठ': 'th', 'ड': 'd', 'ढ': 'dh', 'ण': 'n',
  'त': 't', 'थ': 'th', 'द': 'd', 'ध': 'dh', 'न': 'n',
  'प': 'p', 'फ': 'ph', 'ब': 'b', 'भ': 'bh', 'म': 'm',
  'य': 'y', 'र': 'r', 'ल': 'l', 'व': 'v', 'श': 'sh', 'ष': 'sh',
  'स': 's', 'ह': 'h', 'ळ': 'l', 'क़': 'k', 'ख़': 'kh', 'ग़': 'g',
  'ज़': 'z', 'ड़': 'r', 'ढ़': 'rh', 'फ़': 'f',
  // matras — the vowel signs that hang off a consonant
  'ा': 'a', 'ि': 'i', 'ी': 'i', 'ु': 'u', 'ू': 'u', 'े': 'e', 'ै': 'ai',
  'ो': 'o', 'ौ': 'au', 'ृ': 'ri', 'ं': 'n', 'ँ': 'n', 'ः': 'h',
  '्': '',   // halant — kills the inherent vowel, so it contributes nothing
  '़': '',   // nukta
}

/** True when the text contains any Devanagari at all. */
export function hasDevanagari(s: string): boolean {
  return /[ऀ-ॿ]/.test(s)
}

/**
 * The vowel signs and the halant — the marks that hang off a consonant and
 * replace or silence its built-in vowel.
 */
const MATRAS = new Set(['ा', 'ि', 'ी', 'ु', 'ू', 'े', 'ै', 'ो', 'ौ', 'ृ', '्', 'ं', 'ँ', 'ः', '़'])

/**
 * Devanagari → rough Latin. Text with no Devanagari comes back untouched.
 *
 * EVERY CONSONANT CARRIES A BUILT-IN "a". This is the thing that makes
 * Devanagari unlike an alphabet, and getting it wrong is not cosmetic: my
 * first version mapped letter-for-letter and turned रमेश into "rmesh", which
 * scored too low against "Ramesh" to be found. The whole point of this layer
 * is Hindi voice entry, so it would have failed at exactly its own job.
 *
 * So a consonant contributes its sound PLUS "a", unless the next character is
 * a vowel sign or the halant, which is the reader's instruction that the
 * built-in vowel does not apply.
 */
export function transliterate(s: string): string {
  if (!hasDevanagari(s)) return s
  const chars = [...s]
  let out = ''
  for (let i = 0; i < chars.length; i++) {
    const ch = chars[i]
    if (!(ch in DEVANAGARI)) { out += ch; continue }

    out += DEVANAGARI[ch]

    // A consonant is anything that is not itself a mark and not a standalone
    // vowel — those already spell themselves out.
    const isConsonant = !MATRAS.has(ch) && !'अआइईउऊएऐओऔऋ'.includes(ch)
    if (isConsonant) {
      const next = chars[i + 1]
      /*
       * ...EXCEPT AT THE END OF A WORD, where Hindi drops it. This is schwa
       * deletion, and it is not a nicety: आम is "aam", not "aama", and चाय is
       * "chay", not "chaya". Without this every spoken item carried a
       * trailing vowel the shop never typed, and scored lower for it.
       */
      const endsWord = !next || next === ' '
      if (next && !MATRAS.has(next) && !endsWord) out += 'a'
    }
  }
  return out
}

/**
 * One spelling to compare against another.
 *
 * Lower-cased, punctuation dropped, spaces collapsed — and the honorifics a
 * shopkeeper says but never types. "Ramesh bhai" and "Ramesh" are one person,
 * and no amount of letter-counting would ever discover that.
 */
/**
 * The same sound, spelled the other way.
 *
 * Hindi written in Latin letters has no official spelling, so the shop types
 * "Doodh" and the phone hears "dudh"; "Chawal" and "chaval"; "Chai" and
 * "chay". Checked against real product words, दूध scored **0.36** against
 * "Doodh" — below the floor, so it would have found nothing at all.
 *
 * Chasing that with more transliteration rules is endless. Folding both sides
 * onto one spelling fixes the whole class in nine lines: applied to the
 * shopkeeper's words AND to the product name, so it can only ever bring two
 * spellings of one sound together.
 */
function foldSpelling(s: string): string {
  return s
    .replace(/oo/g, 'u')      // doodh → dudh
    .replace(/ee/g, 'i')      // cheeni → chini
    .replace(/ea/g, 'i')      // tea → ti
    .replace(/aa/g, 'a')      // chaawal → chawal
    .replace(/w/g, 'v')       // chawal → chaval
    .replace(/ph/g, 'f')      // phal → fal
    .replace(/z/g, 'j')       // zeera → jira
    .replace(/y\b/g, 'i')     // chay → chai
    .replace(/(.)\1+/g, '$1') // any doubled letter → one
}

export function normalise(s: string): string {
  return foldSpelling(transliterate(String(s || '')).toLowerCase())
    .replace(/[.,/#!$%^&*;:{}=\-_`~()'"]/g, ' ')
    .replace(/\b(bhai|bhaiya|ji|sahab|saheb|shri|mr|mrs|ms|sir|madam)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * How alike are two names, 0 to 1.
 *
 * Trigrams — every run of three letters — compared by Dice's coefficient.
 * Chosen over counting single-letter edits because it survives the mistakes
 * people actually make: a doubled letter ("kumaar"), a swapped pair
 * ("Rmaesh"), a missing space. Short names get padded so "om" still has
 * trigrams to compare.
 */
export function similarity(a: string, b: string): number {
  const A = normalise(a)
  const B = normalise(b)
  if (!A || !B) return 0
  if (A === B) return 1

  const grams = (s: string): Set<string> => {
    const padded = `  ${s} `
    const out = new Set<string>()
    for (let i = 0; i < padded.length - 2; i++) out.add(padded.slice(i, i + 3))
    return out
  }

  const ga = grams(A)
  const gb = grams(B)
  let shared = 0
  for (const g of ga) if (gb.has(g)) shared++
  return (2 * shared) / (ga.size + gb.size)
}

/** Best score across a candidate's real name and everything this shop calls it. */
function scoreCandidate(spoken: string, c: Candidate): Scored {
  const said = normalise(spoken)
  const name = normalise(c.name)

  if (said === name) return { candidate: c, score: 1, via: 'exact' }

  for (const alias of c.aliases || []) {
    if (normalise(alias) === said) {
      /*
       * A learned alias is as good as the real name — better, in fact: the
       * shop TOLD us this. It outranks any amount of letter-similarity.
       */
      return { candidate: c, score: 1, via: 'alias' }
    }
  }

  /*
   * "ramesh" for "Ramesh Kumar Traders" — people say the first word and stop.
   * Scored high but never 1, so a true exact match always wins.
   */
  if (name.startsWith(said + ' ') || said.startsWith(name + ' ')) {
    return { candidate: c, score: 0.9, via: 'starts-with' }
  }

  const via = hasDevanagari(spoken) ? 'transliterated' : 'fuzzy'
  return { candidate: c, score: similarity(said, name), via }
}

/**
 * Who did they mean?
 *
 * Returns a DECISION. The caller answers, asks, or refuses — it never has to
 * re-derive any of this, which is what stops the chat, voice and scan from
 * quietly disagreeing about the same shopkeeper's words.
 */
export function resolveName(
  spoken: string,
  candidates: readonly Candidate[],
): Resolution {
  const said = normalise(spoken)
  if (!said || candidates.length === 0) return { status: 'none', matches: [] }

  const scored = candidates
    .map(c => scoreCandidate(spoken, c))
    .filter(s => s.score >= FLOOR)
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score
      /*
       * SAME SCORE — the one they dealt with most recently comes first.
       * Two customers called Ramesh score identically by definition, so
       * alphabetical order would be arbitrary. "The Ramesh I saw last week"
       * is what a shopkeeper actually means, and it is a stored fact, not a
       * guess.
       */
      return (b.candidate.lastActivityAt || 0) - (a.candidate.lastActivityAt || 0)
    })

  if (scored.length === 0) return { status: 'none', matches: [] }

  const best = scored[0]
  const runnerUp = scored[1]

  /*
   * EXACTLY ONE NAME MATCHED THIS SHOP'S BOOKS. Even a middling score is safe
   * here: there is nothing else it could have been, and refusing would mean
   * refusing the only answer that exists.
   */
  if (scored.length === 1) {
    return { status: best.score === 1 ? 'exact' : 'confident', matches: scored }
  }

  if (best.score === 1 && (!runnerUp || runnerUp.score < 1)) {
    return { status: 'exact', matches: [best] }
  }

  /*
   * CLEARLY AHEAD OF THE FIELD — answer, but the caller must show what it took
   * the words to mean. Both conditions matter: high on its own is not enough
   * when the runner-up is nearly as high, because that is precisely the
   * two-Rameshes case where picking is how money reaches the wrong ledger.
   */
  if (best.score >= CONFIDENT && (!runnerUp || best.score - runnerUp.score >= MARGIN)) {
    return { status: 'confident', matches: [best] }
  }

  return { status: 'ambiguous', matches: scored.slice(0, MAX_CHOICES) }
}
