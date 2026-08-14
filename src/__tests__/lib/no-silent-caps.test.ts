/**
 * 🔒 #71 — a silent cap is a lie with a number on it.
 *
 * Rahul asked whether a shop using EkBook for five years, writing 200
 * transactions a day, would still get the RIGHT answers. Auditing that found
 * a family of `take: N` limits which do not slow an answer down — they change
 * it, and say nothing:
 *
 *   top products      read the first 2,000 sale lines. Five years at 200/day
 *                     is around a million lines, so "your best seller" came
 *                     from roughly 0.2% of the shop's sales.
 *   receivables       fetched at most 500 party names, so bigger shops saw
 *                     "(unnamed)" — AND the total was summed AFTER trimming
 *                     to the top 20, so the headline figure was short.
 *   gstr-1            capped the cross-check of already-filed invoices at
 *                     5,000, in a shop that files ~6,000 a month.
 *
 * This guard reads the routes as text. That is deliberate: the bugs are not
 * in a function anyone can call, they are in the SHAPE of the queries, and a
 * unit test cannot reach them without a database.
 */

import { describe, test, expect } from '@jest/globals'
import { readFileSync } from 'fs'
import { join } from 'path'

/*
 * READ THE CODE, NOT THE PROSE.
 *
 * My first version of this guard failed on its own explanatory comments —
 * which quote the very numbers being banned ("was `take: 2000`"). A guard
 * that cannot tell code from a comment about code is the same defect as the
 * guard whose window was a fixed 900 characters: it reports on the wrong
 * text. Strip comments first, then scan.
 */
function stripComments(s: string): string {
  return s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
}

const read = (p: string) => stripComments(readFileSync(join(process.cwd(), p), 'utf8'))

/**
 * The body of one `case 'name':` in the Ask switch, cut where it actually
 * ends — at the next `case '` label — rather than after a guessed number of
 * characters.
 *
 * 🔒 Fixed-width windows are the single most repeated defect in this repo's
 * guards: a 900-char window that an added comment pushed the target out of, a
 * 700-char window that let a neighbouring query satisfy a tenant check, and a
 * 1,600-char window here. Every one of them passed on broken code or failed
 * on correct code, and every one looked fine when it was written.
 */
function caseBlock(src: string, name: string): string {
  const start = src.indexOf(`case '${name}'`)
  if (start === -1) throw new Error(`case '${name}' not found — did it get renamed?`)
  const next = src.indexOf("case '", start + 6)
  return src.slice(start, next === -1 ? src.length : next)
}

describe('Ask never reads part of the books and calls it the answer', () => {
  const src = read('src/app/api/ask/route.ts')

  test('top products is grouped by the DATABASE, not counted in memory', () => {
    /*
     * The fix, pinned — but pinned to the PROPERTY, not to one API call.
     *
     * 🐛 15 Aug, #78: this test read `expect(block).toContain('groupBy')` and
     * failed when the answer moved from Prisma's `groupBy` to raw SQL. The
     * new query groups inside Postgres exactly as before — arguably more
     * plainly, since the GROUP BY is written out — so the guard was failing
     * correct code because it had pinned HOW rather than WHAT.
     *
     * That is the same family as the four other guards this week that
     * measured the wrong text. The rule it earned: assert the behaviour that
     * matters (Postgres does the grouping; nothing is totalled in JS), and
     * let the implementation be either shape.
     *
     * The 1,600-character window is gone for the same reason. It was already
     * on the edge — the comment now explaining this query is longer than
     * that — and a window that a comment can push the code out of is the
     * exact defect written up five times in CLAUDE.md. The block is now cut
     * at the next `case '` label, which is where it actually ends.
     */
    const block = caseBlock(src, 'top_products')

    // Grouped in the database, by either mechanism.
    const groupsInDb = /groupBy/.test(block) || /GROUP\s+BY/i.test(block)
    expect(groupsInDb).toBe(true)

    // Grouped by the product, however it is spelled in each dialect.
    const byProduct = /by: \['productId', 'productName'\]/.test(block)
      || /GROUP\s+BY\s+ti\."productId",\s*ti\."productName"/i.test(block)
    expect(byProduct).toBe(true)

    // And the answer is never assembled by adding rows up in JavaScript.
    expect(block).not.toMatch(/take: (\d{3,})/)
    expect(block).not.toMatch(/\.reduce\(/)
  })

  test('no query in Ask fetches thousands of rows to add up', () => {
    /*
     * The class, not the instance. Any cap in the hundreds or thousands here
     * means rows are being pulled into memory to be totalled — which is the
     * shape of the bug, whatever the number happens to be.
     */
    const bigCaps = [...src.matchAll(/take: (\d{3,})/g)].map(m => Number(m[1]))
    expect(bigCaps.filter(n => n >= 200)).toEqual([])
  })

  test('the receivables total is summed BEFORE the list is trimmed', () => {
    /*
     * THE MONEY BUG, and the worst thing found in this pass. The total was
     * computed from `parties`, which had already been cut to the top twenty —
     * so a shop with twenty-five people owing money was shown a figure
     * missing five of them, on the screen they use to decide who to chase.
     */
    const totalLine = src.slice(src.indexOf('const total = roundMoney(owing'), src.indexOf('const total = roundMoney(owing') + 120)
    expect(totalLine).toContain('owing.reduce')
    // ...and the trim happens after, never before.
    expect(src).toMatch(/const total = roundMoney\(owing[\s\S]{0,200}const parties = owing\.slice\(0, 20\)/)
  })

  test('a deleted party drops out rather than appearing as "(unnamed)"', () => {
    expect(src).toContain("filter(([id]) => nameById.has(id))")
  })
})

describe('GST filings check every invoice that was filed', () => {
  const src = read('src/app/api/gstr-1/route.ts')

  test('the filed-invoice cross-check has no row cap', () => {
    /*
     * It was `take: 5000` on a query already bounded by the list of invoice
     * numbers we filed. The cap could only ever drop filed invoices out of
     * the check for cancellation or amendment — in a return that goes to the
     * government.
     */
    expect(src).not.toContain('take: 5000')
  })
})

describe('a cap is allowed — being silent about it is not', () => {
  /*
   * 🔒 #71, second pass. Auditing the five remaining caps found that THREE
   * were already honest — the party statement returns true bill and payment
   * counts, and the bill-wise report returns `totalBills` beside the 500 it
   * shows. My own logged list had over-counted the problem, which is worth
   * recording: a cap next to a true count is a design decision, and only a
   * cap with no count is a lie.
   *
   * The fuse itself STAYS. Loading 50,000 parties onto a phone would be a
   * worse app, not a better one.
   */
  test.each([
    ['src/app/api/parties/route.ts', 'party'],
    ['src/app/api/products/route.ts', 'product'],
  ])('%s returns the true total beside the capped list', (file) => {
    const src = read(file)
    expect(src).toMatch(/\.count\(/)
    expect(src).toMatch(/truncated:/)
    expect(src).toContain('take: 5000')   // the fuse is deliberate and stays
  })

  test('the margin trend is summed by the database, not from capped rows', () => {
    /*
     * The one real number in this pass. "Your margin dropped 5.2%" was
     * computed by reducing over a 5,000-row slice of a 60-day window — about
     * 12,000 bills at 200 a day — and the rows dropped were the OLDEST in
     * each half, which is the direction that fabricates a trend.
     */
    const src = read('src/app/api/insights/route.ts')
    expect(src).toContain('marginTotals')
    expect(src).toMatch(/groupBy/)
    expect(src).not.toMatch(/last30Sales\.reduce/)
    expect(src).not.toMatch(/prev30Sales\.reduce/)
  })
})
