/**
 * Turn the GST goods EXEMPTION notification into a lookup table.
 *
 * SOURCE. `notification-10-2025-exempt.txt` — text extracted from the PDF the
 * CA supplied on 29 Aug 2026, and which I downloaded and checked myself. Its
 * own first paragraph gives the provenance:
 *
 *   "No. 10/2025-Central Tax (Rate) ... G.S.R. 660(E) ... in supersession of
 *    the notification ... No. 02/2017-Central Tax (Rate), dated the 28th June,
 *    2017 ... hereby exempts intra-State supplies of goods"
 *
 * WHY THIS MATTERS MORE THAN A NEW TABLE. `lib/gst-treatment.ts` already
 * carries a hand-written list of 21 exempt HSN prefixes, and its comment cites
 * **Notification 2/2017** — the notification the line above says was
 * SUPERSEDED. So the app has been classifying a shopkeeper's stock against a
 * dead statute. This replaces the list with the live one.
 *
 * ─────────────── THE DISTINCTION THAT DECIDES EVERYTHING ───────────────
 *
 * Most kirana exemptions are CONDITIONAL, and the condition is packaging:
 *
 *   entry 16   "Curd, Lassi, Butter milk, other than pre-packaged and labelled"
 *   entry 17   "Chena or paneer, whether or not pre-packaged and labelled"
 *
 * Those two lines look alike and mean opposite things. Loose curd is exempt
 * and branded packaged curd is 5%; paneer is exempt EITHER WAY. An HSN prefix
 * cannot express that — 0403 is 0403 — which is why the existing list resorted
 * to a comment saying "(unbranded)" and hoped the rate check would cover it.
 *
 * Its own file admits where that fails: the rate check protects a correctly
 * priced product with a misleading HSN, and cannot protect a MIS-priced one.
 * A shopkeeper who typed the wrong rate is exactly who most needs the answer
 * to be careful.
 *
 * So the condition travels WITH the data, and a conditional entry produces a
 * QUESTION rather than a classification. Same rule, same condition codes and
 * same shape as parse-goods-rates.mjs — one vocabulary, not two.
 *
 * Run:  node scripts/gst-reference/parse-exempt-goods.mjs
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const SRC = path.join(here, 'notification-10-2025-exempt.txt')
const OUT = path.join(here, '..', '..', 'src', 'lib', 'data', 'gst-exempt-goods.json')

const NOTIFICATION = '10/2025-Central Tax (Rate)'
const GAZETTE = 'G.S.R. 660(E)'
const DATED = '2025-09-17'
const SUPERSEDES = '02/2017-Central Tax (Rate)'

const raw = fs.readFileSync(SRC, 'utf8')
const lines = raw.split(/\r?\n/).map(l => l.trim())

/*
 * Page furniture, dropped before anything else looks at the text.
 *
 * The gazette prints a running header and a page number on every page, and a
 * bare page number is INDISTINGUISHABLE from a chapter-level HSN like "03".
 * Left in, page 27 becomes "Chapter 27" — mineral fuels — and the parser would
 * silently exempt petrol. That is not a hypothetical: chapter-level entries
 * genuinely exist in this notification, so the shape alone cannot tell them
 * apart. They are separated by CONTEXT (a real HSN follows a serial number)
 * and by dropping the furniture first.
 */
const isFurniture = (l) =>
  l === '' ||
  /^\d{1,3}$/.test(l) && false ||              // handled positionally, not here
  /[ऀ-ॿ]/.test(l) ||                 // Devanagari running header
  /GAZETTE OF INDIA|EXTRAORDINARY|PART II|Uploaded by|Controller of Publications|MINISTRY OF FINANCE|Department Of Revenue|NOTIFICATION|New Delhi/i.test(l)

/*
 * Where the Schedule starts and stops.
 *
 * Everything before "SCHEDULE" is the enabling paragraph, and everything from
 * the explanatory notes onward is definitions and the handicraft LISTs — which
 * are numbered 1..134 all over again. Parsing past the end would overwrite
 * real entries with lithophones.
 */
const startAt = lines.findIndex(l => /^SCHEDULE$/i.test(l))
if (startAt < 0) throw new Error('SCHEDULE heading not found — has the source changed?')

let endAt = lines.length
for (let i = startAt + 1; i < lines.length; i++) {
  if (/^(Explanation|ANNEXURE|LIST\s+[I1]\b)/i.test(lines[i])) { endAt = i; break }
}

const body = lines.slice(startAt + 1, endAt)

/* A serial number: "1." / "23." possibly with trailing spaces. */
const SERIAL = /^(\d{1,3})\.\s*$/

/*
 * An HSN cell — and the second time this exact bug has been written here.
 *
 * My first version was `/^[\d\s,]+$/`, which assumed codes are only ever
 * comma-separated. The gazette uses FOUR separators, and sixteen entries were
 * dropped in silence because of it:
 *
 *   "1701 or 1702"              jaggery, khandsari sugar, rab
 *   "1905 or 2106"              bread, roti, chapathi, paratha
 *   "4802 / 4907"               judicial and non-judicial stamp papers
 *   "50 to 55"                  khadi fabric
 *   "9619 00 10 or 9619 00 20"  sanitary napkins
 *
 * A rejected HSN line does not error — it falls through into the description,
 * the entry then has no code, and it is skipped. Staples of the exact shops
 * this app is for would have answered "unknown" forever.
 *
 * The identical mistake dropped 44 rows from the RATE parser earlier this
 * month, on "1701 or1702", and I noticed then only because a histogram looked
 * wrong. So this version does not pattern-match the separators at all: it
 * strips everything a code cell may legitimately contain and asks whether
 * anything is left. What remains is prose, and prose means description.
 */
const CELL_NOISE = /(\bor\b|\bto\b|\band\b|any other Chapter|[\d\s,/\-–]|\[|\])/gi
const isHsnCell = (line) => /^\d/.test(line) && line.replace(CELL_NOISE, '').trim() === ''

const entries = []
let current = null

for (const line of body) {
  if (isFurniture(line)) continue
  const serial = line.match(SERIAL)
  if (serial) {
    if (current) entries.push(current)
    current = { serial: Number(serial[1]), hsnParts: [], descParts: [] }
    continue
  }
  if (!current) continue
  /*
   * HSN lines come FIRST and stop at the first line that is not one. After
   * that everything is description — including a description that happens to
   * start with a number ("70% or more by weight"), which is why this latches
   * rather than testing each line independently.
   */
  if (current.descParts.length === 0 && isHsnCell(line)) current.hsnParts.push(line)
  /* A bare 1-3 digit line INSIDE a description is a page number that survived
     the furniture filter. Safe to drop here and only here: a chapter code like
     "03" is an HSN cell, so it is caught by the branch above, never this one. */
  else if (!/^\d{1,3}$/.test(line)) current.descParts.push(line)
}
if (current) entries.push(current)

/* ── conditions ───────────────────────────────────────────────────────────
 *
 * Same codes as parse-goods-rates.mjs, so one CONDITION_TEXT serves both.
 * `pre-packaged-and-labelled` means the same thing in both files: the answer
 * turns on how the item is sold, and only the shopkeeper knows that.
 */
function conditionsFor(description) {
  const d = description.toLowerCase()
  const out = []

  /*
   * "WHETHER OR NOT pre-packaged and labelled" is checked FIRST and wins.
   *
   * It is the OPPOSITE of "other than pre-packaged and labelled" while sharing
   * almost every word with it. Testing for the substring "pre-packaged and
   * labelled" alone marks paneer conditional when it is exempt either way —
   * and a false question is not harmless: asked something that has no bearing
   * on the answer, a shopkeeper learns to dismiss the question, including the
   * times it decides a rate.
   */
  const unconditionalPackaging = /whether or not\s+pre-?packaged and labelled/i.test(description)
  if (!unconditionalPackaging && /other than\s+pre-?packaged and labelled/i.test(description)) {
    out.push('pre-packaged-and-labelled')
  }

  if (/other than fresh or chilled/i.test(description)) out.push('not-fresh-or-chilled')
  else if (/\bfresh or chilled\b/i.test(description)) out.push('fresh-or-chilled-only')

  if (/other than in processed form|other than processed/i.test(description)) out.push('unprocessed-only')
  if (/\[|\bexcluding\b|\bexcept\b|\bother than goods falling\b/i.test(d)) out.push('has-exclusion')

  /*
   * Exemptions that depend on WHO sells it, not what it is. Found only because
   * the sixteen dropped entries had to be read one by one to fix the parser:
   *
   *   "Judicial, Non-judicial stamp papers ... when sold by the Government
   *    Treasuries or Vendors authorized by the Government"
   *   "Khadi fabric, sold through Khadi and Village Industries Commission"
   *   "Rupee notes or coins when sold to Reserve Bank of India"
   *
   * An ordinary shop selling the same physical article is NOT exempt. Nothing
   * in an HSN code carries that, so this has to be a question — and without
   * this branch those entries would have read as unconditional exemptions,
   * which is a worse outcome than having dropped them.
   */
  if (/\bsold by\b|\bsold to\b|\bsold through\b|authorized by the Government|certified institutions/i.test(description)) {
    out.push('seller-specific')
  }

  /* "Drugs or medicines listed in Annexure I" — the code is not the test. */
  if (/listed in Annexure|specified in (the )?List/i.test(description)) out.push('listed-in-annexure')

  /* "of seed quality" — same article, different grade, different answer. */
  if (/\bof seed quality\b/i.test(description)) out.push('seed-quality-only')

  return [...new Set(out)]
}

/**
 * "0203, 0204, 0205" → ['0203','0204','0205']
 * "1701 or 1702"     → ['1701','1702']
 * "4802 / 4907"      → ['4802','4907']
 * "50 to 55"         → ['50','51','52','53','54','55']
 * "9619 00 10 or 9619 00 20" → ['96190010','96190020']
 *
 * SPACES MEAN TWO DIFFERENT THINGS and that is the whole difficulty. In
 * "07, 09 or 10" a space separates codes; in "9619 00 10" it separates the
 * groups WITHIN one 8-digit tariff item. So the split happens on the explicit
 * separators only, and whatever spaces survive inside a token are closed up —
 * which is the correct reading of a spaced tariff item.
 */
function codesFrom(hsnText) {
  const out = []
  for (const token of hsnText.split(/\s*(?:,|\bor\b|\/)\s*/i)) {
    const t = token.trim()
    if (!t) continue

    // "50 to 55" — an inclusive chapter range.
    const range = t.match(/^(\d{2})\s*(?:to|[-–])\s*(\d{2})$/i)
    if (range) {
      const [from, to] = [Number(range[1]), Number(range[2])]
      if (to >= from && to - from <= 60) {
        for (let c = from; c <= to; c++) out.push(String(c).padStart(2, '0'))
        continue
      }
    }

    const code = t.replace(/\s+/g, '')
    if (/^\d{2,8}$/.test(code)) out.push(code)
  }
  return [...new Set(out)]
}

const codes = {}
let ruleCount = 0
const skipped = []

/*
 * Exemptions that are NOT keyed to any HSN — the notification writes their
 * code column as "Any Chapter", "Any Chapter except 71", or a bare dash.
 *
 * They cannot be looked up, and dropping them would be the worse error: they
 * include RAKHI and PUJA SAMAGRI, which is ordinary stock in exactly the shops
 * this app is for. A rakhi sold at 0% would otherwise fall to the residual
 * "nil-rated", and nil-rated and exempt are different boxes in GSTR-1 — the
 * precise mistake the CA called "wrong treatment".
 *
 * So they are carried, unkeyed and honestly labelled, for a screen to offer as
 * a short checklist. What this must never do is quietly decide for the shop.
 */
const unkeyed = []
const UNKEYED_CODE = /^(any chapter|any other chapter|-|–)/i

for (const e of entries) {
  const hsnText = e.hsnParts.join(' ').replace(/\s+/g, ' ').trim()
  let description = e.descParts.join(' ').replace(/\s+/g, ' ').trim()

  /*
   * With no parsable code, the code column stayed in descParts — so the
   * description still has it on the front and has to be split back off.
   */
  if (!hsnText && UNKEYED_CODE.test(description)) {
    const m = description.match(/^((?:any chapter(?:\s+except\s+\d+)?|any other chapter|-|–))\s*(.*)$/i)
    if (m && m[2]) {
      unkeyed.push({ serial: e.serial, appliesTo: m[1].trim(), description: m[2].trim(), conditions: conditionsFor(m[2]) })
      continue
    }
  }

  if (!hsnText || !description) { skipped.push({ ...e, why: 'missing hsn or description' }); continue }

  const list = codesFrom(hsnText)
  if (!list.length) { skipped.push({ serial: e.serial, hsnText, why: 'no parsable code' }); continue }

  const conditions = conditionsFor(description)
  for (const code of list) {
    ;(codes[code] ||= []).push({
      description,
      conditions,
      serial: e.serial,
    })
    ruleCount++
  }
}

const out = {
  source: {
    notification: NOTIFICATION,
    gazette: GAZETTE,
    dated: DATED,
    supersedes: SUPERSEDES,
    /*
     * Stated in the DATA, not only in a comment, because the code that reads
     * this is what must be able to say where an answer came from. §0: every
     * figure shows receipts that open the real record.
     */
    note: 'Exempt from CGST under section 11(1). Supersedes 02/2017-CT(R), which the previous hand-written list in lib/gst-treatment.ts still cited.',
  },
  generatedFrom: path.basename(SRC),
  entryCount: entries.length,
  ruleCount,
  codeCount: Object.keys(codes).length,
  codes,
  /* Exempt, but not findable by HSN — see the note beside `unkeyed`. */
  unkeyed,
}

fs.mkdirSync(path.dirname(OUT), { recursive: true })
fs.writeFileSync(OUT, JSON.stringify(out, null, 1) + '\n', 'utf8')

console.log(`entries parsed : ${entries.length}`)
console.log(`codes          : ${out.codeCount}`)
console.log(`rules          : ${ruleCount}`)
console.log(`unkeyed        : ${unkeyed.length}  (Any Chapter / no code)`)
console.log(`skipped        : ${skipped.length}`)
if (skipped.length) console.log(skipped.slice(0, 10))
const conditional = Object.values(codes).flat().filter(r => r.conditions.length).length
console.log(`conditional    : ${conditional} of ${ruleCount}`)
console.log(`written        : ${path.relative(process.cwd(), OUT)}`)
