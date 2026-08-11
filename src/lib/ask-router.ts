/**
 * The AI translator — Phase 4.3.
 *
 * ── THE ONE RULE ──────────────────────────────────────────────────────
 *
 * THE MODEL NEVER PRODUCES A NUMBER. It is given a question and the list of
 * capabilities, and it returns which capability was meant and with what
 * arguments. That is all. Every rupee figure is computed afterwards by the
 * same tested code the screens use.
 *
 * If the model misunderstands, the shopkeeper gets the wrong SCREEN — visible,
 * annoying, one tap to fix, and the "Showing: …" line says what was read. If
 * the model produced figures, they would get a wrong NUMBER, which is
 * invisible and ends up in a GST return. That asymmetry is the entire reason
 * this file is shaped the way it is.
 *
 * ── WHAT THE MODEL IS ALLOWED TO SEE ──────────────────────────────────
 *
 * The question, and the capability declarations. NOT the books. No party
 * names, no balances, no invoice numbers, nothing from the database. When the
 * shopkeeper asks about "Ramesh", the model returns the STRING "Ramesh" and
 * our own code does the lookup. The ledger never leaves the building, which is
 * both the privacy answer and the correctness one.
 *
 * ── WHY PATTERNS STILL RUN FIRST ──────────────────────────────────────
 *
 * The caller tries `parseAsk` before ever reaching here. Patterns are instant,
 * free, work with no signal, and cannot hallucinate. The model exists for the
 * long tail — the phrasings nobody wrote a rule for. Roughly the common
 * questions cost nothing and the unusual ones cost a paisa or two.
 *
 * ── THE FILE IS SPLIT SO THE DANGEROUS PART NEEDS NO NETWORK ───────────
 *
 * `interpretToolCall` is pure. It is where a wrong answer would actually come
 * from — a hallucinated capability, an out-of-range period, a missing required
 * argument — and it is fully tested without touching a provider. `routeWithAi`
 * is the thin part that makes the HTTP call.
 */

import { CAPABILITIES, getCapability, toolDefinitions } from '@/lib/ask-capabilities'
import type { AskQuery, AskPeriod } from '@/lib/ask-patterns'

/** Periods the app understands. Anything else from the model is rejected. */
const VALID_PERIODS: readonly AskPeriod[] = [
  'today', 'yesterday', 'this_week', 'this_month', 'last_month', 'this_fy', 'all_time',
]

/** What a provider hands back when it picks a tool. */
export interface RawToolCall {
  name: string
  /** JSON string, as every OpenAI-compatible provider sends it. */
  argumentsJson: string
}

export interface InterpretResult {
  query: AskQuery | null
  /** Why it was rejected — for logging, never shown raw to the shopkeeper. */
  rejectedBecause?: string
}

/**
 * Turn a provider's tool call into a query we will actually run — or reject it.
 *
 * EVERY REJECTION HERE IS A REFUSAL, NEVER A REPAIR. It is tempting to "fix"
 * a model that returns period: "last_week" by snapping it to this_week. That
 * would answer a question nobody asked and label it as theirs. Rule G3:
 * refusing beats guessing, because only one of the two ever gets corrected.
 */
export function interpretToolCall(call: RawToolCall): InterpretResult {
  const capability = getCapability(call.name)
  if (!capability) {
    // A hallucinated capability. The model was given the list; if it invented
    // something outside it, nothing good follows from trying to honour it.
    return { query: null, rejectedBecause: `unknown capability "${call.name}"` }
  }

  let args: Record<string, unknown>
  try {
    const parsed = JSON.parse(call.argumentsJson || '{}')
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return { query: null, rejectedBecause: 'arguments were not an object' }
    }
    args = parsed as Record<string, unknown>
  } catch {
    return { query: null, rejectedBecause: 'arguments were not valid JSON' }
  }

  // Required arguments must actually be present and non-empty. A party_balance
  // with no name would search for "" and match the first customer in the shop.
  for (const required of capability.parameters.required ?? []) {
    const v = args[required]
    if (v === undefined || v === null || (typeof v === 'string' && !v.trim())) {
      return { query: null, rejectedBecause: `missing required argument "${required}"` }
    }
  }

  /*
   * ABSENT is fine. PRESENT-BUT-WRONG is not.
   *
   * My first version read `typeof args.period === 'string' ? args.period :
   * undefined`, which silently DROPPED a period of the wrong type — a model
   * returning `period: 7` fell through to all_time. That is the coercion this
   * whole function exists to refuse: the model tried to say something about
   * time, we ignored it, and answered a different question under the
   * shopkeeper's own words. Caught by its own test before it shipped.
   */
  let period: AskPeriod = 'all_time'
  if ('period' in args && args.period !== undefined) {
    const raw = args.period
    if (typeof raw !== 'string' || !VALID_PERIODS.includes(raw as AskPeriod)) {
      return { query: null, rejectedBecause: `unsupported period ${JSON.stringify(raw)}` }
    }
    period = raw as AskPeriod
  }

  const str = (k: string) => {
    const v = args[k]
    return typeof v === 'string' && v.trim() ? v.trim() : undefined
  }

  return {
    query: {
      // Capability names ARE intent names — asserted by
      // ask-capabilities-guard. That is why no mapping table exists here.
      intent: capability.name as AskQuery['intent'],
      partyName: str('party_name'),
      itemName: str('item_name'),
      categoryName: str('category'),
      period,
      source: 'llm',
      /*
       * SAY THAT A MODEL READ IT. The shopkeeper should be able to tell an
       * exactly-matched question from an interpreted one, because the second
       * kind is the kind that can be wrong about what they meant.
       */
      understoodAs: `${describeCapability(capability.name, args)} · read by AI`,
    },
  }
}

/** A short human phrase for the "Showing:" line. */
function describeCapability(name: string, args: Record<string, unknown>): string {
  const period = typeof args.period === 'string' ? args.period.replace(/_/g, ' ') : undefined
  const party = typeof args.party_name === 'string' ? args.party_name : undefined
  const item = typeof args.item_name === 'string' ? args.item_name : undefined
  const category = typeof args.category === 'string' ? args.category : undefined

  switch (name) {
    case 'party_balance': return `Balance for "${party}"`
    case 'receivables': return 'Money owed to you'
    case 'payables': return 'Money you owe'
    case 'sales_period': return `Sales · ${period ?? 'all time'}`
    case 'profit_period': return `Profit · ${period ?? 'all time'}`
    case 'top_products': return `Top selling products · ${period ?? 'all time'}`
    case 'stock_item': return item ? `Stock of "${item}"` : 'Stock levels'
    case 'tax_due': return `GST payable · ${period ?? 'this month'}`
    case 'expenses_period':
      return category
        ? `${category} spending · ${period ?? 'this month'}`
        : `Expenses · ${period ?? 'this month'}`
    case 'purchases_period': return `Purchases · ${period ?? 'this month'}`
    default: return name
  }
}

/**
 * The instruction the model is given.
 *
 * Short on purpose. A long prompt is a long list of things that can conflict
 * with the tool descriptions, which are the actual specification — those live
 * in ask-capabilities and are written for the model to choose on.
 */
export function systemPrompt(): string {
  return [
    'You route a shopkeeper\'s question to exactly one capability of an Indian accounting app.',
    'The questions come in English, Hinglish (romanised Hindi), or a mix.',
    '',
    'Rules:',
    '- Pick the ONE capability that answers what was asked. Never invent one.',
    '- You never state amounts, totals or any figure. The app computes those.',
    '- If the question names no period, use all_time and let the app default it.',
    '- "kharcha" is running costs (expenses). "kharida" is buying stock (purchases).',
    '  They are different questions; do not merge them.',
    '- If no capability fits — the weather, advice, anything outside the books —',
    '  call no tool at all. Refusing is correct and expected.',
    '- Never give business advice or opinions, only route factual questions.',
  ].join('\n')
}

export interface RouteOutcome {
  query: AskQuery | null
  provider?: string
  model?: string
  inputTokens?: number
  outputTokens?: number
  durationMs?: number
  rejectedBecause?: string
}

const GEMINI_MODEL = process.env.GEMINI_ASK_MODEL || 'gemini-3.5-flash-lite'
const GROQ_MODEL = 'llama-3.3-70b-versatile'

/** Hard ceiling. A shopkeeper waiting on a phone will retype long before this. */
const TIMEOUT_MS = 8000

async function callProvider(
  url: string, apiKey: string, model: string, question: string,
): Promise<{ call: RawToolCall | null; inputTokens: number; outputTokens: number }> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      signal: controller.signal,
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: systemPrompt() },
          { role: 'user', content: question },
        ],
        tools: toolDefinitions(),
        // 'auto', not 'required': the model MUST be able to choose nothing.
        // Forcing a tool would make "what is the weather" pick the nearest
        // capability and answer confidently about the wrong thing.
        tool_choice: 'auto',
        temperature: 0,
        max_tokens: 300,
      }),
    })
    if (!res.ok) return { call: null, inputTokens: 0, outputTokens: 0 }
    const data = await res.json()
    const usage = data?.usage || {}
    const toolCall = data?.choices?.[0]?.message?.tool_calls?.[0]
    return {
      call: toolCall?.function?.name
        ? { name: toolCall.function.name, argumentsJson: toolCall.function.arguments ?? '{}' }
        : null,
      inputTokens: usage.prompt_tokens || 0,
      outputTokens: usage.completion_tokens || 0,
    }
  } catch {
    // Timeout, network, or a malformed body. The caller falls back or refuses;
    // either way the shopkeeper gets an honest answer rather than a hang.
    return { call: null, inputTokens: 0, outputTokens: 0 }
  } finally {
    clearTimeout(timer)
  }
}

/**
 * Ask a model which capability was meant.
 *
 * Gemini first, Groq second — the same order and the same keys voice-parse
 * already uses in production. See task #48: that route has its own older copy
 * of this chain, and the two should converge before a third caller exists.
 *
 * Returns `{ query: null }` for every failure — no key, no provider, timeout,
 * hallucinated capability, bad arguments. The caller then says "I can't answer
 * that one yet", which is the same honest outcome the parser gives.
 */
export async function routeWithAi(question: string): Promise<RouteOutcome> {
  const started = Date.now()
  const geminiKey = process.env.GEMINI_API_KEY
  const groqKey = process.env.GROQ_API_KEY

  const attempts: Array<{ provider: string; url: string; key?: string; model: string }> = [
    {
      provider: 'gemini',
      url: 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions',
      key: geminiKey,
      model: GEMINI_MODEL,
    },
    {
      provider: 'groq',
      url: 'https://api.groq.com/openai/v1/chat/completions',
      key: groqKey,
      model: GROQ_MODEL,
    },
  ]

  for (const attempt of attempts) {
    if (!attempt.key) continue
    const { call, inputTokens, outputTokens } = await callProvider(
      attempt.url, attempt.key, attempt.model, question,
    )
    if (!call) continue

    const { query, rejectedBecause } = interpretToolCall(call)
    return {
      query,
      rejectedBecause,
      provider: attempt.provider,
      model: attempt.model,
      inputTokens,
      outputTokens,
      durationMs: Date.now() - started,
    }
  }

  return { query: null, durationMs: Date.now() - started, rejectedBecause: 'no provider answered' }
}

/** Exported for the guard test: every capability must be describable. */
export const CAPABILITY_NAMES = CAPABILITIES.map(c => c.name)
