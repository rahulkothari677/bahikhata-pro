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
