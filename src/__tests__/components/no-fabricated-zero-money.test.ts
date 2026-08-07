/**
 * A screen never invents ₹0 for money it did not read.
 *
 * WHY (2026-08-07, money sweep). Six screens opened with a line like:
 *
 *   const summary = data?.summary || { totalRevenue: 0, totalProfit: 0, ... }
 *
 * Each was added to stop a crash, and each does. What they put on screen
 * instead is a shop that earned ₹0 and made ₹0 profit — as confidently as real
 * figures, with nothing marking them as invented.
 *
 * For a ledger that is the worst available failure. A blank says "I don't know"
 * and the shopkeeper waits; a fabricated ₹0 says "your month was empty" and
 * they believe it, because the app has never lied to them before.
 *
 * The dashboard's version was worse still: its fallback object had keys
 * totalCGST / totalTax while every reader wanted cgst / netPayable. Had it ever
 * fired it would have rendered `undefined` through formatINR — a fallback that
 * had never been checked against its own consumers.
 *
 * WHAT THIS BANS: an object literal of all-zero money fields used as a `||`
 * fallback, in components. Guarded here rather than left to review because the
 * shape is so reasonable-looking — it reads as defensive programming, and it is
 * the opposite.
 *
 * NOT BANNED: the identical literal in src/app/api. There it is an accumulator
 * seed — `map.get(key) || { revenue: 0, profit: 0 }` before summing into it —
 * where zero is genuinely the starting value rather than a claim about a shop.
 * Same text, opposite meaning, which is why this only looks at components.
 */
import fs from 'fs'
import path from 'path'

const COMPONENTS = path.join(process.cwd(), 'src/components')

const slash = (p: string) => p.split(path.sep).join('/')

/** This file quotes the banned shape in order to explain it. */
const ALLOWED = new Set<string>([
  'src/__tests__/components/no-fabricated-zero-money.test.ts',
  // Quotes the banned shape in its header to explain what it replaces.
  'src/components/reports/ReportUnavailable.tsx',
])

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) sourceFiles(full, out)
    else if (/\.tsx?$/.test(entry.name)) out.push(full)
  }
  return out
}

/**
 * `|| { something: 0, somethingElse: 0, ... }` — two or more zero fields.
 *
 * Two is the threshold on purpose. A single `|| { count: 0 }` is usually a
 * genuine empty-state default; a cluster of zeroed money fields is a summary
 * object being conjured. Requiring at least one money-ish key keeps quantity
 * and pagination defaults out of it, because a guard that fires on those gets
 * switched off, and the real thing comes back with it.
 */
const ZERO_FALLBACK = /\|\|\s*\{[^{}]*\b\w+\s*:\s*0\b[^{}]*\b\w+\s*:\s*0\b[^{}]*\}/g
const MONEY_KEY = /total|revenue|profit|amount|value|tax|cgst|sgst|igst|payable|receivable|balance|cash|inflow|outflow|cogs|price/i

const files = sourceFiles(COMPONENTS)

describe('the scan is not vacuous', () => {
  it('found component files to check', () => {
    expect(files.length).toBeGreaterThan(40)
  })

  it('still recognises the shape it is banning', () => {
    const sample = "const s = data?.summary || { totalRevenue: 0, totalProfit: 0 }"
    expect([...sample.matchAll(ZERO_FALLBACK)].length).toBe(1)
  })
})

describe('no screen fabricates ₹0 for money it never read', () => {
  it('holds across every component', () => {
    const offenders: string[] = []

    for (const file of files) {
      const rel = slash(path.relative(process.cwd(), file))
      if (ALLOWED.has(rel)) continue

      const src = fs.readFileSync(file, 'utf8')
      for (const m of src.matchAll(ZERO_FALLBACK)) {
        if (!MONEY_KEY.test(m[0])) continue
        const line = src.slice(0, m.index).split('\n').length
        offenders.push(
          `${rel}:${line} — ${m[0].replace(/\s+/g, ' ').slice(0, 90)}\n` +
            '    This puts ₹0 on screen for figures the app never read, stated as ' +
            'confidently as real ones. A shopkeeper reads it as "my month was empty". ' +
            'Render an unavailable state instead (see ReportUnavailable), or a dash.',
        )
      }
    }

    expect(offenders).toEqual([])
  })
})
