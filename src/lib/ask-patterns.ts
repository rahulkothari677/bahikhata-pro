/**
 * Turning a typed or spoken question into a STRUCTURED question — locally.
 *
 * THE RULE THIS FILE EXISTS TO ENFORCE: the answer to a money question must be
 * computed by code we have tested, never produced by a language model. So this
 * never returns a figure. It returns "which question is this, and about whom" —
 * and the caller routes that to the same code that already powers the screens.
 *
 * If a model misreads a question, the user gets the WRONG QUESTION, which is
 * visible ("Showing: Ramesh's balance") and correctable in a tap. If a model
 * produced the number, the user would get a wrong ANSWER, which is invisible.
 * One is an annoyance; the other ends the app's credibility the first time a
 * shopkeeper catches it.
 *
 * WHY REGEX BEFORE AI. Most real questions are a handful of shapes. Matching
 * them here is instant, free, works offline, and cannot hallucinate.
 * `voice-regex-parser.ts` already proved the pattern for ENTRIES — it catches
 * about a fifth of them with no model call. This is the same trick for
 * QUESTIONS, where the shapes are even more repetitive.
 *
 * HINGLISH IS THE PRIMARY DIALECT, not a fallback. Shopkeepers type romanised
 * Hindi on an English keyboard: "ramesh ka kitna baaki hai". Spelling varies
 * wildly — baaki/baki/bakaya, kitna/kitne — so patterns accept the variants
 * rather than assuming one spelling.
 */

export type AskIntent =
  | 'party_balance'      // what does X owe me
  | 'sales_period'       // sales for a period
  | 'profit_period'      // profit for a period
  | 'receivables'        // who owes me, in total
  | 'payables'           // what do I owe
  | 'top_products'       // what sold most
  | 'stock_item'         // how much of X is left
  | 'tax_due'            // what GST do I owe

/** A named stretch of time. Resolved to real dates by the caller, in IST. */
export type AskPeriod = 'today' | 'yesterday' | 'this_week' | 'this_month' | 'last_month' | 'this_fy' | 'all_time'

export interface AskQuery {
  intent: AskIntent
  /** Person the question is about, as typed. Resolved against real parties later. */
  partyName?: string
  /** Product the question is about, as typed. */
  itemName?: string
  period: AskPeriod
  /** How this was understood — 'pattern' here; 'llm' once that exists. */
  source: 'pattern'
  /** Echoed back to the user so a misread question is visible, not silent. */
  understoodAs: string
}

/** Lower-case, strip punctuation, collapse spaces. Speech input arrives with
 *  trailing full stops and inconsistent casing. */
function normalise(q: string): string {
  return q.toLowerCase().replace(/[?.!,]/g, ' ').replace(/\s+/g, ' ').trim()
}

/**
 * Which period is the question about?
 *
 * Order matters: "last month" must be tested before "month", or every
 * question about last month is answered about this one.
 */
function detectPeriod(q: string): { period: AskPeriod; label: string } {
  if (/\b(aaj|today|aj)\b/.test(q)) return { period: 'today', label: 'today' }
  if (/\b(kal|yesterday)\b/.test(q)) return { period: 'yesterday', label: 'yesterday' }
  if (/\b(pichhle|pichle|last|previous)\s+(mahine|month|maheene)\b/.test(q)) return { period: 'last_month', label: 'last month' }
  if (/\b(is|this|es)\s+(hafte|week|hafta)\b/.test(q)) return { period: 'this_week', label: 'this week' }
  if (/\b(hafte|week)\b/.test(q)) return { period: 'this_week', label: 'this week' }
  if (/\b(saal|year|varsh)\b/.test(q)) return { period: 'this_fy', label: 'this financial year' }
  if (/\b(mahine|month|maheene|mahina)\b/.test(q)) return { period: 'this_month', label: 'this month' }
  return { period: 'all_time', label: 'all time' }
}

/** Words that are never part of a person's name, so they can be stripped when
 *  pulling a name out of a sentence. */
const STOP_WORDS = new Set([
  'ka', 'ke', 'ki', 'ko', 'se', 'kitna', 'kitne', 'kitni', 'baaki', 'baki', 'bakaya',
  'hai', 'he', 'h', 'balance', 'due', 'owes', 'owe', 'does', 'do', 'how', 'much',
  'what', 'is', 'the', 'me', 'my', 'of', 'udhaar', 'udhar', 'lena', 'dena',
  'kitna', 'paisa', 'paise', 'rupee', 'rupees', 'amount', 'total', 'pending',
])

function titleCase(s: string): string {
  return s.replace(/\b\w/g, c => c.toUpperCase())
}

function cleanName(raw: string): string | undefined {
  const words = raw.split(' ').filter(w => w && !STOP_WORDS.has(w))
  const name = words.join(' ').trim()
  return name.length >= 2 ? name : undefined
}

/**
 * Match a question against the shapes we know.
 * Returns null when nothing matches — the caller must then REFUSE clearly
 * rather than guess. "I cannot answer that yet" is a correct answer; a
 * plausible wrong one is not.
 */
export function parseAsk(question: string): AskQuery | null {
  const q = normalise(question)
  if (!q) return null

  /*
   * ADVICE IS NOT A QUESTION ABOUT THE BOOKS, and we do not give it.
   *
   * Checked before anything else because an opinion question often contains
   * the same keywords as a factual one: "should I buy more stock" was being
   * answered as a stock query. That is worse than refusing — the shopkeeper
   * asked whether to buy and received a quantity, which reads as an answer to
   * the question they actually asked.
   *
   * "Which supplier is cheapest", "should I", "is it worth" — all judgements
   * that depend on things the books do not contain. Refusing is correct.
   */
  if (/\b(should i|shall i|kya mujhe|better|cheapest|worth it|recommend|suggest|advice|kya karu|kya karoon)\b/.test(q)) {
    return null
  }

  const { period, label: periodLabel } = detectPeriod(q)

  // ── TAX ─────────────────────────────────────────────────────────────
  // Before sales/profit: "is mahine kitna gst bharna hai" contains "kitna"
  // and a period, and would otherwise be read as a sales question.
  if (/\b(gst|tax|kar)\b/.test(q)) {
    return { intent: 'tax_due', period: period === 'all_time' ? 'this_month' : period, source: 'pattern',
      understoodAs: `GST payable · ${period === 'all_time' ? 'this month' : periodLabel}` }
  }

  // ── PROFIT ──────────────────────────────────────────────────────────
  if (/\b(profit|munafa|munaafa|labh|fayda|faida)\b/.test(q)) {
    return { intent: 'profit_period', period: period === 'all_time' ? 'this_month' : period, source: 'pattern',
      understoodAs: `Profit · ${period === 'all_time' ? 'this month' : periodLabel}` }
  }

  // ── TOP PRODUCTS ────────────────────────────────────────────────────
  // "sabse zyada kya bika", "best selling", "top product"
  if (/\b(sabse|sab se)\s+(zyada|jyada|adhik)\b/.test(q) || /\b(top|best|highest)\s+(selling|sold|product|item)\b/.test(q) || /\bbest\s?seller\b/.test(q)) {
    return { intent: 'top_products', period: period === 'all_time' ? 'this_month' : period, source: 'pattern',
      understoodAs: `Top selling products · ${period === 'all_time' ? 'this month' : periodLabel}` }
  }

  // ── STOCK ───────────────────────────────────────────────────────────
  // "chawal kitna stock hai", "stock of rice", "how much rice is left"
  const stockMatch = q.match(/\b(?:stock|maal|inventory)\b/) ? q : null
  if (stockMatch) {
    const m = q.match(/(?:stock (?:of|me|mein)\s+)([a-z0-9 ]+)/) || q.match(/^([a-z0-9 ]+?)\s+(?:ka|ki)\s+stock/)
    const item = m ? cleanName(m[1]) : undefined
    // Require either a named item, or a shape that is clearly a QUERY. The
    // bare word "stock" appears in plenty of sentences that are not questions
    // about stock levels.
    const looksLikeQuery = !!item || /\b(kitna|kitne|how much|how many|show|dikhao|level|levels)\b/.test(q)
    if (!looksLikeQuery) return null
    return { intent: 'stock_item', itemName: item, period: 'all_time', source: 'pattern',
      understoodAs: item ? `Stock of "${titleCase(item)}"` : 'Stock levels' }
  }

  // ── RECEIVABLES / PAYABLES (no specific person) ─────────────────────
  if (/\b(kitna|kul|total|how much)\b.*\b(udhaar|udhar|lena|receivable|owed to me)\b/.test(q)
    || /\b(who owes|kaun.*baaki|kisne.*dena)\b/.test(q)
    || /\b(receivables?|outstanding)\b/.test(q)) {
    return { intent: 'receivables', period: 'all_time', source: 'pattern', understoodAs: 'Money owed to you' }
  }
  if (/\b(payable|dena hai|maine dena|i owe)\b/.test(q)) {
    return { intent: 'payables', period: 'all_time', source: 'pattern', understoodAs: 'Money you owe' }
  }

  // ── PARTY BALANCE ───────────────────────────────────────────────────
  // "ramesh ka kitna baaki hai" / "how much does ramesh owe"
  let m = q.match(/^(.+?)\s+(?:ka|ke|ki)\s+(?:kitna|kitne|kitni)?\s*(?:baaki|baki|bakaya|balance|udhaar|udhar|due)/)
    || q.match(/how much does\s+(.+?)\s+owe/)
    || q.match(/^(.+?)\s+(?:ka|ki)\s+balance/)
  if (m) {
    const name = cleanName(m[1])
    if (name) {
      return { intent: 'party_balance', partyName: name, period: 'all_time', source: 'pattern',
        // Title-cased for display only. Matching against real parties is
        // case-insensitive, but echoing back "ramesh" when the user typed
        // "Ramesh" looks like we mangled their input.
        understoodAs: `Balance for "${titleCase(name)}"` }
    }
  }

  // ── SALES ───────────────────────────────────────────────────────────
  // Last, because it is the broadest: any question mentioning a period and
  // "kitna" that has not matched something more specific is a sales question.
  if (/\b(sale|sales|bikri|bikree|becha|bika|revenue|turnover)\b/.test(q)
    || (/\bkitna\b/.test(q) && period !== 'all_time')) {
    return { intent: 'sales_period', period: period === 'all_time' ? 'today' : period, source: 'pattern',
      understoodAs: `Sales · ${period === 'all_time' ? 'today' : periodLabel}` }
  }

  return null
}

/** Shown when nothing matches — so a refusal still teaches what IS possible. */
export const ASK_EXAMPLES = [
  'Ramesh ka kitna baaki hai',
  'aaj ki sale',
  'is mahine ka profit',
  'sabse zyada kya bika',
  'kitna udhaar hai',
  'kitna GST bharna hai',
] as const
