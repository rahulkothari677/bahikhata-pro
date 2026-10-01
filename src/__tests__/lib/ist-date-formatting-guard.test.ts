/**
 * 🔒 IST DATE-FORMATTING GUARD
 *
 * WHY THIS EXISTS
 * ---------------
 * The shop runs in IST (UTC+5:30). `date.toISOString().slice(0, 10)` returns
 * the **UTC** calendar date, so any instant before 05:30 IST formats as the
 * PREVIOUS day. This defect has now appeared three separate times:
 *
 *   1. GSTR month labels showed the previous month.
 *   2. The Income/Expense summary reported its range starting a day early
 *      (a range from 15 Jan was labelled "2026-01-14").
 *   3. The Day-End Summary stamped itself with YESTERDAY's date, every day —
 *      `istDayStart(now)` is the UTC instant of IST midnight (18:30 the prior
 *      day in UTC), and the code even carried a comment claiming "(IST)".
 *
 * In a ledger these are not cosmetic: the date on a financial summary is what
 * the shopkeeper quotes to their accountant.
 *
 * `istDateString()` / `istYearMonth()` exist for this. These tests pin the
 * behaviour and keep the known offenders honest.
 */

import { istDateString, istYearMonth, istDayStart, istMonthStart } from '@/lib/timezone'
import fs from 'fs'
import path from 'path'

/**
 * THE CLASS, NOT THE INSTANCES (1 Oct 2026, #158).
 *
 * The tests further down pinned two known files. Meanwhile 21 other call sites
 * kept formatting "today" as the UTC day — including the default date of every
 * new sale, so a bill made at 00:30 on 1 November was dated 31 October and
 * landed in October's GST return. Pinning instances let the class grow.
 *
 * So the rule is now a function, run against known-good and known-bad code
 * below, and then swept over every source file.
 */
const UTC_DAY_OR_MONTH =
  /\.toISOString\(\)\s*\.\s*(?:(?:slice|substring)\(\s*0\s*,\s*(?:7|10)\s*\)|split\(\s*['"]T['"]\s*\)\s*\[\s*0\s*\])/g

/**
 * Line numbers (1-based) where code — not comments — takes the UTC day or month.
 *
 * Comments are blanked IN PLACE (newlines kept), unlike `stripComments`, so the
 * line a failure names is the line in the file. The first version reported
 * "line 125" for a bug on line 134.
 */
function findUtcDayOrMonthSlices(source: string): number[] {
  const code = source
    .replace(/\/\*[\s\S]*?\*\//g, block => block.replace(/[^\n]/g, ''))
    .replace(/^[ \t]*\/\/[^\n]*$/gm, '')
  const hits: number[] = []
  code.split(/\r?\n/).forEach((line, i) => {
    UTC_DAY_OR_MONTH.lastIndex = 0
    if (UTC_DAY_OR_MONTH.test(line)) hits.push(i + 1)
  })
  return hits
}

/**
 * The only places allowed to keep the UTC slice, each for a stated reason.
 * A count, not a yes/no: a second slice added to one of these files fails.
 */
const ALLOWED: Record<string, { count: number; why: string }> = {
  'src/app/api/bank-recon/import/route.ts': {
    count: 1,
    why: 'Part of a stored de-duplication hash; changing it would make re-imported statements look new.',
  },
  'src/app/api/parties/[id]/route.ts': {
    count: 2,
    why: 'Both sides read naive IST month-start timestamps as UTC on purpose (documented at the call site).',
  },
  'src/app/api/debug/repair-headers/route.ts': {
    count: 1,
    why: 'Debug-only repair route, not user-facing; left unchanged in Phase 1a.',
  },
}

function sourceFiles(dir: string): string[] {
  const out: string[] = []
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      if (entry.name === '__tests__' || entry.name === 'test-support' || entry.name === 'node_modules') continue
      out.push(...sourceFiles(full))
    } else if (/\.(ts|tsx)$/.test(entry.name)) {
      out.push(full)
    }
  }
  return out
}

describe('the UTC-day rule itself', () => {
  test('catches every spelling of the UTC day or month', () => {
    expect(findUtcDayOrMonthSlices("const d = new Date().toISOString().slice(0, 10)")).toEqual([1])
    expect(findUtcDayOrMonthSlices("const d = x.toISOString().slice(0,10)")).toEqual([1])
    expect(findUtcDayOrMonthSlices("const m = x.toISOString().slice(0, 7)")).toEqual([1])
    expect(findUtcDayOrMonthSlices("const d = x.toISOString().split('T')[0]")).toEqual([1])
    expect(findUtcDayOrMonthSlices('const d = x.toISOString().substring(0, 10)')).toEqual([1])
  })

  test('ignores comments, the IST helper, and full timestamps', () => {
    expect(findUtcDayOrMonthSlices('// was x.toISOString().slice(0, 10)')).toEqual([])
    expect(findUtcDayOrMonthSlices('/* x.toISOString().slice(0, 10) */')).toEqual([])
    expect(findUtcDayOrMonthSlices('const d = istDateString(new Date())')).toEqual([])
    expect(findUtcDayOrMonthSlices('const at = new Date().toISOString()')).toEqual([])
  })

  test('reports the right line on Windows line endings', () => {
    expect(findUtcDayOrMonthSlices('const a = 1\r\nconst d = x.toISOString().slice(0, 10)\r\n')).toEqual([2])
  })

  test('reports the real line number after a multi-line comment', () => {
    const src = '/**\n * one\n * two\n */\nconst d = x.toISOString().slice(0, 10)'
    expect(findUtcDayOrMonthSlices(src)).toEqual([5])
  })
})

describe('no source file takes the UTC day or month', () => {
  test('every hit outside the allow-list is a bug', () => {
    const root = path.join(process.cwd(), 'src')
    const offenders: string[] = []
    for (const file of sourceFiles(root)) {
      const rel = path.relative(process.cwd(), file).split(path.sep).join('/')
      const hits = findUtcDayOrMonthSlices(fs.readFileSync(file, 'utf8'))
      const allowed = ALLOWED[rel]?.count ?? 0
      if (hits.length > allowed) offenders.push(`${rel}: lines ${hits.join(', ')}`)
    }
    expect(offenders).toEqual([])
  })

  test('every allow-listed file still has its exception (no stale entries)', () => {
    for (const [rel, { count }] of Object.entries(ALLOWED)) {
      const hits = findUtcDayOrMonthSlices(fs.readFileSync(path.join(process.cwd(), rel), 'utf8'))
      expect({ rel, hits: hits.length }).toEqual({ rel, hits: count })
    }
  })
})

describe('IST date formatting', () => {
  describe('istDateString returns the IST calendar date, not the UTC one', () => {
    test('IST midnight formats as that IST day (the Day-End Summary bug)', () => {
      // 15 Jan 2026 00:00 IST === 14 Jan 2026 18:30 UTC.
      const istMidnightUtcInstant = new Date('2026-01-14T18:30:00.000Z')
      expect(istDateString(istMidnightUtcInstant)).toBe('2026-01-15')
      // What the buggy code produced:
      expect(istMidnightUtcInstant.toISOString().slice(0, 10)).toBe('2026-01-14')
    })

    test('early-morning IST times keep the correct day', () => {
      // 2 AM IST on 1 Jul 2026 === 30 Jun 2026 20:30 UTC.
      const earlyMorningIst = new Date('2026-06-30T20:30:00.000Z')
      expect(istDateString(earlyMorningIst)).toBe('2026-07-01')
    })

    test('istDayStart round-trips through istDateString', () => {
      // Whatever instant istDayStart returns, formatting it must give back the
      // same IST calendar day — this is exactly what day-summary relies on.
      for (const iso of ['2026-01-15T03:00:00+05:30', '2026-07-21T23:45:00+05:30']) {
        const d = new Date(iso)
        expect(istDateString(istDayStart(d))).toBe(istDateString(d))
      }
    })

    test('istYearMonth returns the IST month (the GSTR label bug)', () => {
      // 1 Jul 2026 00:30 IST === 30 Jun 2026 19:00 UTC.
      const firstOfMonthIst = new Date('2026-06-30T19:00:00.000Z')
      expect(istYearMonth(firstOfMonthIst)).toBe('2026-07')
      expect(firstOfMonthIst.toISOString().slice(0, 7)).toBe('2026-06') // the bug
      expect(istYearMonth(istMonthStart(firstOfMonthIst))).toBe('2026-07')
    })
  })

  describe('known offenders stay fixed', () => {
    const read = (p: string) => fs.readFileSync(path.join(process.cwd(), p), 'utf8')

    test('day-summary stamps its date in IST', () => {
      const src = read('src/app/api/day-summary/route.ts')
      expect(src).toMatch(/date:\s*istDateString\(startOfToday\)/)
      expect(src).not.toMatch(/date:\s*startOfToday\.toISOString\(\)/)
    })

    test('income/expense summary reports its range in IST', () => {
      const src = read('src/lib/income-expense-summary.ts')
      expect(src).toMatch(/from:\s*istDateString\(from\)/)
      expect(src).toMatch(/to:\s*istDateString\(to\)/)
    })
  })
})
