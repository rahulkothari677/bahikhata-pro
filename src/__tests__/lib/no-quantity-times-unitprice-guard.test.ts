/**
 * Reports read a line's taxable value from lib/line-taxable(-sql).ts — never
 * as quantity × unitPrice (#98, 1 Oct 2026).
 *
 * For a GST-inclusive (MRP) line the stored unitPrice is rounded to the paisa,
 * so quantity × unitPrice is off by up to half a paisa per unit. Twenty-five
 * report queries multiplied them; all now use `total − taxes`. This guard keeps
 * a twenty-sixth from appearing.
 *
 * The rule is a function, exercised against known-good and known-bad code
 * first (CLAUDE.md: a guard that cannot be run both ways is a comment with a
 * green tick).
 */
import fs from 'fs'
import path from 'path'

const MULTIPLY = /(?:quantity"?(?:::numeric)?\s*\*\s*[\w.]*"?unitPrice)|(?:unitPrice"?(?:::numeric)?\s*\*\s*[\w.]*"?quantity)/

/** Line numbers (1-based) where code — not comments — multiplies quantity by unit price. */
function findQuantityTimesUnitPrice(source: string): number[] {
  const code = source
    .replace(/\/\*[\s\S]*?\*\//g, block => block.replace(/[^\n]/g, ''))
    .replace(/^[ \t]*\/\/[^\n]*$/gm, '')
  const hits: number[] = []
  code.split(/\r?\n/).forEach((line, i) => { if (MULTIPLY.test(line)) hits.push(i + 1) })
  return hits
}

/** Places allowed to keep the multiplication, each with its reason and exact count. */
const ALLOWED: Record<string, { count: number; why: string }> = {
  'src/lib/gstr1-builder.ts': { count: 1, why: 'Fallback for callers that pass no stored total (test fixtures); every route passes total.' },
  'src/lib/e-invoice.ts': { count: 2, why: 'Same fallback when no stored total is passed; the IRN route passes it.' },
  'src/app/api/scan-bill/route.ts': { count: 3, why: 'Works on numbers read off a photographed bill, not on stored lines.' },
}

function files(dir: string): string[] {
  const out: string[] = []
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name)
    if (e.isDirectory()) { if (e.name !== '__tests__') out.push(...files(full)) }
    else if (/\.(ts|tsx)$/.test(e.name)) out.push(full)
  }
  return out
}

describe('the rule itself', () => {
  test('catches the SQL and JS spellings', () => {
    expect(findQuantityTimesUnitPrice('ROUND(ti."quantity"::numeric * ti."unitPrice"::numeric, 0)')).toEqual([1])
    expect(findQuantityTimesUnitPrice('(ti."unitPrice" * ti."quantity" - ti."discountAmount")')).toEqual([1])
    expect(findQuantityTimesUnitPrice('const g = item.quantity * item.unitPrice')).toEqual([1])
  })
  test('ignores comments and the shared definition', () => {
    expect(findQuantityTimesUnitPrice('// was quantity * unitPrice')).toEqual([])
    expect(findQuantityTimesUnitPrice('/* item.quantity * item.unitPrice */')).toEqual([])
    expect(findQuantityTimesUnitPrice('SUM(${LINE_TAXABLE_SQL})')).toEqual([])
  })
})

describe('no report multiplies quantity by unit price', () => {
  const roots = ['src/app/api', 'src/lib'].map(r => path.join(process.cwd(), r))
  test('every hit outside the allow-list is a bug', () => {
    const offenders: string[] = []
    for (const root of roots) {
      for (const f of files(root)) {
        const rel = path.relative(process.cwd(), f).split(path.sep).join('/')
        const hits = findQuantityTimesUnitPrice(fs.readFileSync(f, 'utf8'))
        if (hits.length > (ALLOWED[rel]?.count ?? 0)) offenders.push(`${rel}: lines ${hits.join(', ')}`)
      }
    }
    expect(offenders).toEqual([])
  })
  test('allow-list entries are still accurate', () => {
    for (const [rel, { count }] of Object.entries(ALLOWED)) {
      const hits = findQuantityTimesUnitPrice(fs.readFileSync(path.join(process.cwd(), rel), 'utf8'))
      expect({ rel, hits: hits.length }).toEqual({ rel, hits: count })
    }
  })
})
