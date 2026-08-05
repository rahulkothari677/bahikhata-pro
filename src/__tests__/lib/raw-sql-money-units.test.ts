/**
 * @jest-environment node
 *
 * Raw SQL must not hand a paise value to code that expects rupees.
 *
 * WHY. Money columns are stored as integer PAISE. A Prisma client extension
 * converts them to rupees on read and back on write — but it cannot see
 * `$queryRaw`, so every raw statement returns the raw integer. A raw SUM that
 * lands in rupee-shaped code is silently 100x too large, and 100x is the kind
 * of wrong that reads as plausible on a dashboard until someone reconciles.
 *
 * The codebase has three safe patterns, all in use:
 *
 *   a) convert in SQL          SUM("totalAmount") / 100.0 AS total_rupees
 *   b) keep paise, say so      SUM("totalAmount") AS "totalSalesPaise"
 *   c) convert in JS           fromPaise(Number(row.revenue))
 *
 * (b) is safe only because the unit travels in the name. A money column read
 * with NONE of the three is the dangerous shape: a bare integer with nothing
 * marking its unit.
 *
 * Audited 2026-08-04 (Phase 10): 57 raw statements, 40 touching a money column,
 * all safe. This test exists so the next one added is too. It is written to
 * over-report rather than under-report — a false positive costs a comment or an
 * alias, a false negative costs a wrong number in someone's books.
 */
import fs from 'fs'
import path from 'path'

const SRC = path.join(process.cwd(), 'src')

const MONEY_COLS = [
  'totalAmount', 'paidAmount', 'purchasePrice', 'salePrice', 'openingBalance',
  'taxAmount', 'discountAmount', 'grossProfit', 'cgst', 'sgst', 'igst', 'mrp',
  'amount', 'balance', 'costInr', 'unitPrice',
]

/**
 * Files that deliberately read raw paise, with the reason. Anything not listed
 * must declare its unit. Adding an entry here should take the same thought as
 * writing the conversion would have.
 */
const DELIBERATE_RAW_PAISE = new Map<string, string>([
  [
    'app/api/debug/paise-audit/route.ts',
    'This endpoint EXISTS to inspect the stored integers. Converting them would ' +
    'defeat its purpose — it is the tool you reach for when a figure looks 100x wrong.',
  ],
])

function walk(dir: string, out: string[] = []): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) { if (e.name !== '__tests__') walk(p, out) }
    else if (p.endsWith('.ts')) out.push(p)
  }
  return out
}

/**
 * Is a money column actually SELECTED, as opposed to merely mentioned in a
 * WHERE or ORDER BY?
 *
 * `SELECT[\s\S]*?"totalAmount"` looks right and is not: the lazy span runs
 * straight past FROM into the WHERE clause, so `SELECT id ... WHERE
 * "totalAmount" > 0` reads as a money read. Filtering on a column is not
 * returning it, and treating it as one buries the real findings in noise.
 */
function selectsMoney(sql: string, cols: string[]): boolean {
  // Everything between each SELECT and its matching FROM — the projection.
  const projections = [...sql.matchAll(/SELECT([\s\S]*?)\bFROM\b/gi)].map(m => m[1])
  const inProjection = projections.some(p => cols.some(c => new RegExp(`"${c}"`).test(p)))
  // An aggregate anywhere is a read even when the projection is aliased oddly.
  const aggregates = new RegExp(`(SUM|AVG|MIN|MAX)\\s*\\(\\s*[^)]*"(${cols.join('|')})"`, 'i').test(sql)
  return inProjection || aggregates
}

/** Read a backtick template, tolerating nested ${...}. */
function readTemplate(src: string, start: number): { sql: string; end: number } {
  let out = ''
  let depth = 0
  let i = start
  for (; i < src.length; i++) {
    const c = src[i]
    if (c === '\\') { out += c + src[i + 1]; i++; continue }
    if (c === '$' && src[i + 1] === '{') { depth++; out += '${'; i++; continue }
    if (c === '}' && depth > 0) { depth--; out += '}'; continue }
    if (c === '`' && depth === 0) return { sql: out, end: i }
    out += c
  }
  return { sql: out, end: i }
}

interface Site { file: string; line: number; cols: string; sql: string }

function scan(): { examined: number; touchingMoney: number; unsafe: Site[]; rawReads: Site[] } {
  let examined = 0
  let touchingMoney = 0
  const unsafe: Site[] = []
  /** Every money read, before exemptions — used to keep the list honest. */
  const rawReads: Site[] = []

  for (const file of walk(SRC)) {
    const src = fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n')
    if (!/\$queryRaw|\$executeRaw/.test(src)) continue
    const rel = path.relative(SRC, file).split(path.sep).join('/')

    const re = /\$(?:queryRaw|executeRaw)(?:Unsafe)?/g
    let m: RegExpExecArray | null
    while ((m = re.exec(src))) {
      /*
       * Walk forward to the opening backtick. A generic type argument routinely
       * spans lines and contains nested `>` (`$queryRaw<Array<{...}>>`), so a
       * `<[^>]*>` pattern stops at the first `>` and silently skips the site —
       * which is exactly how an earlier version of this scan examined 8 of 57
       * statements and reported everything clean.
       */
      let k = m.index + m[0].length
      let depth = 0
      let isTemplate = false
      for (; k < src.length && k < m.index + 2000; k++) {
        const c = src[k]
        if (c === '<') depth++
        else if (c === '>') depth--
        else if (c === '`') { isTemplate = true; break }
        else if (depth === 0 && (c === '(' || c === ';' || c === ')')) break
      }
      if (!isTemplate) continue

      const { sql, end } = readTemplate(src, k + 1)
      re.lastIndex = end
      examined++

      const cols = MONEY_COLS.filter(c => new RegExp(`"${c}"`).test(sql))
      if (!cols.length) continue

      // Money named only in a WHERE/ORDER BY is not a money READ.
      if (!selectsMoney(sql, cols)) continue
      touchingMoney++

      const convertsInSql = /\/\s*100(\.0)?/.test(sql)
      const aliasesAsPaise = /AS\s+"?\w*[Pp]aise\w*"?/.test(sql)
      /*
       * (c) — converted in JS. Matched per COLUMN across the whole file rather
       * than in a window after the query: dashboard/route.ts selects the row at
       * line 177 and converts it at line 594, and any fixed window is either
       * too small to see that or so large it matches an unrelated conversion.
       * Requiring `fromPaise(... .purchasePrice ...)` ties the evidence to the
       * column it is about.
       */
      /*
       * Case-insensitive and without word boundaries, because the SQL almost
       * always aliases: `ti."cgst"` is selected AS "totalCgst" and converted as
       * `fromPaise(Number(row.totalCgst))`. A \b...\b match on the raw column
       * name cannot follow that rename, and reported two already-correct
       * reports queries as unsafe.
       */
      const convertsNamedColumn = cols.some(c =>
        new RegExp(`fromPaise\\s*\\(\\s*(?:Number\\s*\\(\\s*)?[\\w.]*${c}`, 'i').test(src),
      )

      /*
       * Fallback: the file converts SOMETHING with fromPaise.
       *
       * Per-column matching cannot always work, because a SQL alias is
       * arbitrary. reports/route.ts selects ti."unitPrice" and ti."discountAmount"
       * inside a SUM, aliases the result "revenue" and "cogs", and converts
       * `fromPaise(Number(row.revenue))` — correct, and sharing no substring
       * with either column.
       *
       * So the bar this test actually enforces is: a file doing raw money reads
       * must handle paise SOMEWHERE. That is weaker than per-query proof and it
       * is stated plainly rather than dressed up — it still catches the shape
       * that matters, a new raw money read dropped into code with no notion of
       * the unit at all, which is how a 100x error gets in.
       */
      const fileHandlesPaise = /fromPaise\s*\(/.test(src)
      const convertsInJs = convertsNamedColumn || fileHandlesPaise

      // Recorded before the exemption is applied, so the honesty check below
      // can tell "exempt and still raw" from "exempt but no longer relevant".
      rawReads.push({ file: rel, line: src.slice(0, m.index).split('\n').length, cols: cols.join(','), sql: '' })

      if (convertsInSql || aliasesAsPaise || convertsInJs) continue
      if (DELIBERATE_RAW_PAISE.has(rel)) continue

      unsafe.push({
        file: rel,
        line: src.slice(0, m.index).split('\n').length,
        cols: [...new Set(cols)].join(','),
        sql: sql.replace(/\s+/g, ' ').trim().slice(0, 160),
      })
    }
  }
  return { examined, touchingMoney, unsafe, rawReads }
}

const result = scan()

describe('raw SQL money reads declare their unit', () => {
  it('examines the raw statements that exist — a low count would make this vacuous', () => {
    // An earlier version of this scan matched only `$queryRaw\`` and saw 8 of
    // 57. The count is asserted so a regressed extractor fails loudly instead
    // of reporting a clean sweep of almost nothing.
    expect(result.examined).toBeGreaterThan(40)
    expect(result.touchingMoney).toBeGreaterThan(20)
  })

  it('finds no money read without /100, a paise alias, or fromPaise()', () => {
    expect(
      result.unsafe.map(u => `${u.file}:${u.line} [${u.cols}] ${u.sql}`),
    ).toEqual([])
  })

  it('keeps the exception list honest — every entry still has a raw read', () => {
    // If a file stops needing its exemption the entry should go, so the list
    // never becomes somewhere a real finding can hide.
    const filesWithRawMoney = new Set(result.rawReads.map(s => s.file))
    const stale = [...DELIBERATE_RAW_PAISE.keys()].filter(f => !filesWithRawMoney.has(f))
    expect(stale).toEqual([])
  })
})

describe('the detector can actually fire', () => {
  // An empty result from a broken scanner is indistinguishable from success.
  const trips = (sql: string, after: string) => {
    const cols = MONEY_COLS.filter(c => new RegExp(`"${c}"`).test(sql))
    if (!cols.length) return false
    if (!selectsMoney(sql, cols)) return false
    return !(/\/\s*100(\.0)?/.test(sql) || /AS\s+"?\w*[Pp]aise\w*"?/.test(sql) || /fromPaise\s*\(/.test(after))
  }

  it('flags a bare money SUM', () => {
    expect(trips('SELECT SUM("totalAmount") AS total FROM "Transaction"', '')).toBe(true)
  })

  it('accepts conversion in SQL', () => {
    expect(trips('SELECT SUM("totalAmount") / 100.0 AS total FROM "Transaction"', '')).toBe(false)
  })

  it('accepts a paise-named alias', () => {
    expect(trips('SELECT SUM("totalAmount") AS "totalPaise" FROM "Transaction"', '')).toBe(false)
  })

  it('accepts conversion in JS', () => {
    expect(trips('SELECT SUM("totalAmount") AS total FROM "Transaction"', 'const x = fromPaise(Number(row.total))')).toBe(false)
  })

  it('ignores money named only in a WHERE', () => {
    expect(trips('SELECT id FROM "Transaction" WHERE "totalAmount" > 0', '')).toBe(false)
  })
})
