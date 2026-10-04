/**
 * 🔒 GUARD: the design language (final design plan §1), Phase 4a.
 *
 * WHAT IT HOLDS
 *  - Nothing a shopkeeper reads is below 12px. Before Phase 4a the theme had
 *    two steps under the floor (text-3xs 10px, text-2xs 11px) used 551 times,
 *    and charts drew axis labels at 10-11px. All moved to 12px.
 *  - Colour means one thing. Screens use the roles good / bad / check / ai.
 *    Raw palette shades remain from before (2,956 at 4a, 2,729 after 4b); they leave as
 *    each screen is rebuilt in Phases 5-12, so the count may only go DOWN.
 *    When it drops, lower RAW_COLOUR_CEILING to the new number in the same
 *    commit, so the room freed cannot be spent on new raw shades.
 *  - The theme defines every role in light and dark.
 *
 * This replaces the V26 Phase 6 §1.2 micro-typography guard, which protected
 * the 10/11px tokens this phase removed. Its first rule (no text-[Npx]) lives
 * on in smallTextViolations.
 *
 * Each rule is a function in test-support/design-rules.ts, tested first on a
 * known-good and a known-bad input, then swept over the code. That is the
 * CLAUDE.md Cause 7 lesson: a rule you cannot call with two arguments is a
 * comment with a green tick next to it.
 */

/* eslint-disable no-restricted-syntax -- this guard's test inputs ARE the banned patterns */
import { describe, test, expect } from '@jest/globals'
import * as fs from 'fs'
import * as path from 'path'
import { stripComments } from '@/test-support/read-source'
import {
  smallTextViolations, rawMeaningColourCount, missingRoleTokens, themeTextBelowFloor,
} from '@/test-support/design-rules'

/** Comments become spaces, so reported line numbers point at the real line. */
const blankComments = (src: string) => src
  .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
  .replace(/^[ \t]*\/\/[^\n]*$/gm, (m) => ' '.repeat(m.length))

const SRC = path.resolve(process.cwd(), 'src')
const CSS = fs.readFileSync(path.join(SRC, 'app/globals.css'), 'utf8')

/** Ceiling for raw meaning-colour shades in src/. Lower it; never raise it. */
const RAW_COLOUR_CEILING = 2729

function sourceFiles(): { rel: string; code: string }[] {
  const out: { rel: string; code: string }[] = []
  const walk = (dir: string) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, e.name)
      if (e.isDirectory()) { if (e.name !== '__tests__' && e.name !== 'test-support') walk(full) }
      else if (/\.(tsx|ts)$/.test(e.name)) out.push({ rel: path.relative(SRC, full), code: blankComments(fs.readFileSync(full, 'utf8')) })
    }
  }
  walk(SRC)
  return out
}

describe('the rules themselves catch what they claim (good and bad input)', () => {
  test('small text: removed tokens, arbitrary px and chart numbers fail; text-xs passes', () => {
    expect(smallTextViolations('<span className="text-3xs">')).toHaveLength(1)
    expect(smallTextViolations('<span className="text-2xs font-bold">')).toHaveLength(1)
    expect(smallTextViolations('<b className="text-[11px]">')).toHaveLength(1)
    expect(smallTextViolations('<XAxis tick={{ fontSize: 10 }} />')).toHaveLength(1)
    expect(smallTextViolations('<span className="text-xs">\r\n<XAxis tick={{ fontSize: 12 }} />')).toEqual([])
    // CRLF does not hide a violation on the second line
    expect(smallTextViolations('ok\r\n<i className="text-3xs">')[0]).toMatch(/^line 2:/)
  })

  test('raw colour count sees palette shades, not roles or neutrals', () => {
    expect(rawMeaningColourCount('text-green-600 bg-red-50 dark:text-emerald-400 border-amber-200/60')).toBe(4)
    expect(rawMeaningColourCount('text-good bg-bad-soft text-gray-500 text-muted-foreground')).toBe(0)
  })

  test('role tokens: a theme missing the dark value or the mapping is caught', () => {
    const full = [
      '--color-good: var(--good); --color-good-soft: var(--good-soft);',
      '--color-bad: var(--bad); --color-bad-soft: var(--bad-soft);',
      '--color-check: var(--check); --color-check-soft: var(--check-soft);',
      '--color-ai: var(--ai); --color-ai-soft: var(--ai-soft);',
      ...['good', 'good-soft', 'bad', 'bad-soft', 'check', 'check-soft', 'ai', 'ai-soft'].flatMap((n) => [`  --${n}: oklch(0.5 0.1 150);`, `  --${n}: oklch(0.7 0.1 150);`]),
    ].join('\n')
    expect(missingRoleTokens(full)).toEqual([])
    const noDark = full.replace(/\n {2}--ai: oklch\(0\.7 0\.1 150\);/, '')
    expect(missingRoleTokens(noDark)).toEqual(['--ai needs a light and a dark value (found 1)'])
    expect(missingRoleTokens(full.replace('--color-check: var(--check);', ''))).toEqual(['--color-check is not mapped'])
  })

  test('theme floor: a 10px token fails, 12px and line-heights pass', () => {
    expect(themeTextBelowFloor('--text-3xs: 0.625rem;\n--text-3xs--line-height: 1.35;')).toEqual(['--text-3xs: 0.625rem'])
    expect(themeTextBelowFloor('--text-money: 2rem;\n--text-money--line-height: 1.1;\n--text-x: 0.75rem;')).toEqual([])
  })
})

describe('the app keeps the design language', () => {
  const files = sourceFiles()

  test('nothing on screen is set below 12px', () => {
    const violations = files.flatMap(({ rel, code }) => smallTextViolations(code).map((v) => `${rel} ${v}`))
    if (violations.length) {
      throw new Error(
        `\n\n🔒 12px FLOOR (design plan §1, master plan §4).\n` +
        `Use text-xs (12px) at minimum; chart ticks fontSize: 12.\n\n` +
        violations.slice(0, 25).map((v) => `  ${v}`).join('\n') + '\n',
      )
    }
  })

  test('the theme has no text size below the floor', () => {
    expect(themeTextBelowFloor(CSS)).toEqual([])
  })

  test('every colour role is defined in light and dark and mapped for Tailwind', () => {
    expect(missingRoleTokens(CSS)).toEqual([])
  })

  test('raw meaning-colour shades never grow (use text-good, bg-bad-soft, text-check, text-ai…)', () => {
    const count = files.reduce((n, f) => n + rawMeaningColourCount(f.code), 0)
    if (count > RAW_COLOUR_CEILING) {
      throw new Error(
        `\n\n🔒 COLOUR ROLES. Raw palette shades went UP: ${count} > ${RAW_COLOUR_CEILING}.\n` +
        `New code uses the roles: good (money in, done), bad (owed, return, error),\n` +
        `check (needs a look), ai (EkBook did this), each with a -soft surface.\n`,
      )
    }
    // When a rebuild removes shades, the ceiling must follow them down.
    expect(RAW_COLOUR_CEILING - count).toBeLessThan(50)
  })

  test('the two layout-trap rules (#231) are in the theme and the shared Input', () => {
    expect(CSS).toMatch(/\.scroll-col > \*\s*\{\s*flex-shrink:\s*0;/)
    const input = stripComments(fs.readFileSync(path.join(SRC, 'components/ui/input.tsx'), 'utf8'))
    expect(input).toMatch(/\bw-full min-w-0\b/)
  })
})
