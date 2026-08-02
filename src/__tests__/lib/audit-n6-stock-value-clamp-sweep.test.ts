/**
 * 🔒 AUDIT N6 (sweep) — "stock value" is computed in FOUR places. All four must
 * clamp oversold stock to zero.
 *
 * A product sold below zero has already had its value realised through the
 * sale. Counting it as NEGATIVE inventory understates what is on the shelves.
 *
 * N6 was exactly this: the consolidated report was the one site that did NOT
 * clamp, so a shop with any oversold line showed a lower stock value there than
 * on its own dashboard — a difference a multi-shop owner would read as a real
 * business signal.
 *
 * The JS site is covered behaviourally by audit-pass1-stock-value-parity.test.ts.
 * The three SQL sites cannot be unit-tested without a live database, so this
 * file asserts the clamp is PRESENT in each of their queries. That is weaker
 * than a behavioural test, but it is the difference between "someone would
 * notice" and "nobody would" — the N6 bug survived precisely because no test
 * looked at these sites at all.
 */

import fs from 'fs'
import path from 'path'

/** Each SQL site that multiplies stock by a price to get a value. */
const SQL_SITES = [
  { file: 'src/app/api/dashboard/route.ts', what: 'dashboard "Stock Value" KPI' },
  { file: 'src/app/api/reports/route.ts', what: 'stock report totals' },
  { file: 'src/app/api/analytics/route.ts', what: 'dead-stock tied-up value ordering' },
]

function readCode(rel: string): string {
  const src = fs.readFileSync(path.join(process.cwd(), rel), 'utf8')
  // Strip comments — several of these files discuss the clamp in prose, and a
  // comment mentioning GREATEST must not satisfy the assertion.
  return src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/.*$/gm, ' ')
}

/**
 * Find every place a price column is multiplied by stock, and report whether
 * the stock side is clamped.
 *
 * Done with a lookback window rather than one regex: the expression contains
 * nested parentheses — `ROUND(GREATEST("currentStock", 0)::numeric * "purchasePrice"::numeric)`
 * — so a character class excluding ')' can never match it. (My first attempt
 * did exactly that and found zero sites, which is the failure mode where a
 * guard silently protects nothing.)
 */
function findStockValueExpressions(code: string): Array<{ snippet: string; clamped: boolean }> {
  const out: Array<{ snippet: string; clamped: boolean }> = []
  const priceRe = /"(?:purchasePrice|salePrice)"/g
  let m: RegExpExecArray | null
  while ((m = priceRe.exec(code)) !== null) {
    const start = Math.max(0, m.index - 160)
    const window = code.slice(start, m.index + m[0].length)
    // Only interested where this price is multiplied by currentStock.
    if (!/currentStock/.test(window)) continue
    if (!/\*/.test(window)) continue
    out.push({
      snippet: window.replace(/\s+/g, ' ').trim().slice(-110),
      clamped: /GREATEST\(\s*[\w.]*"currentStock"\s*,\s*0\s*\)/.test(window),
    })
  }
  return out
}

describe('N6 sweep — every stock-value SQL site clamps oversold stock', () => {
  test.each(SQL_SITES)('$what clamps currentStock at 0', ({ file }) => {
    const exprs = findStockValueExpressions(readCode(file))

    // Guard the guard: if the scan finds nothing, it is protecting nothing.
    expect(exprs.length).toBeGreaterThan(0)

    const unclamped = exprs.filter(e => !e.clamped)
    expect(unclamped.map(e => e.snippet)).toEqual([])
  })

  test('no SQL site multiplies raw currentStock by a price without clamping', () => {
    // Belt-and-braces across the whole API surface: catches a NEW site added
    // later that forgets the clamp, which is how N6 happened in the first place.
    const offenders: string[] = []

    const walk = (dir: string) => {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, e.name)
        if (e.isDirectory()) { walk(p); continue }
        if (!/\.tsx?$/.test(e.name)) continue
        const code = readCode(path.relative(process.cwd(), p))
        for (const e of findStockValueExpressions(code)) {
          if (!e.clamped) {
            offenders.push(`${path.relative(process.cwd(), p)}: …${e.snippet}`)
          }
        }
      }
    }

    walk(path.join(process.cwd(), 'src', 'app', 'api'))
    walk(path.join(process.cwd(), 'src', 'lib'))

    if (offenders.length > 0) {
      throw new Error(
        'Found stock-value SQL that does not clamp oversold stock to zero:\n\n' +
        offenders.map(o => '  ' + o).join('\n') +
        '\n\nWrap the quantity in GREATEST("currentStock", 0). An oversold product ' +
        'has already had its value realised through the sale; counting it as ' +
        'negative inventory understates stock value and makes this screen ' +
        'disagree with every other one. See N6 in docs/audit/.',
      )
    }

    expect(offenders).toEqual([])
  })
})
