/**
 * 🔒 GUARD: bill lines are written by ONE builder, lib/line-items.ts.
 *
 * 19 Oct (Phase 5c): the demo-data maker (lib/seed.ts) built sale lines by
 * hand — no cost price on the line, the bill discount not split — so the
 * lines disagreed with their own bill: profit by item added up to ₹54,092
 * while the bills said ₹8,526, and a not-registered shop's sales carried GST.
 * Every file that creates bill lines must call computeLineItems.
 */
import { describe, test, expect } from '@jest/globals'
import * as fs from 'fs'
import * as path from 'path'
import { stripComments } from '@/test-support/read-source'

/**
 * Restoring a backup copies lines the builder already made, as they were
 * stored. Recomputing them would rewrite history (a rate or cost changed
 * since), so the copy is right here — and the only exception.
 */
const COPIES_STORED_LINES = ['src/app/api/import/restore/route.ts']

/** Files that create bill lines (`items: { create`) without calling the builder. */
function linesOutsideBuilder(files: { rel: string; code: string }[]): string[] {
  return files.filter((f) => /items:\s*\{\s*create\b/.test(f.code) && !/computeLineItems\(/.test(f.code)).map((f) => f.rel)
}

describe('bill lines come from the billing code', () => {
  test('the rule works on good and bad input', () => {
    expect(linesOutsideBuilder([{ rel: 'a.ts', code: 'const b = computeLineItems({}); db.transaction.create({ data: { items: { create: b.txItems } } })' }])).toEqual([])
    expect(linesOutsideBuilder([{ rel: 'b.ts', code: 'db.transaction.create({ data: { items: { create: items } } })' }])).toEqual(['b.ts'])
  })

  test('sweep of src/app and src/lib (comments do not count)', () => {
    const files: { rel: string; code: string }[] = []
    const walk = (dir: string) => fs.readdirSync(dir, { withFileTypes: true }).forEach((e) => {
      const full = path.join(dir, e.name)
      if (e.isDirectory()) walk(full)
      else if (/\.tsx?$/.test(e.name)) files.push({ rel: path.relative(process.cwd(), full).split(path.sep).join('/'), code: stripComments(fs.readFileSync(full, 'utf8')) })
    })
    walk(path.resolve(process.cwd(), 'src/app'))
    walk(path.resolve(process.cwd(), 'src/lib'))
    const writers = files.filter((f) => /items:\s*\{\s*create\b/.test(f.code)).map((f) => f.rel).sort()
    // The sale, edit, convert routes and the demo data — if a new writer appears, it must use the builder too.
    expect(writers).toEqual(expect.arrayContaining(['src/lib/seed.ts', 'src/app/api/transactions/route.ts', ...COPIES_STORED_LINES]))
    expect(linesOutsideBuilder(files.filter((f) => !COPIES_STORED_LINES.includes(f.rel)))).toEqual([])
  })
})
