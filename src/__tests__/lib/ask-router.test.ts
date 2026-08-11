/**
 * 🔒 What happens when the model gets it wrong.
 *
 * This is the file that matters in P4.3. `routeWithAi` is thin plumbing; every
 * way a language model can hurt a shopkeeper passes through
 * `interpretToolCall`, and that function is pure, so all of it is testable
 * without a network or a key.
 *
 * THE RULE BEING DEFENDED: every rejection is a REFUSAL, never a REPAIR.
 *
 * It is tempting to be helpful — a model returns period "last_week", so snap
 * it to this_week; it omits the party name, so search for everyone. Both would
 * answer a question nobody asked and put the shopkeeper's own words on top of
 * it. Rule G3: refusing beats guessing, because only one of the two ever gets
 * corrected.
 */

import { describe, test, expect } from '@jest/globals'
import { interpretToolCall, systemPrompt, CAPABILITY_NAMES } from '@/lib/ask-router'
import { CAPABILITIES, toolDefinitions } from '@/lib/ask-capabilities'

const call = (name: string, args: unknown) =>
  interpretToolCall({ name, argumentsJson: JSON.stringify(args) })

describe('interpretToolCall — the good path', () => {
  test('a well-formed call becomes a query', () => {
    const { query } = call('sales_period', { period: 'this_month' })
    expect(query).toMatchObject({ intent: 'sales_period', period: 'this_month', source: 'llm' })
  })

  test('a named party is carried through exactly as the model returned it', () => {
    const { query } = call('party_balance', { party_name: 'Ramesh Kumar' })
    expect(query?.partyName).toBe('Ramesh Kumar')
  })

  test('every answer says a model read it, so an interpretation is visible', () => {
    /*
     * A pattern-matched question was understood exactly. An AI-routed one is
     * an interpretation, and interpretations can be wrong about what someone
     * meant. The shopkeeper is entitled to know which kind they got.
     */
    const { query } = call('party_balance', { party_name: 'Ramesh' })
    expect(query?.understoodAs).toContain('read by AI')
    expect(query?.source).toBe('llm')
  })

  test('a question with no period is not invented one', () => {
    const { query } = call('receivables', {})
    expect(query?.period).toBe('all_time')
  })

  test('expense category is carried, so "kitni salary" does not widen', () => {
    const { query } = call('expenses_period', { period: 'this_month', category: 'salary' })
    expect(query?.categoryName).toBe('salary')
  })
})

describe('interpretToolCall — refusing a model that misbehaves', () => {
  test('a hallucinated capability is refused, not approximated', () => {
    const { query, rejectedBecause } = call('total_cash_in_hand', { period: 'today' })
    expect(query).toBeNull()
    expect(rejectedBecause).toMatch(/unknown capability/)
  })

  test('a plausible-but-wrong name is still refused', () => {
    // "sales_total" was my own first draft of this name. A model trained on
    // similar apps could easily produce it. It is not what we declared.
    expect(call('sales_total', { period: 'today' }).query).toBeNull()
  })

  test('an unsupported period is refused, NOT snapped to the nearest', () => {
    const { query, rejectedBecause } = call('sales_period', { period: 'last_week' })
    expect(query).toBeNull()
    expect(rejectedBecause).toMatch(/unsupported period/)
  })

  test.each([
    ['missing entirely', {}],
    ['empty string', { party_name: '' }],
    ['whitespace only', { party_name: '   ' }],
    ['null', { party_name: null }],
  ])('party_balance with a %s name is refused', (_label, args) => {
    /*
     * THE ONE THAT WOULD PICK A STRANGER. A blank name reaches a `contains: ""`
     * query, which matches EVERY party — so the shopkeeper would be shown the
     * balance of whichever customer sorted first, labelled as the answer to
     * their question.
     */
    const { query } = call('party_balance', args)
    expect(query).toBeNull()
  })

  test.each([
    ['not JSON at all', 'not json'],
    ['an array', '[1,2,3]'],
    ['a bare string', '"hello"'],
    ['null', 'null'],
  ])('arguments that are %s are refused', (_label, argumentsJson) => {
    expect(interpretToolCall({ name: 'sales_period', argumentsJson }).query).toBeNull()
  })

  test('empty arguments are fine for a capability that needs none', () => {
    expect(interpretToolCall({ name: 'receivables', argumentsJson: '' }).query).not.toBeNull()
  })

  test('a period of the wrong TYPE is refused rather than coerced', () => {
    // A number, not a string. Coercing would be the "helpful" thing and wrong.
    expect(call('sales_period', { period: 7 }).query).toBeNull()
  })
})

describe('the contract with the capability registry', () => {
  test('every declared capability can be routed to', () => {
    /*
     * A capability the router cannot produce is invisible — the model may pick
     * it and we would refuse our own feature. Uses only the required args, so
     * this also proves each capability's `required` list is satisfiable.
     */
    const unroutable: string[] = []
    for (const c of CAPABILITIES) {
      const args: Record<string, unknown> = {}
      for (const r of c.parameters.required ?? []) {
        args[r] = r === 'period' ? 'this_month' : 'Something'
      }
      if (!call(c.name, args).query) unroutable.push(c.name)
    }
    expect({ unroutable }).toEqual({ unroutable: [] })
  })

  test('every capability has a human phrase for the "Showing:" line', () => {
    // A missing case would show the raw snake_case name to a shopkeeper.
    const raw: string[] = []
    for (const name of CAPABILITY_NAMES) {
      const args: Record<string, unknown> = { period: 'this_month', party_name: 'X', item_name: 'Y' }
      const q = call(name, args).query
      if (q && q.understoodAs.startsWith(name)) raw.push(name)
    }
    expect({ showingRawNames: raw }).toEqual({ showingRawNames: [] })
  })
})

describe('what the model is allowed to know', () => {
  test('the tools sent on the wire carry no permission or navigation data', () => {
    /*
     * Rule G6. A model that can see which module gates a capability is being
     * invited to reason about access, and access is not its decision — we
     * check it server-side against the staff member's real permissions.
     */
    const wire = JSON.stringify(toolDefinitions())
    expect(wire).not.toContain('module')
    expect(wire).not.toContain('dataLivesAt')
  })

  test('the prompt tells it never to state a figure', () => {
    const p = systemPrompt()
    expect(p).toMatch(/never state amounts/i)
    expect(p).toMatch(/app computes/i)
  })

  test('the prompt tells it that refusing is allowed', () => {
    // Without this, a model asked about the weather picks the nearest
    // capability and answers confidently about the wrong thing.
    expect(systemPrompt()).toMatch(/call no tool at all/i)
  })

  test('the prompt keeps spending and buying apart', () => {
    expect(systemPrompt()).toMatch(/kharcha/)
    expect(systemPrompt()).toMatch(/kharida/)
  })

  test('the prompt forbids advice', () => {
    expect(systemPrompt()).toMatch(/never give business advice/i)
  })
})
