/**
 * 🔒 GUARD: an IST conversion in SQL is written once, the right way round
 * (Phase 5b-5).
 *
 * The date columns are `timestamp without time zone` holding UTC. Writing
 * `"date" AT TIME ZONE 'Asia/Kolkata'` makes Postgres treat the UTC value as
 * Indian time and move it 5½ hours the wrong way. Home's trend put every sale
 * before ~11:00 IST on the previous day (UTC database) or showed ₹0 for every
 * day (IST-session database, the local copy), and a customer's month chart
 * put the 1st's morning sales in the month before.
 *
 * The rule: "AT TIME ZONE" appears only in lib/ist-sql.ts, which converts
 * UTC first. Checked against the real database on 14 Oct: a sale stored at
 * 2026-10-02T03:09Z (08:39 IST) truncates to 2 Oct with istLocal and to
 * 1 Oct with the old form.
 */
import { describe, test, expect } from '@jest/globals'
import * as fs from 'fs'
import * as path from 'path'
import { istLocal } from '@/lib/ist-sql'
import { stripComments } from '@/test-support/read-source'

/** Source files (outside lib/ist-sql.ts) that write an AT TIME ZONE conversion themselves. */
function ownTimeZoneSql(files: { rel: string; code: string }[]): string[] {
  return files.filter((f) => !f.rel.endsWith('lib/ist-sql.ts') && /AT\s+TIME\s+ZONE/i.test(f.code)).map((f) => f.rel)
}

describe('istLocal', () => {
  test('says the stored value is UTC, then asks for the IST wall clock', () => {
    const sql = istLocal('"date"')
    expect(sql.sql).toBe(`(("date" AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Kolkata')`)
    expect(sql.values).toEqual([])
  })
})

describe('no other file writes its own conversion', () => {
  test('the rule works on good and bad input', () => {
    expect(ownTimeZoneSql([{ rel: 'src/app/api/x/route.ts', code: 'DATE_TRUNC(\'day\', ${istLocal(\'"date"\')})' }])).toEqual([])
    expect(ownTimeZoneSql([{ rel: 'src/app/api/x/route.ts', code: 'DATE_TRUNC(\'day\', "date" AT TIME ZONE \'Asia/Kolkata\')' }])).toEqual(['src/app/api/x/route.ts'])
    expect(ownTimeZoneSql([{ rel: 'src/lib/ist-sql.ts', code: 'AT TIME ZONE' }])).toEqual([])
  })
  test('sweep of src/app and src/lib', () => {
    const files: { rel: string; code: string }[] = []
    const walk = (dir: string) => fs.readdirSync(dir, { withFileTypes: true }).forEach((e) => {
      const full = path.join(dir, e.name)
      if (e.isDirectory()) walk(full)
      else if (/\.(ts|tsx)$/.test(e.name)) files.push({ rel: path.relative(process.cwd(), full).split(path.sep).join('/'), code: stripComments(fs.readFileSync(full, 'utf8')) })
    })
    walk(path.resolve(process.cwd(), 'src/app'))
    walk(path.resolve(process.cwd(), 'src/lib'))
    expect(files.length).toBeGreaterThan(100)
    expect(ownTimeZoneSql(files)).toEqual([])
  })
})
