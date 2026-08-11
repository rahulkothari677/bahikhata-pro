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
  | 'expenses_period'    // what did I spend on running the shop
  | 'purchases_period'   // what did I spend buying stock
  | 'open_screen'        // take me to a screen
  | 'open_invoice'       // take me to one bill

/** A named stretch of time. Resolved to real dates by the caller, in IST. */
export type AskPeriod = 'today' | 'yesterday' | 'this_week' | 'this_month' | 'last_month' | 'this_fy' | 'all_time'

export interface AskQuery {
  intent: AskIntent
  /** Person the question is about, as typed. Resolved against real parties later. */
  partyName?: string
  /** Product the question is about, as typed. */
  itemName?: string
  /** Screen the user asked to open, as typed. Resolved by nav-match later. */
  screenName?: string
  /** Bill number the user asked for, e.g. "INV-0001". */
  invoiceNo?: string
  /**
   * Expense category the question narrows to — "rent", "salary", "bijli".
   * Resolved against the shop's real categories later, exactly as itemName is
   * resolved against real products: named-but-unknown is answered honestly
   * rather than silently widened to everything.
   */
  categoryName?: string
  period: AskPeriod
  /**
   * How this was understood. 'pattern' means a rule in this file matched it
   * exactly; 'llm' means a model decided which capability was meant.
   *
   * The distinction is surfaced to the shopkeeper — an interpreted question is
   * the kind that can be wrong about what they meant, and they should be able
   * to see which kind they got.
   */
  source: 'pattern' | 'llm'
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
/**
 * SPENDING WORDS, split the way a shopkeeper already splits them.
 *
 * "kharcha" is what it costs to keep the shop open — rent, salary, bijli.
 * "kharida" is buying stock to sell. They are different words because they
 * are different things, and the shopkeeper never confuses them. So we do not
 * have to guess between them either: the word chosen answers the question.
 *
 * This is why these two intents could be split cleanly rather than shipped as
 * one vague "spending" answer. Where the language makes a distinction, honour
 * it; where it does not, ask.
 */
const NAMES_RUNNING_COSTS =
  // `spen(d|t)\w*` — "spend", "spent" and "spending" in one. Listing only the
  // last two missed "how much did I spend this month", which is the plainest
  // English form of the question.
  /\b(kharch\w*|expense\w*|spen(?:d|t)\w*|salary|tankh\w*|bijli|electricity|rent|kiraya|transport|bhada|bhaada|overhead\w*)\b/
const NAMES_BUYING_STOCK =
  /\b(kharid\w*|khareed\w*|purchase\w*|maal liya|stock liya)\b/

/**
 * Category words we can pass through as a filter. Deliberately the ones a
 * shopkeeper actually says — the value is matched against the shop's OWN
 * category names later, so an unrecognised one is reported, never ignored.
 */
const CATEGORY_WORDS: ReadonlyArray<[RegExp, string]> = [
  [/\b(salary|tankh\w*)\b/, 'salary'],
  [/\b(bijli|electricity)\b/, 'electricity'],
  [/\b(rent|kiraya)\b/, 'rent'],
  [/\b(transport|bhada|bhaada)\b/, 'transport'],
]

function categoryFrom(q: string): string | undefined {
  for (const [re, name] of CATEGORY_WORDS) if (re.test(q)) return name
  return undefined
}

/**
 * "X ka kitna baaki hai" — a question about ONE named party's balance.
 *
 * Lives here, above everything, because two branches need it and a second copy
 * of this regex is the drift bug I keep finding. The party-balance branch uses
 * it to answer; the spending branches use it to STAND DOWN.
 *
 * WHY THE SPENDING BRANCHES NEED IT. They run early, so they see the sentence
 * first — and a customer called "Kharid Traders" contains the stem for buying.
 * "Kharid Traders ka kitna baaki hai" came back as a purchases total. My own
 * test caught it, which is the only reason it is not live.
 *
 * A sentence SHAPED like a balance question is a balance question, whatever
 * words the party's name happens to contain. Shape beats vocabulary.
 */
/**
 * Questions this app refuses on principle — checked BEFORE any routing, and
 * exported so the AI path is bound by it too.
 *
 * WHY EXPORTED. These used to be two early `return null`s inside parseAsk. That
 * was enough while patterns were the only route: no match, no answer. Once a
 * model was added, `null` from the parser just meant "your turn" — so the model
 * saw the question and could answer it. Adversarial testing found exactly that:
 *
 *     "next month kitni sale hogi"  →  "₹3,262.00 of sales this month"
 *
 * A question about the FUTURE, answered with the PAST, labelled "this month",
 * and read by the shopkeeper as the forecast they asked for. The plan's own
 * list of things I will not build says it plainly: "Predictions dressed as
 * facts. If we ever forecast, it will be labelled a forecast."
 *
 * A rule the model is merely ASKED to follow in a prompt is a preference. This
 * is a rule: the route calls it before the model is ever consulted, so the
 * refusal does not depend on a model complying.
 */
export type RefusalReason = 'advice' | 'prediction'

export function mustRefuse(question: string): RefusalReason | null {
  const q = normalise(question)
  if (!q) return null

  /*
   * ADVICE IS NOT A QUESTION ABOUT THE BOOKS. An opinion question often
   * carries the same keywords as a factual one — "should I buy more stock"
   * was once answered with a quantity, which reads as a yes.
   */
  if (/\b(should i|shall i|kya mujhe|better|cheapest|worth it|recommend|suggest|advice|kya karu|kya karoon)\b/.test(q)) {
    return 'advice'
  }

  /*
   * Future tense in Hinglish is hoga/hogi/honge; in English, will/forecast.
   * "hui" and "hua" are PAST and must keep working — "aaj kitni sale hui" is
   * an ordinary question and stays answerable.
   */
  if (/\b(hoga|hogi|honge|hongi)\b/.test(q)
    || /\b(agle|agla|agli)\s+(mahine|maheene|hafte|saal|month|week|year)\b/.test(q)
    || /\bnext\s+(month|week|year|quarter)\b/.test(q)
    || /\b(will i|will my|forecast|predict|projection|expected)\b/.test(q)) {
    return 'prediction'
  }

  return null
}

function partyBalanceShape(q: string): RegExpMatchArray | null {
  return q.match(/^(.+?)\s+(?:ka|ke|ki)\s+(?:kitna|kitne|kitni)?\s*(?:baaki|baki|bakaya|balance|udhaar|udhar|due)/)
    || q.match(/how much does\s+(.+?)\s+owe/)
    || q.match(/^(.+?)\s+(?:ka|ki)\s+balance/)
}

/*
 * ── A REFUSAL LIST LIVED HERE, AND HAS BEEN REPLACED ON PURPOSE ──────
 *
 * Yesterday these four came back CONFIDENTLY WRONG, all with answered: true:
 *
 *   "is mahine kitna kharcha hua"      → "₹2,212.00 of sales this month"
 *   "kal kitna bijli ka bill tha"      → "₹2,212.00 of sales yesterday"
 *   "is hafte kitna transport kharcha" → "₹0.00 of sales this week"
 *   "kal kitna maal kharida"           → "3 products, lowest stock first"
 *
 * The stopgap was NAMES_A_SUBJECT_WE_CANNOT_ANSWER: a list of spending words
 * that made the greedy branches stand down and say "I can't answer that yet".
 * Honest, and useless — the shopkeeper still did not learn what they spent.
 *
 * Those words now route to `purchases_period` and `expenses_period` above,
 * BEFORE the greedy branches can reach them. That is strictly stronger than
 * the refusal was: a question claimed by a correct branch cannot be swallowed
 * by a greedy one, and the shopkeeper gets the answer instead of an apology.
 *
 * The refusal constant is therefore deleted rather than left empty — every
 * word it held is now covered by NAMES_RUNNING_COSTS or NAMES_BUYING_STOCK,
 * which was checked word by word before removing it.
 */

/**
 * Words that say outright "this is about selling".
 *
 * Kept as a constant because the stock branch needs it too. "kal kitna maal
 * becha" — how much did I SELL yesterday — was being answered with a list of
 * stock levels, because "maal" reaches the stock branch first and "kitna" was
 * enough to make it look like a stock query. An explicit verb beats a greedy
 * noun; the sales branch further down is the right owner of that sentence.
 */
const NAMES_SALES = /\b(sale|sales|bikri|bikree|becha|bika|revenue|turnover)\b/

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
  if (mustRefuse(q)) return null

  const { period, label: periodLabel } = detectPeriod(q)

  /*
   * ── AN EXPLICIT NAVIGATION COMMAND, checked BEFORE the data intents ──
   *
   * "open profit and loss report" was being answered with a profit FIGURE,
   * and "stock report dikhao" with stock levels, because the profit and stock
   * branches see the sentence first and both keywords are present.
   *
   * The discriminator is not the verb alone — "stock dikhao" is an ordinary
   * request for stock levels and the figure is the better answer there. It is
   * the verb PLUS a word that names a destination rather than a subject:
   * report, page, screen. Someone who says "report" is asking to be taken
   * somewhere; someone who says "stock dikhao" is asking what the number is.
   *
   * The looser verb-only check still exists, far below, for sentences that no
   * data branch claimed at all — "GSTR-1 kholo".
   */
  const OPEN_VERB = /\b(kholo|khol|kholna|dikhao|dikha|open|show|jao|le chalo|navigate)\b/
  const NAMES_A_DESTINATION = /\b(report|reports|page|screen|section|tab|statement)\b/
  if (OPEN_VERB.test(q) && NAMES_A_DESTINATION.test(q)) {
    const target = q.replace(OPEN_VERB, ' ').replace(/\s+/g, ' ').trim()
    if (target.length >= 2) {
      return { intent: 'open_screen', screenName: target, period: 'all_time', source: 'pattern',
        understoodAs: `Open ${target}` }
    }
  }

  /*
   * "Anil ka last bill" — a bill identified by WHOSE it is, not by its number.
   * Checked before party balance, which would otherwise claim the sentence on
   * its "X ka ..." shape and answer with a balance.
   */
  const lastBill = q.match(/^(.+?)\s+(?:ka|ki|ke)\s+(?:last|latest|recent|pichla|pichhla|aakhri)\s+(?:bill|invoice|sale)/)
  if (lastBill) {
    const who = cleanName(lastBill[1])
    if (who) {
      return { intent: 'open_invoice', partyName: who, period: 'all_time', source: 'pattern',
        understoodAs: `Latest bill for "${titleCase(who)}"` }
    }
  }

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

  /*
   * ── SPENDING ────────────────────────────────────────────────────────
   *
   * BEFORE top products, stock and sales, and that ordering is the whole fix.
   * These questions used to fall through to the greedy branches below and come
   * back answered with the WRONG SUBJECT — "is mahine kitna kharcha hua" was
   * answered "₹2,212.00 of sales this month". They were then made to refuse,
   * which was honest but useless.
   *
   * Routing them here is strictly better than either: the shopkeeper asked a
   * question the books can answer, and now they get the answer.
   *
   * Buying stock is checked FIRST because "kal kitna maal kharida" contains
   * "maal", which the stock branch would otherwise claim.
   */
  const looksLikeABalanceQuestion = !!partyBalanceShape(q)

  if (NAMES_BUYING_STOCK.test(q) && !looksLikeABalanceQuestion) {
    return { intent: 'purchases_period', period: period === 'all_time' ? 'this_month' : period, source: 'pattern',
      understoodAs: `Purchases · ${period === 'all_time' ? 'this month' : periodLabel}` }
  }
  if (NAMES_RUNNING_COSTS.test(q) && !looksLikeABalanceQuestion) {
    const categoryName = categoryFrom(q)
    return {
      intent: 'expenses_period',
      categoryName,
      period: period === 'all_time' ? 'this_month' : period,
      source: 'pattern',
      understoodAs: categoryName
        ? `${titleCase(categoryName)} spending · ${period === 'all_time' ? 'this month' : periodLabel}`
        : `Expenses · ${period === 'all_time' ? 'this month' : periodLabel}`,
    }
  }

  // ── TOP PRODUCTS ────────────────────────────────────────────────────
  // "sabse zyada kya bika", "best selling", "top product"
  // Plurals matter here too: "top items this month" and "best products" are
  // more natural than the singular, and both missed.
  if (/\b(sabse|sab se)\s+(zyada|jyada|adhik)\b/.test(q) || /\b(top|best|highest)\s+(selling|sold|products?|items?)\b/.test(q) || /\bbest\s?sellers?\b/.test(q)) {
    return { intent: 'top_products', period: period === 'all_time' ? 'this_month' : period, source: 'pattern',
      understoodAs: `Top selling products · ${period === 'all_time' ? 'this month' : periodLabel}` }
  }

  // ── STOCK ───────────────────────────────────────────────────────────
  // "chawal kitna stock hai", "stock of rice", "how much rice is left"
  /*
   * "how much rice is left" names no stock word at all, and was answered by
   * nothing. It is the plainest way an English speaker asks this.
   *
   * NOT "bacha" alone and CERTAINLY NOT "baaki": this branch runs BEFORE party
   * balance, so a pattern matching "kitna baaki hai" here would swallow
   * "ramesh ka kitna baaki hai" and answer a balance question with a stock
   * count. The Hinglish word for stock remaining is "bacha"; "baaki" is money.
   */
  const leftOver = q.match(/how much\s+(.+?)\s+(?:is\s+|are\s+)?(?:left|remaining)\b/)
    || q.match(/^(.+?)\s+kitna\s+bach(?:a|i|e)\b/)

  if (/\b(?:stock|maal|inventory)\b/.test(q) || leftOver) {
    const m = q.match(/(?:stock (?:of|me|mein)\s+)([a-z0-9 ]+)/)
      || q.match(/^([a-z0-9 ]+?)\s+(?:ka|ki)\s+stock/)
      || leftOver
    const item = m ? cleanName(m[1]) : undefined
    // Require either a named item, or a shape that is clearly a QUERY. The
    // bare word "stock" appears in plenty of sentences that are not questions
    // about stock levels.
    const looksLikeQuery = !!item || /\b(kitna|kitne|how much|how many|show|dikhao|level|levels)\b/.test(q)
    if (!looksLikeQuery) return null

    /*
     * WITH NO ITEM NAMED this branch is guessing from the bare word "maal",
     * and a plainly stated subject beats a guess. Two ways that happened, both
     * seen answering real questions wrongly:
     *
     *   "kal kitna maal becha" — a SALES question, answered with stock levels.
     *     It falls through to the sales branch, which can answer it.
     *
     * "kal kitna maal kharida" no longer reaches here at all: the purchases
     * branch above claims it first, which is why the old refusal check on this
     * line could be deleted.
     *
     * When an item IS named the sentence has said what it is about, and stock
     * is no longer a guess — so the check does not apply.
     */
    const guessingFromMaal = !item
    if (!(guessingFromMaal && NAMES_SALES.test(q))) {
      return { intent: 'stock_item', itemName: item, period: 'all_time', source: 'pattern',
        understoodAs: item ? `Stock of "${titleCase(item)}"` : 'Stock levels' }
    }
  }

  // ── RECEIVABLES / PAYABLES (no specific person) ─────────────────────
  if (/\b(kitna|kul|total|how much)\b.*\b(udhaar|udhar|lena|receivable|owed to me)\b/.test(q)
    || /\b(who owes|kaun.*baaki|kisne.*dena)\b/.test(q)
    || /\b(receivables?|outstanding)\b/.test(q)) {
    return { intent: 'receivables', period: 'all_time', source: 'pattern', understoodAs: 'Money owed to you' }
  }
  // `payables?` — the singular-only version missed the commonest English
  // phrasing of all, "total payables", because \b after "payable" will not
  // match before the "s". Found by the capability registry's own examples.
  if (/\b(payables?|dena hai|maine dena|i owe)\b/.test(q)) {
    return { intent: 'payables', period: 'all_time', source: 'pattern', understoodAs: 'Money you owe' }
  }

  // ── PARTY BALANCE ───────────────────────────────────────────────────
  // "ramesh ka kitna baaki hai" / "how much does ramesh owe"
  // Same matcher the spending branches stand down for — one definition, so the
  // two can never disagree about what a balance question looks like.
  const m = partyBalanceShape(q)
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
  /*
   * ── OPEN A BILL ─────────────────────────────────────────────────────
   *
   * A bill number is unmistakable — INV-0001, CN-0002, SUP-2B-TEST-1. Nobody
   * types one except to look at that bill, so no verb is required.
   */
  const billNo = q.match(/\b((?:inv|cn|dn|sup|est|po)[-\s]?[a-z0-9-]{2,})\b/i)
  if (billNo) {
    const no = billNo[1].replace(/\s+/g, '-').toUpperCase()
    return { intent: 'open_invoice', invoiceNo: no, period: 'all_time', source: 'pattern',
      understoodAs: `Bill ${no}` }
  }

  /*
   * ── OPEN A SCREEN ───────────────────────────────────────────────────
   *
   * LAST, and deliberately so. Placing it earlier would steal questions that
   * already have better answers: "stock dikhao" currently returns stock LEVELS,
   * which is more useful than dropping someone on the inventory screen, and
   * "dikhao" is a perfectly ordinary word in a data question.
   *
   * So a command only wins when nothing else claimed the sentence. By then
   * "GSTR-1 kholo" has been declined by every data branch, which is exactly
   * the case this is for.
   *
   * The verb must be present. Resolving the screen NAME is not done here —
   * nav-match does it, against the same keywords the search box uses.
   */
  // Same OPEN_VERB the early check uses — one definition, so the strict and
  // loose passes can never disagree about what an open command looks like.
  if (OPEN_VERB.test(q)) {
    const target = q.replace(OPEN_VERB, ' ').replace(/\s+/g, ' ').trim()
    if (target.length >= 2) {
      return { intent: 'open_screen', screenName: target, period: 'all_time', source: 'pattern',
        understoodAs: `Open ${target}` }
    }
  }

  // The second clause is the greedy one: "kitna" plus a period, with nothing
  // more specific claimed. It no longer needs a list of subjects to stand down
  // for — spending questions are claimed by the two branches near the top of
  // this function, long before control reaches here.
  if (NAMES_SALES.test(q)
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
