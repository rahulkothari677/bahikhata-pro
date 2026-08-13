/**
 * "pehla" — picking from a list without touching the screen. C2b.
 *
 * ── WHY A NUMBER MATTERS MORE THAN IT LOOKS ───────────────────────────
 *
 * When two customers share a name the app refuses to guess and offers both.
 * That refusal is the right behaviour — "ambiguity produces a choice, never a
 * pick" — but it has a cost: the shopkeeper must now DO something.
 *
 * If they asked by voice, their hands are busy. Making them look at the phone
 * and tap accurately is how a safe path becomes the annoying one, and an
 * annoying safe path is how people learn to avoid the feature that protects
 * them. So the list is numbered, and saying "pehla" or "one" picks it.
 *
 * ── IT ONLY EVER RUNS WHEN A LIST IS ON SCREEN ────────────────────────
 *
 * "1" is a perfectly good thing to type in other contexts, and "do" means
 * "two" in Hindi and "do" in English. Neither may be treated as a pick unless
 * a choice list is actually waiting — the caller passes the count, and a
 * count of zero means nothing here can match.
 */

/**
 * Hindi and English ordinals, and the plain digits.
 *
 * Deliberately stops at five: the list is capped at five choices, and every
 * word past that is a word that could mean something else in an ordinary
 * question.
 */
const ORDINALS: Record<string, number> = {
  // Hindi, with the spellings people actually type
  'pehla': 1, 'pahla': 1, 'pehli': 1, 'pahli': 1, 'phela': 1,
  'dusra': 2, 'doosra': 2, 'dusri': 2, 'doosri': 2, 'dusara': 2,
  'teesra': 3, 'tisra': 3, 'teesri': 3, 'tisri': 3,
  'chautha': 4, 'chotha': 4, 'chauthi': 4,
  'panchwa': 5, 'paanchwa': 5, 'panchvi': 5,
  // English
  'first': 1, 'second': 2, 'third': 3, 'fourth': 4, 'fifth': 5,
  'one': 1, 'two': 2, 'three': 3, 'four': 4, 'five': 5,
  // Hindi numbers said aloud
  'ek': 1, 'do': 2, 'teen': 3, 'char': 4, 'chaar': 4, 'paanch': 5, 'panch': 5,
}

/**
 * Which option did they pick? Returns a 0-based index, or null.
 *
 * Null means "this was not a pick" — an ordinary question, which the caller
 * must go on to answer normally. Guessing here would swallow a real question
 * and answer a different one, which is the failure this whole feature exists
 * to avoid.
 */
export function pickFromChoices(text: string, choiceCount: number): number | null {
  if (!choiceCount || choiceCount < 1) return null

  const t = String(text || '')
    .toLowerCase()
    .replace(/[.,!?()]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  if (!t) return null

  /*
   * The WHOLE message must be the pick, give or take a filler word. "pehla"
   * is a pick; "pehle wale Ramesh ka kitna baaki hai" is a question that
   * happens to start with a similar word, and answering it as a tap would be
   * choosing for them.
   */
  const words = t.split(' ').filter(w => !['wala', 'wale', 'wali', 'no', 'number', 'option'].includes(w))
  if (words.length !== 1) return null

  const w = words[0]

  // A bare digit: "1", "2".
  if (/^[1-9]$/.test(w)) {
    const n = Number(w)
    return n <= choiceCount ? n - 1 : null
  }

  const n = ORDINALS[w]
  if (!n) return null

  /*
   * Asking for the fourth of two is not a pick — it is a misunderstanding,
   * and answering it as one would open the wrong customer's ledger.
   */
  return n <= choiceCount ? n - 1 : null
}
