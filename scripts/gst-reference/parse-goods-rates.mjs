/**
 * Turn the GST goods rate notification into a lookup table.
 *
 * WHY A BUILD SCRIPT AND NOT A RUNTIME PARSE. The notification is 226 KB of
 * text and roughly 1,166 rate rows. Parsing that on every product save would
 * be absurd, and parsing it in the browser would ship a tax statute to a
 * ₹6,000 Android phone. It is reference data: parsed once, committed, and
 * re-run when the Council moves.
 *
 * SOURCE. `notification-09-2025-goods.txt` — text extracted from
 * "All Rate List for Goods.pdf", supplied by the CA on 15 Aug 2026. That PDF
 * is CGST rates on goods as on 22.09.2025, per Notification 09/2025-Central
 * Tax (Rate) dated 17 Sep 2025 (56th GST Council).
 *
 * THE ONE THING TO KNOW ABOUT THE NUMBERS. The notification states the CGST
 * half. "2.5%" in the source means **5% GST** — 2.5 CGST + 2.5 SGST. Every
 * rate here is DOUBLED on the way in, and `gstRate` in this output is the
 * full GST rate a shopkeeper recognises. Getting this backwards would halve
 * every tax figure in the app, so it is asserted in the tests.
 *
 * WHAT IT DELIBERATELY DOES NOT DO. It does not decide anything. Many rows
 * apply only under a condition carried in their description — "other than
 * fresh or chilled, pre-packaged and labelled", "70% or more by weight". The
 * parser preserves the description verbatim and flags the common conditions,
 * so the app can ASK rather than assume. See lib/hsn-rate-lookup.ts.
 *
 * Run:  node scripts/gst-reference/parse-goods-rates.mjs
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const SRC = path.join(here, 'notification-09-2025-goods.txt')
const OUT = path.join(here, '..', '..', 'src', 'lib', 'data', 'gst-goods-rates.json')

const NOTIFICATION = '09/2025-Central Tax (Rate)'
const EFFECTIVE_FROM = '2025-09-22'

const raw = fs.readFileSync(SRC, 'utf8')

// The PDF extractor emits one cell per blank-line-separated block, with soft
// wrapping inside a cell. Collapse the wrapping, keep the cell boundaries.
const cells = raw
  .split(/\n\s*\n/)
  .map(c => c.replace(/\n/g, '').replace(/\s+/g, ' ').trim())
  .filter(Boolean)

const RATE = /^(\d+(?:\.\d+)?)%$/
/** A cell that is only HSN codes: digits, spaces, commas. */
const HSN_ONLY = /^[\d\s,]+(?:\d)$/

/**
 * Many rows do NOT put the codes in a clean cell. They read:
 *
 *   0910 [other than 0910 11 10, 0910 30 10]   Ginger other than fresh ginger
 *   1701 or1702                                Jaggery of all types …
 *   2515 [Except 2515 12 20, …] or 6802        Ecaussine and other …
 *
 * My first version required a digits-only cell, so 44 rows fell through into
 * the description and were dropped — including jaggery, ginger and mehendi,
 * which a kirana sells every day. Silently losing a row means the lookup says
 * "no rate found" for a real good, which is the failure that sends someone
 * back to guessing.
 *
 * THE EXCLUSIONS MATTER AS MUCH AS THE CODES. "0910 [other than 0910 11 10]"
 * means 0910 attracts this rate EXCEPT that sub-code. Capturing the bracket
 * lets the lookup refuse to apply a rate to a code the row explicitly carves
 * out, rather than confidently applying the wrong one.
 */
const LEADING_CODES = /^\s*((?:\d[\d\s]*)(?:(?:,|or|and|\[[^\]]*\]|\([^)]*\))\s*(?:\d[\d\s]*)?)*)/i

function splitCodesAndExclusions(text) {
  const m = text.match(LEADING_CODES)
  if (!m || !/\d/.test(m[1])) return null
  const head = m[1]
  const rest = text.slice(m[0].length).trim()

  const excludes = []
  for (const br of head.matchAll(/[[(]\s*(?:other than|except)\s*([^\])]*)[\])]/gi)) {
    for (const code of br[1].split(/[,;]/)) {
      const d = code.replace(/\s+/g, '')
      if (/^\d{2,8}$/.test(d)) excludes.push(d)
    }
  }
  // codes OUTSIDE any bracket
  const outside = head.replace(/[[(][^\])]*[\])]/g, ' ')
  const codes = []
  for (const part of outside.split(/,|\bor\b|\band\b/i)) {
    const d = part.replace(/\s+/g, '')
    if (/^\d{2,8}$/.test(d)) codes.push(d)
  }
  if (!codes.length) return null
  return { codes, excludes, description: rest }
}

/**
 * Pull every 4-, 6- or 8-digit code out of an HSN cell.
 *
 * The source splits codes across cells and inside them: "0101 21 00, 0101 29"
 * is ONE tariff item written with spaces. Joining the digit groups back up is
 * what makes "010121 00" become 01012100 rather than three separate codes.
 */
function parseHsn(cell) {
  const joined = cell.replace(/\s+/g, ' ')
  const out = []
  for (const part of joined.split(/[,;]/)) {
    const digits = part.replace(/\s+/g, '')
    if (/^\d{2,8}$/.test(digits)) out.push(digits)
  }
  return out
}

/** Conditions that change whether a row applies at all. */
function conditionsIn(desc) {
  const d = desc.toLowerCase()
  const found = []
  if (/pre\s*-?\s*packaged and labelled/.test(d)) found.push('pre-packaged-and-labelled')
  if (/other than fresh or chilled/.test(d)) found.push('not-fresh-or-chilled')
  if (/\bby weight\b/.test(d)) found.push('composition-by-weight')
  if (/retail sale price/.test(d)) found.push('declared-retail-sale-price')
  if (/\bother than\b/.test(d) && !found.includes('not-fresh-or-chilled')) found.push('has-exclusion')
  return found
}

/**
 * Schedule headers carry their own rate in the same cell: "Schedule I – 2.5%".
 *
 * My first version matched `^Schedule ([IVX]+)$` and therefore matched
 * NOTHING — every row came out with `schedule: null` and I only noticed
 * because the rate histogram looked wrong. The lesson is the one already in
 * CLAUDE.md: a pattern that silently matches nothing looks exactly like a
 * pattern that matched everything.
 *
 * The header rate is also the cross-check. If a row's rate does not equal its
 * schedule's rate, the parse has drifted — asserted at the end.
 */
const SCHEDULE = /^Schedule\s+([IVX]+)\s*[–—-]?\s*(?:(\d+(?:\.\d+)?)%)?\s*$/

const rows = []
const mismatches = []
const skipped = []
let schedule = null
let scheduleCgst = null
let awaitingScheduleRate = false
let cursor = []

for (const cell of cells) {
  const sched = cell.match(SCHEDULE)
  if (sched) {
    schedule = sched[1]
    if (sched[2] !== undefined) {
      scheduleCgst = Number(sched[2])
      awaitingScheduleRate = false
    } else {
      // "Schedule I –" and "2.5%" arrive as two separate cells. Take the next
      // rate cell as the header's rate, not as a row — a row needs an HSN and
      // a description, and there are none yet.
      scheduleCgst = null
      awaitingScheduleRate = true
    }
    cursor = []
    continue
  }

  const rate = cell.match(RATE)
  if (rate && awaitingScheduleRate) {
    scheduleCgst = Number(rate[1])
    awaitingScheduleRate = false
    cursor = []
    continue
  }
  if (rate) {
    // Everything buffered since the last rate is one row: HSN cell(s) then
    // description cell(s). Walk from the front while the cells are codes.
    const hsnCells = []
    let i = 0
    while (i < cursor.length && HSN_ONLY.test(cursor[i])) { hsnCells.push(cursor[i]); i++ }
    let description = cursor.slice(i).join(' ').replace(/\s+/g, ' ').trim()
    let hsn = hsnCells.flatMap(parseHsn)
    let excludes = []

    // No clean HSN cell? The codes are probably at the head of the description,
    // wrapped in "or" / "[other than …]" — see splitCodesAndExclusions.
    if (!hsn.length && description) {
      const split = splitCodesAndExclusions(description)
      if (split) {
        hsn = split.codes
        excludes = split.excludes
        description = split.description
      }
    }

    if (!hsn.length || !description) {
      // Not silently dropped: a rate cell with no HSN or no description is
      // either a continuation of a table split across pages, or a total row.
      // Counted and sampled so the gap is visible rather than assumed away.
      skipped.push({ rate: rate[1], hsnCells: hsnCells.length, desc: description.slice(0, 70) })
    }
    if (hsn.length && description) {
      const cgst = Number(rate[1])
      rows.push({
        hsn,
        description,
        // DOUBLED: the notification states the CGST half. See the header note.
        gstRate: Number((cgst * 2).toFixed(2)),
        cgstInSource: cgst,
        schedule,
        conditions: conditionsIn(description),
        excludes,
      })
      if (scheduleCgst !== null && cgst !== scheduleCgst) mismatches.push({ schedule, cgst, scheduleCgst, description: description.slice(0, 60) })
    }
    cursor = []
    continue
  }
  cursor.push(cell)
}

// Flatten to one entry per code, keeping every rule that mentions it — an HSN
// legitimately appears more than once with different conditions, and hiding
// the duplicates would silently pick one.
const byCode = {}
for (const r of rows) {
  for (const code of r.hsn) {
    ;(byCode[code] ||= []).push({
      gstRate: r.gstRate,
      description: r.description,
      schedule: r.schedule,
      conditions: r.conditions,
      ...(r.excludes && r.excludes.length ? { excludes: r.excludes } : {}),
    })
  }
}

const payload = {
  source: {
    notification: NOTIFICATION,
    title: 'CGST rates on goods',
    ratesAsOn: EFFECTIVE_FROM,
    dated: '2025-09-17',
    note:
      'Rates in the source notification are the CGST half. gstRate here is the FULL GST rate (CGST + SGST).',
    suppliedBy: 'CA, 15 Aug 2026',
    caveat:
      'Reference data, not a determination. Many rows apply only under a condition carried in the description.',
  },
  generatedFrom: 'scripts/gst-reference/parse-goods-rates.mjs',
  ruleCount: rows.length,
  codeCount: Object.keys(byCode).length,
  codes: byCode,
}

fs.mkdirSync(path.dirname(OUT), { recursive: true })
fs.writeFileSync(OUT, JSON.stringify(payload, null, 1))

if (mismatches.length) {
  console.error(`
!! ${mismatches.length} row(s) whose rate differs from their schedule header:`)
  for (const m of mismatches.slice(0, 8)) console.error('  ', JSON.stringify(m))
}
console.log(`rate cells skipped: ${skipped.length}`)
for (const k of skipped.slice(0, 10)) console.log('   skip:', JSON.stringify(k))
const rates = [...new Set(rows.map(r => r.gstRate))].sort((a, b) => a - b)
console.log(`rules parsed : ${rows.length}`)
console.log(`distinct HSN : ${Object.keys(byCode).length}`)
console.log(`GST rates    : ${rates.join(', ')}`)
console.log(`written      : ${path.relative(process.cwd(), OUT)}`)
