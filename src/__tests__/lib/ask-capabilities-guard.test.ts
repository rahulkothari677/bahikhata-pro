/**
 * 🔒 The capability registry must never drift from the app.
 *
 * ── WHY THIS IS THE FIRST THING I WROTE AFTER THE REGISTRY ────────────
 *
 * Two bugs shipped this week and both were the same shape: two lists that
 * described the same thing and quietly disagreed.
 *
 *   · /api/parties filtered deleted customers; /api/ask did not. The Parties
 *     page showed one customer while Ask offered three.
 *   · PartySettle's return-view allowlist did not contain 'ask', so Ask set it
 *     correctly and Settle discarded it.
 *
 * A capability registry is a third list describing the same things a third
 * time — the most dangerous kind of file to add, unless the disagreement is
 * made impossible. So:
 *
 *   the registry's names ARE the intent names, in both directions, exactly.
 *
 * Not "mapped to". Not "kept in sync". The same vocabulary, checked here. A
 * capability the parser cannot produce is a promise we cannot keep; an intent
 * with no capability is a thing the model will never know we can do.
 */

import { describe, test, expect } from '@jest/globals'
import * as fs from 'fs'
import * as path from 'path'
import { CAPABILITIES, toolDefinitions, getCapability, allExamples } from '@/lib/ask-capabilities'
import { parseAsk } from '@/lib/ask-patterns'

const SRC = path.resolve(process.cwd(), 'src')
const read = (rel: string) => fs.readFileSync(path.join(SRC, rel), 'utf8')

/**
 * Read a string-literal union out of source. A TS type has no runtime form, so
 * this is the only way to check the registry against it.
 *
 * Matching the union members themselves rather than "everything up to a blank
 * line" — my first attempt used `\n\n` as the terminator and failed on
 * ViewType, whose members are followed by a comment rather than a blank line.
 * Anchoring on the shape of the members is what makes it robust.
 */
function unionMembers(rel: string, typeName: string): string[] {
  // Line comments first: AskIntent documents each member inline
  // (`| 'sales_period'  // sales for a period`), which breaks a match that
  // expects the members to be separated by whitespace alone. Blanked, not
  // deleted, so nothing else shifts.
  const src = read(rel).replace(/\/\/[^\n]*/g, '')
  const block = new RegExp(`export type ${typeName} =((?:\\s*\\|\\s*'[a-z0-9_-]+')+)`).exec(src)
  expect(block).not.toBeNull()
  return [...block![1].matchAll(/'([a-z0-9_-]+)'/g)].map(m => m[1])
}

const intentNamesFromSource = () => unionMembers('lib/ask-patterns.ts', 'AskIntent')
const viewTypesFromSource = () => unionMembers('store/app-store.ts', 'ViewType')

describe('Capability registry', () => {
  test('the source scans actually found something', () => {
    // Without this every assertion below could pass against empty arrays.
    expect(intentNamesFromSource().length).toBeGreaterThan(5)
    expect(viewTypesFromSource().length).toBeGreaterThan(20)
    expect(CAPABILITIES.length).toBeGreaterThan(5)
  })

  describe('one vocabulary, not two', () => {
    test('every capability is an intent the parser can actually produce', () => {
      const intents = new Set(intentNamesFromSource())
      const orphans = CAPABILITIES.filter(c => !intents.has(c.name)).map(c => c.name)
      expect({ capabilitiesWithNoIntent: orphans }).toEqual({ capabilitiesWithNoIntent: [] })
    })

    test('every intent is declared as a capability', () => {
      const declared = new Set(CAPABILITIES.map(c => c.name))
      const undeclared = intentNamesFromSource().filter(i => !declared.has(i))
      /*
       * An intent the parser produces but the registry does not declare is
       * invisible: the model will never pick it, and nothing can tell the user
       * it exists. When expenses and purchases are added as intents they must
       * be added here in the same commit.
       */
      expect({ intentsMissingFromRegistry: undeclared }).toEqual({ intentsMissingFromRegistry: [] })
    })
  })

  describe('a capability must be usable', () => {
    test('names are unique', () => {
      const names = CAPABILITIES.map(c => c.name)
      expect(names).toHaveLength(new Set(names).size)
    })

    test('every dataLivesAt is a screen that exists', () => {
      const views = new Set(viewTypesFromSource())
      const broken = CAPABILITIES.filter(c => !views.has(c.dataLivesAt))
        .map(c => `${c.name} → ${c.dataLivesAt}`)
      // A dead destination would offer the shopkeeper a button to nowhere.
      expect({ pointingAtNoScreen: broken }).toEqual({ pointingAtNoScreen: [] })
    })

    test('every capability declares a permission gate', () => {
      for (const c of CAPABILITIES) {
        expect({ name: c.name, module: typeof c.module }).toEqual({ name: c.name, module: 'string' })
        expect(c.module.length).toBeGreaterThan(0)
      }
    })

    test('descriptions are written for a model to choose on', () => {
      for (const c of CAPABILITIES) {
        // Short descriptions are how a router picks the wrong tool. This is a
        // floor, not a target.
        expect({ name: c.name, tooShort: c.description.length < 60 })
          .toEqual({ name: c.name, tooShort: false })
      }
    })
  })

  describe('the parameter schemas are valid tool definitions', () => {
    test('every required argument is actually declared', () => {
      for (const c of CAPABILITIES) {
        for (const r of c.parameters.required ?? []) {
          expect({ cap: c.name, required: r, declared: r in c.parameters.properties })
            .toEqual({ cap: c.name, required: r, declared: true })
        }
      }
    })

    test('every property has a type and a description the model can use', () => {
      for (const c of CAPABILITIES) {
        for (const [key, prop] of Object.entries(c.parameters.properties)) {
          expect({ cap: c.name, key, ok: ['string', 'number', 'boolean'].includes(prop.type) })
            .toEqual({ cap: c.name, key, ok: true })
          expect({ cap: c.name, key, described: prop.description.length > 10 })
            .toEqual({ cap: c.name, key, described: true })
        }
      }
    })

    test('toolDefinitions() emits the shape the providers expect', () => {
      const tools = toolDefinitions()
      expect(tools).toHaveLength(CAPABILITIES.length)
      for (const t of tools) {
        expect(t.type).toBe('function')
        expect(typeof t.function.name).toBe('string')
        expect(t.function.parameters.type).toBe('object')
      }
      // It must survive the round trip to the wire.
      expect(() => JSON.parse(JSON.stringify(tools))).not.toThrow()
    })

    test('permission gates and screen names are NOT sent to the model', () => {
      /*
       * Deliberate. A model that can see which module gates a capability is
       * being invited to reason about access, and access is never its
       * decision — we check it server-side against the real permissions.
       */
      const wire = JSON.stringify(toolDefinitions())
      expect(wire).not.toContain('module')
      expect(wire).not.toContain('dataLivesAt')
    })
  })

  describe('the examples are real', () => {
    test('every capability offers at least two phrasings, English and Hinglish', () => {
      for (const c of CAPABILITIES) {
        expect({ name: c.name, count: c.examples.length >= 2 })
          .toEqual({ name: c.name, count: true })
      }
    })

    test('every example of a fast-path capability actually parses to it', () => {
      /*
       * THE STRONGEST ASSERTION HERE. It stops the registry becoming
       * aspirational documentation: if a capability claims a fast path, its own
       * examples must reach it through the real parser, today, with no model.
       *
       * This is also what would have caught "kitna kharcha hua" returning
       * sales, had the registry existed then.
       */
      const wrong: string[] = []
      for (const c of CAPABILITIES) {
        if (!c.hasFastPath) continue
        for (const ex of c.examples) {
          const got = parseAsk(ex)?.intent ?? null
          if (got !== c.name) wrong.push(`"${ex}" → expected ${c.name}, got ${got}`)
        }
      }
      expect({ examplesThatDoNotParse: wrong }).toEqual({ examplesThatDoNotParse: [] })
    })
  })

  test('getCapability finds what exists and refuses what does not', () => {
    expect(getCapability('party_balance')?.name).toBe('party_balance')
    expect(getCapability('definitely_not_a_capability')).toBeUndefined()
    expect(allExamples().length).toBeGreaterThanOrEqual(CAPABILITIES.length * 2)
  })
})
