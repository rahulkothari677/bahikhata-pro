/**
 * 🔒 AN AUTH GATE MUST NEVER BE TESTED FOR TRUTHINESS.
 *
 * Found in Phase 5, 2026-08-03, in
 * src/app/api/debug/supplier-opening-balance-review/route.ts:
 *
 *     if (!(await requireFounder())) {
 *       return NextResponse.json({ error: 'Founder access required' }, { status: 403 })
 *     }
 *
 * `requireFounder()` returns `{ userId } | { error: NextResponse }` — an OBJECT
 * either way, and every object is truthy. `!result` was therefore always false
 * and the 403 was unreachable. The gate did nothing at all.
 *
 * WHAT IT EXPOSED. That file's GET also ran a `findMany` with no `userId`, so
 * ANY authenticated user could read every party in every shop with a positive
 * opening balance — names, phone numbers, balances, owning userId. The POST let
 * them flip the sign of any of those opening balances, which directly changes
 * what a supplier is owed.
 *
 * WHY IT SURVIVED. Every other debug route already used the correct
 * `if ('error' in x) return x.error`. This one looked the same at a glance, and
 * TypeScript is perfectly happy with `!someObject` — the type system cannot
 * catch it, so a test has to.
 *
 * These gates all return a discriminated union with an `error` arm. Testing any
 * of them for truthiness is the same bug.
 */
import fs from 'fs'
import path from 'path'

const GATES = [
  'requireFounder',
  'getAuthUserId',
  'getAuthUserIdWithModule',
  'getAuthUserIdOwnerOnly',
  'getAuthContext',
  'getAuthContextForWrite',
]

function walk(dir: string, out: string[] = []): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) walk(p, out)
    else if (e.name.endsWith('.ts') || e.name.endsWith('.tsx')) out.push(p)
  }
  return out
}

const SRC = path.join(process.cwd(), 'src')
const files = walk(SRC).filter(f => !f.includes('__tests__'))

/**
 * Blank out comments, preserving offsets.
 *
 * Necessary, not cosmetic: the fix for this very bug documents the broken
 * pattern verbatim so the next reader understands it. Without stripping, the
 * guard fires on its own explanation — which would push future authors to
 * delete the explanation to get a green suite. Caught exactly that way.
 */
function strip(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, m => m.replace(/[^\n]/g, ' '))
    .replace(/(^|[^:])\/\/.*$/gm, (m, p1) => p1 + ' '.repeat(Math.max(0, m.length - p1.length)))
}
const read = (f: string) => strip(fs.readFileSync(f, 'utf8').replace(/\r\n/g, '\n'))

describe('auth gates are never tested for truthiness', () => {
  test('the scan actually reaches the routes', () => {
    // Without this, an empty file list would make every assertion below pass.
    expect(files.length).toBeGreaterThan(50)
    const anyGateUsed = files.some(f =>
      GATES.some(g => read(f).includes(g + '(')))
    expect(anyGateUsed).toBe(true)
  })

  for (const gate of GATES) {
    test(`no truthiness test on ${gate}()`, () => {
      const offenders: string[] = []
      for (const f of files) {
        const src = read(f)
        // `if (!(await gate()))` and `if (!gate())` — the bypass shapes.
        const bang = new RegExp(`!\\s*\\(?\\s*await\\s+${gate}\\s*\\(`, 'g')
        const bangSync = new RegExp(`!\\s*${gate}\\s*\\(`, 'g')
        if (bang.test(src) || bangSync.test(src)) {
          offenders.push(path.relative(SRC, f).replace(/\\/g, '/'))
        }
      }
      expect(offenders).toEqual([])
    })
  }

  test('every requireFounder call discriminates on the error arm', () => {
    const bad: string[] = []
    for (const f of files) {
      const src = read(f)
      if (!src.includes('requireFounder(')) continue
      // Count call sites (excluding the definition and prose in comments).
      const calls = (src.match(/await\s+requireFounder\s*\(/g) || []).length
      if (calls === 0) continue
      const guards = (src.match(/'error'\s+in\s+\w+/g) || []).length
      if (guards < calls) bad.push(`${path.relative(SRC, f).replace(/\\/g, '/')} (${calls} calls, ${guards} guards)`)
    }
    expect(bad).toEqual([])
  })
})

describe('the founder diagnostic that leaked is scoped to one shop', () => {
  const src = fs.readFileSync(
    path.join(SRC, 'app/api/debug/supplier-opening-balance-review/route.ts'), 'utf8',
  ).replace(/\r\n/g, '\n')

  test('the GET requires an explicit target shop', () => {
    // Matches the precedent already set in debug/repair-headers:
    // "Cross-user scans are not allowed."
    expect(src).toMatch(/searchParams\.get\('userId'\)/)
    expect(src).toMatch(/Cross-user scans are not allowed/)
  })

  test('the GET query is scoped by that shop', () => {
    const block = src.slice(src.indexOf('db.party.findMany'), src.indexOf('db.party.findMany') + 300)
    expect(block).toMatch(/userId: targetUserId/)
  })

  test('the POST verifies ownership before it writes', () => {
    // A partyId from another shop must 404, not be silently modified.
    const block = src.slice(src.indexOf('db.party.findFirst'), src.indexOf('db.party.findFirst') + 300)
    expect(block).toMatch(/userId: targetUserId/)
  })

  test('the POST refuses to run without a target shop', () => {
    expect(src).toMatch(/userId is required/)
  })
})

/**
 * 🔒 CUSTOMER PII MUST NOT REACH THE SERVER LOG.
 *
 * Phase 5, 2026-08-03. The restore route logged a shopkeeper's CUSTOMER name
 * and the amount they paid:
 *
 *     console.error(`[restore] payment skipped: ... for ${payment.partyName} ...`)
 *
 * That writes a third party's name into Vercel and Sentry — systems the
 * shopkeeper never agreed to, retained on someone else's schedule, readable by
 * anyone with log access.
 *
 * The diagnostic value is the TYPE of failure, not whose it was. The name still
 * reaches the person entitled to it, in the API response shown to the
 * shopkeeper restoring their own books.
 */
describe('customer PII stays out of server logs', () => {
  // Plain substrings, deliberately — a regex here needs escaping that the
  // shell mangled once already, and substring matching is enough: we are
  // looking for these identifiers appearing inside a template hole.
  const CUSTOMER_FIELDS = ['partyName', 'party.name', 'customerName', 'party.phone']

  test('the scan reaches real source', () => {
    expect(files.length).toBeGreaterThan(50)
  })

  test('no console.* call interpolates a customer name or phone', () => {
    const offenders: string[] = []
    for (const f of files) {
      const src = read(f)
      for (const line of src.split('\n')) {
        if (!line.includes('console.')) continue
        if (!/console\.(log|error|warn|info)\s*\(/.test(line)) continue
        // Only flag when the field sits inside a ${...} interpolation — a
        // mention in a plain string is not a leak.
        for (const fld of CUSTOMER_FIELDS) {
          const i = line.indexOf(fld)
          if (i === -1) continue
          const before = line.slice(0, i)
          const open = before.lastIndexOf('${')
          const close = before.lastIndexOf('}')
          if (open > close) {
            offenders.push(`${f.split('src')[1]}: ${line.trim().slice(0, 100)}`)
            break
          }
        }
      }
    }
    expect(offenders).toEqual([])
  })

  test('the restore still reports the failure to the shopkeeper', () => {
    // Removing PII from the log must not make the failure silent again —
    // that was the whole point of the P6-6 fix this replaces.
    const src = read(path.join(SRC, 'app/api/import/restore/route.ts'))
    expect(src).toMatch(/results\.payments\.skipReasons\.push/)
    expect(src).toMatch(/console\.error\(`\[restore\] payment skipped/)
  })
})
