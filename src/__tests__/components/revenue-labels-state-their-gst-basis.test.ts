/**
 * Any figure labelled "revenue" must say whether GST is in it.
 *
 * WHY (2026-08-07, money-correctness sweep). Measured against live production
 * data, the app reports this month's takings three different ways:
 *
 *   ₹10,311.82  dashboard        sales INCLUDING GST
 *   ₹9,848.00   P&L / profit     revenue NET of GST
 *   ₹9,469.32   cashflow         cash actually received
 *
 * All three are correct. They measure different things, and each is internally
 * consistent — the ₹463.82 gap between the first two is exactly the output GST
 * the dashboard itself reports. This was NOT a calculation bug.
 *
 * It is worse than one in a way that matters. A shopkeeper who sees ₹10,311 on
 * the dashboard and ₹9,848 on the P&L has no way to know they are looking at
 * two different questions. The obvious conclusion is that the app lost ₹463 of
 * their money — and an app suspected of losing money is finished, whether or
 * not it actually did. Correct arithmetic presented ambiguously buys nothing.
 *
 * The dashboard already said "incl. GST" and the P&L already said
 * "Revenue (excl. GST)". Only the two profit reports showed a bare "Total
 * Revenue" — the same net-of-GST figure with nothing to say so.
 *
 * WHAT THIS BANS: a card labelled "revenue" that does not state its GST basis.
 * Narrow on purpose — it does not police "sales", "inflow", "profit" or
 * "turnover", because those either already read unambiguously in context or
 * would drag in enough false positives to get the test deleted.
 */
import fs from 'fs'
import path from 'path'

const SRC = path.join(process.cwd(), 'src')

const slash = (p: string) => p.split(path.sep).join('/')

/** This file quotes the broken label in order to explain it. */
const ALLOWED = new Set<string>([
  'src/__tests__/components/revenue-labels-state-their-gst-basis.test.ts',
])

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules') continue
      sourceFiles(full, out)
    } else if (/\.tsx$/.test(entry.name)) {
      out.push(full)
    }
  }
  return out
}

/** `label="...revenue..."` on a stat card, in any casing. */
const REVENUE_LABEL = /label=("|')([^"']*\brevenue\b[^"']*)\1/gi

/** Anything that answers "is GST in this number?" counts. */
const STATES_BASIS = /excl|incl|net of|before tax|after tax|without gst|with gst/i

const files = sourceFiles(SRC)

describe('the scan is not vacuous', () => {
  it('found component files to check', () => {
    expect(files.length).toBeGreaterThan(50)
  })

  it('found revenue labels at all, so the rule has something to bind to', () => {
    const found = files.flatMap((f) => [...fs.readFileSync(f, 'utf8').matchAll(REVENUE_LABEL)])
    expect(found.length).toBeGreaterThan(1)
  })
})

describe('a revenue figure says whether GST is inside it', () => {
  it('holds for every card labelled revenue', () => {
    const offenders: string[] = []

    for (const file of files) {
      const rel = slash(path.relative(process.cwd(), file))
      if (ALLOWED.has(rel)) continue

      const src = fs.readFileSync(file, 'utf8')
      for (const m of src.matchAll(REVENUE_LABEL)) {
        const label = m[2]
        if (STATES_BASIS.test(label)) continue

        const line = src.slice(0, m.index).split('\n').length
        offenders.push(
          `${rel}:${line} — label "${label}" does not say whether GST is included.\n` +
            '    This app reports takings three correct but different ways: with GST ' +
            '(dashboard), net of GST (P&L and the profit reports), and cash received ' +
            '(cashflow). Shown side by side without saying which, the difference reads ' +
            'as the app losing money. Say the basis, as "Revenue (excl. GST)" does.',
        )
      }
    }

    expect(offenders).toEqual([])
  })
})
