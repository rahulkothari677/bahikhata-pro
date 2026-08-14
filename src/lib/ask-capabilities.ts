/**
 * What EkBook can be ASKED — declared once, in a standard shape.
 *
 * ── WHY THIS FILE EXISTS ──────────────────────────────────────────────
 *
 * Ask your books grew as 8 hand-written regexes with the answer logic inline
 * in the route. That worked, and it will not scale to "the app does whatever
 * the shopkeeper asks": there is no list of what we can do, so nothing can
 * enumerate it, test it, show it to a model, or tell the user what they may
 * ask. This file is that list.
 *
 * ── WHY OPENAI-SHAPED TOOL DEFINITIONS AND NOT A BESPOKE INTENT TYPE ──
 *
 * I considered inventing our own `{ intent, args }` format — it would be
 * smaller. I am not doing it, for three reasons that all point the same way:
 *
 *   1. NO NEW PLUMBING. voice-parse and scan-bill already call Gemini through
 *      its OpenAI-COMPATIBLE endpoint, with a Groq fallback on the same shape.
 *      Tool definitions in this format are understood by that endpoint as-is,
 *      so the router in P4.3 inherits the provider fallback, the cost logging
 *      and the retry behaviour we already run in production.
 *
 *   2. IT IS THE SHAPE THE INDUSTRY SETTLED ON. Function/tool calling with
 *      JSON Schema parameters is what Gemini, OpenAI, Anthropic and MCP all
 *      speak. A bespoke format would need a translation layer per provider,
 *      and would be the first thing to rewrite when we change model.
 *
 *   3. IT LETS EKBOOK BE CALLED BY OTHER AGENTS LATER. The same declarations
 *      can be served as an MCP server, so a shopkeeper's CA could query these
 *      books from Claude or ChatGPT without us building anything new. That is
 *      a real product direction, and it costs nothing to keep open today.
 *
 * ── WHAT A CAPABILITY MAY AND MAY NOT DO ──────────────────────────────
 *
 * A capability NEVER contains a number and never computes one. It is a
 * declaration: here is a question we can answer, here are the arguments it
 * takes. The handler — ordinary tested code — produces the figure. A model
 * chooses WHICH capability and WITH WHAT ARGUMENTS, and nothing else. If it
 * chooses wrong the shopkeeper sees the wrong screen, which is visible and
 * one tap to correct; it can never see a wrong rupee figure, because no model
 * is ever in the path that produces one.
 *
 * ── TWO FIELDS THAT ARE NOT OPTIONAL ──────────────────────────────────
 *
 * `module` — the permission gate. Enforced SERVER-SIDE against the staff's
 *   real permissions. A model must never be the thing that decides who may
 *   see what; it only names a capability, and we check whether this user is
 *   allowed it. Staff who cannot see profit still cannot, whatever they type.
 *
 * `dataLivesAt` — the screen this answer came from. This is Rahul's "give the
 *   exact button from where it drives the data": every answer can offer the
 *   screen behind it because every capability declares one. Making it a field
 *   rather than per-answer hand-coding is what stops it being forgotten on the
 *   ninth capability.
 */

import type { ModuleKey } from '@/lib/staff-permissions'

/** JSON Schema for a capability's arguments. Deliberately the subset every
 *  provider supports — no $ref, no oneOf, no nested schemas. */
export interface CapabilityParameters {
  type: 'object'
  properties: Record<string, {
    type: 'string' | 'number' | 'boolean'
    description: string
    enum?: readonly string[]
  }>
  required?: readonly string[]
}

export interface Capability {
  /** Stable id. Also the tool name sent to the model — snake_case by convention. */
  name: string
  /**
   * Written for the MODEL to read, not the user. It decides between
   * capabilities on this text alone, so it must say what makes this one
   * different from its neighbours, in plain words.
   */
  description: string
  parameters: CapabilityParameters
  /** Permission gate, enforced server-side. Never by the model. */
  module: ModuleKey
  /** The screen this answer's data lives on — a ViewType, checked by ask-capabilities-guard. */
  dataLivesAt: string
  /**
   * WHERE THE BUTTON SENDS THEM — a nav-registry destination id.
   *
   * 🔒 #61 + #68. These look like the same fact and are not, which is what
   * caused both bugs. `dataLivesAt` answers "which screen computes this
   * figure" and must stay a ViewType because its own guard says so. This
   * answers "where do I send the shopkeeper", and the nav registry is keyed
   * by destination id — and its most useful destinations are not ViewTypes at
   * all: `item-profit` has `actionKind: 'navigate-report'` and no `view`,
   * because reports open by report type.
   *
   * Conflating the two meant top_products sent people to the whole Reports
   * hub when Item-wise Profit is the actual source (#68), and tax_due
   * resolved to nothing at all, so a clean GST month — the moat's own answer
   * — was the one answer with no way out (#61).
   *
   * Optional: when absent, `dataLivesAt` is used, which is correct for the
   * nine capabilities whose screen and destination genuinely are the same.
   */
  opensAt?: string
  /** Real phrasings, English and Hinglish. Used for docs, tests, and few-shot. */
  examples: readonly string[]
  /** True when a pattern in ask-patterns.ts can answer it with no model call. */
  hasFastPath: boolean
}

/** Named stretches of time, shared by every capability that takes one. */
const PERIOD_VALUES = [
  'today', 'yesterday', 'this_week', 'this_month', 'last_month', 'this_fy', 'all_time',
] as const

const periodProperty = {
  type: 'string' as const,
  description:
    'The stretch of time asked about. Use all_time when the question names no period. ' +
    'Indian financial year: this_fy runs 1 April to 31 March.',
  enum: PERIOD_VALUES,
}

/**
 * THE CAPABILITIES.
 *
 * Every one here is IMPLEMENTED today — this file describes what the app can
 * actually do, not what we intend it to do. A capability that is declared but
 * unhandled would let the model promise something we cannot deliver, so
 * `ask-capabilities-guard.test.ts` fails if the two lists ever diverge.
 */
export const CAPABILITIES: readonly Capability[] = [
  {
    name: 'party_balance',
    description:
      'How much one named customer or supplier owes, or is owed. Use when the question names a ' +
      'specific person or business. Returns their running balance and their unpaid bills.',
    parameters: {
      type: 'object',
      properties: {
        party_name: {
          type: 'string',
          description: 'The customer or supplier name exactly as the user said it.',
        },
      },
      required: ['party_name'],
    },
    module: 'parties',
    dataLivesAt: 'party-profile',
    examples: ['Ramesh ka kitna baaki hai', 'how much does Anil Kumar owe', 'Anil ka balance'],
    hasFastPath: true,
  },
  {
    name: 'receivables',
    description:
      'Total money owed TO the shop by all customers together, and who owes it. Use when no ' +
      'single person is named. Not for one named person — use party_balance for that.',
    parameters: { type: 'object', properties: {} },
    module: 'parties',
    dataLivesAt: 'parties',
    examples: ['kisse kitna lena hai', 'who owes me money', 'total receivables'],
    hasFastPath: true,
  },
  {
    name: 'payables',
    description:
      'Total money the shop OWES to suppliers, and to whom. The opposite direction to ' +
      'receivables.',
    parameters: { type: 'object', properties: {} },
    module: 'parties',
    dataLivesAt: 'parties',
    examples: ['kisko kitna dena hai', 'what do I owe', 'total payables'],
    hasFastPath: true,
  },
  {
    name: 'sales_period',
    description:
      'Value of sales over a period, after returns. This is money coming IN from selling. ' +
      'Never use it for money going out — that is spending, which this app cannot answer yet.',
    parameters: { type: 'object', properties: { period: periodProperty }, required: ['period'] },
    module: 'sales',
    dataLivesAt: 'sales',
    examples: ['aaj ki sale', 'is mahine kitni bikri hui', 'sales last month'],
    hasFastPath: true,
  },
  {
    name: 'profit_period',
    description:
      'Gross profit over a period — what was sold minus what it cost. Sensitive: some staff are ' +
      'not permitted to see it, and that is enforced separately.',
    parameters: { type: 'object', properties: { period: periodProperty }, required: ['period'] },
    module: 'reports',
    dataLivesAt: 'reports',
    // The P&L Statement is where this figure is shown, not the Reports hub.
    opensAt: 'pl',
    examples: ['is mahine ka profit', 'kitna munafa hua', 'profit this month'],
    hasFastPath: true,
  },
  {
    name: 'top_products',
    description:
      'Which items sold the most over a period, by value. Use for "what is selling well", not ' +
      'for how much of something is left in stock.',
    parameters: { type: 'object', properties: { period: periodProperty }, required: ['period'] },
    module: 'reports',
    dataLivesAt: 'reports',
    // #68: this figure comes from the Item-wise Profit report, not the hub.
    opensAt: 'item-profit',
    examples: ['sabse zyada kya bika', 'best selling product', 'top items this month'],
    hasFastPath: true,
  },
  {
    name: 'least_products',
    description:
      'Which items sold the LEAST over a period, INCLUDING items that sold nothing at all. Use ' +
      'for "what is not selling", "dead stock", "slow moving". This is the OPPOSITE of ' +
      'top_products — never answer it with top_products. It is about SALES, not about how much ' +
      'is left in stock: for the items with the lowest stock on hand, use stock_item.',
    parameters: { type: 'object', properties: { period: periodProperty }, required: ['period'] },
    module: 'reports',
    dataLivesAt: 'reports',
    /*
     * Inventory Aging is where this lives in depth — it buckets stock by how
     * long since it last sold (Fresh / Slow / Dead). Deliberately NOT
     * item-profit, which lists what DID sell and so cannot show the items this
     * answer is mostly about: the ones with no sale lines at all.
     */
    opensAt: 'inventory-aging',
    examples: ['sabse kam kya bika', 'which product is not selling', 'dead stock', 'slow moving items'],
    hasFastPath: true,
  },
  {
    name: 'stock_item',
    description:
      'How much of an item is left in stock right now. About quantity ON HAND, not about sales ' +
      'or purchases. Omit item_name to list the lowest-stock items.',
    parameters: {
      type: 'object',
      properties: {
        item_name: {
          type: 'string',
          description: 'The product name, if the question names one. Omit to list lowest stock.',
        },
      },
    },
    module: 'inventory',
    dataLivesAt: 'inventory',
    examples: ['chawal ka stock kitna hai', 'how much rice is left', 'stock levels'],
    hasFastPath: true,
  },
  {
    name: 'tax_due',
    description:
      'GST owed to the government for a month — output tax on sales, less credit notes and less ' +
      'input credit. This is the GSTR-3B figure.',
    parameters: { type: 'object', properties: { period: periodProperty } },
    module: 'reports',
    dataLivesAt: 'gst-tax',
    // #61: 'gst-tax' is a valid ViewType but no registry destination, so the
    // GST answer had no button at all. GST Summary is where this figure is
    // shown on screen.
    opensAt: 'gst-summary',
    examples: ['kitna GST bharna hai', 'GST payable this month', 'tax due'],
    hasFastPath: true,
  },
  {
    name: 'expenses_period',
    description:
      'What the shop SPENT on running itself over a period — rent, salary, electricity, ' +
      'transport. Money going OUT, and specifically NOT stock bought for resale, which is ' +
      'purchases_period. Give category to narrow to one kind of spending.',
    parameters: {
      type: 'object',
      properties: {
        period: periodProperty,
        category: {
          type: 'string',
          description:
            'One kind of spending, if the question names one — "rent", "salary", ' +
            '"electricity", "transport". Omit for all spending, broken down by category.',
        },
      },
      required: ['period'],
    },
    module: 'incomeExpense',
    dataLivesAt: 'income-expense',
    examples: ['is mahine kitna kharcha hua', 'how much did I spend this month', 'kitna rent diya'],
    hasFastPath: true,
  },
  {
    name: 'purchases_period',
    description:
      'What the shop spent BUYING STOCK to sell, over a period, after returns to suppliers. ' +
      'Not the same as expenses_period: this is goods for resale, that is the cost of keeping ' +
      'the shop open.',
    parameters: { type: 'object', properties: { period: periodProperty }, required: ['period'] },
    module: 'purchases',
    dataLivesAt: 'purchases',
    examples: ['kal kitna maal kharida', 'how much did I purchase this month', 'is mahine kitna khareeda'],
    hasFastPath: true,
  },
  {
    name: 'open_screen',
    description:
      'Take the shopkeeper to a screen or report in the app. Use when they ask to OPEN, SHOW or GO ' +
      'TO something rather than asking a question about a figure — "open GSTR-1", "GSTR-1 kholo", ' +
      '"profit and loss report dikhao". Pass the screen name exactly as they said it.',
    parameters: {
      type: 'object',
      properties: {
        screen: {
          type: 'string',
          description:
            'The screen or report name as the user said it, without the command word. ' +
            '"GSTR-1 kholo" gives "GSTR-1". Do not guess an internal id.',
        },
      },
      required: ['screen'],
    },
    module: 'dashboard',
    dataLivesAt: 'dashboard',
    examples: ['GSTR-1 kholo', 'open profit and loss report', 'stock report dikhao'],
    hasFastPath: true,
  },
  {
    name: 'open_invoice',
    description:
      'Open one specific bill. Use when a bill number is named ("INV-0001 dikhao"), or when they ' +
      'ask for the most recent bill of a named party ("Anil ka last bill"). Not for totals — ' +
      'sales_period answers "how much did I sell".',
    parameters: {
      type: 'object',
      properties: {
        invoice_no: {
          type: 'string',
          description: 'The bill number if one is named, e.g. "INV-0001". Omit if not.',
        },
        party_name: {
          type: 'string',
          description: 'The customer or supplier, when they ask for the latest bill of that party.',
        },
      },
    },
    module: 'sales',
    dataLivesAt: 'transaction-detail',
    examples: ['INV-0001 dikhao', 'show me bill INV-0002', 'Anil ka last bill'],
    hasFastPath: true,
  },
] as const

/* ── Derived views. One source of truth, several shapes. ──────────────── */

export type CapabilityName = typeof CAPABILITIES[number]['name']

export function getCapability(name: string): Capability | undefined {
  return CAPABILITIES.find(c => c.name === name)
}

/**
 * The capability list in the tool-calling shape every provider understands.
 *
 * Note what is NOT sent: `module` and `dataLivesAt` stay on our side. The model
 * has no business knowing which permission gates a capability — telling it
 * would invite it to reason about access, and access is not its decision.
 */
export function toolDefinitions(): Array<{
  type: 'function'
  function: { name: string; description: string; parameters: CapabilityParameters }
}> {
  return CAPABILITIES.map(c => ({
    type: 'function' as const,
    function: { name: c.name, description: c.description, parameters: c.parameters },
  }))
}

/** Every example phrasing, for tests and for the "things you can ask" list. */
export function allExamples(): string[] {
  return CAPABILITIES.flatMap(c => [...c.examples])
}
