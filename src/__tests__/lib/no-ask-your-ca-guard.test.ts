/**
 * 🔒 GUARD: "ask your CA" is never an answer (#346, 1 Nov 2026).
 *
 * Many EkBook users have no CA. A screen that ends on "ask your CA" leaves
 * them with nothing to do. Every law question gets settled from the rule
 * text and shown as a plain fix (CLAUDE.md, Cause 1). Sharing with a CA is
 * still fine ("Paste it to your CA", the read-only CA account). DEFERRING to
 * one is not.
 *
 * The rule is a function, tested on good and bad input first (Cause 7), then
 * swept over every string in the app's code, with comments stripped.
 */

import { describe, test, expect } from '@jest/globals'
import * as fs from 'fs'
import * as path from 'path'
import { stripComments } from '@/test-support/read-source'

const SRC = path.resolve(process.cwd(), 'src')
/** Legal pages: the terms say EkBook is not tax advice, and that is their job. */
const NOT_SCREENS = ['app/terms', 'app/privacy']

/** Wording that hands the question to a CA instead of answering it. */
export function defersToCa(text: string): boolean {
  return /\b(ask|check with|speak to|consult|show (these|this|them) to|worth checking with)\b[^.'"`]{0,20}\b(your|a|the) CA\b/i.test(text)
    || /\bwith your CA\b/i.test(text)
}

describe('the rule catches what it claims', () => {
  test.each([
    'Please ask your CA before relying on this.',
    'Check this one with your CA — interest may apply.',
    'Speak to your CA before billing this.',
    'Show these to your CA.',
    'Worth checking with your CA.',
    'Ask your CA how to correct it.',
  ])('bad: %s', (t) => expect(defersToCa(t)).toBe(true))

  test.each([
    'Copied. Paste it to your CA.',
    'Your CA account has read-only access. Ask the shop owner to make changes.',
    'These 30/60/90-day groups are how your CA reads money owed.',
    'Reverse this credit in GSTR-3B Table 4(B)(2).',
  ])('fine: %s', (t) => expect(defersToCa(t)).toBe(false))
})

describe('the sweep', () => {
  test('no screen or message in the app defers to a CA', () => {
    const hits: string[] = []
    const walk = (dir: string) => {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, e.name)
        const rel = path.relative(SRC, full).split(path.sep).join('/')
        if (e.isDirectory()) { if (e.name !== '__tests__' && e.name !== 'test-support') walk(full); continue }
        if (!/\.tsx?$/.test(e.name) || NOT_SCREENS.some((p) => rel.startsWith(p))) continue
        stripComments(fs.readFileSync(full, 'utf8')).split('\n').forEach((line, i) => {
          if (defersToCa(line)) hits.push(`${rel}:${i + 1}  ${line.trim().slice(0, 120)}`)
        })
      }
    }
    walk(SRC)
    expect(hits).toEqual([])
  })
})
