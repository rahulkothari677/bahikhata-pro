/**
 * 🔒 AUDIT PASS-1 N1–N5 — guard against unbounded reads on request paths.
 *
 * WHY THIS FILE EXISTS: `bahikhata-admin` has had tests/unbounded-queries.test.ts
 * for a while. `bahikhata-pro` — the app that actually holds the financial data —
 * had no equivalent. That asymmetry is why N1 through N5 accumulated unnoticed:
 * nothing failed when a new `findMany` shipped without a bound.
 *
 * WHAT IT ENFORCES: every `db.*.findMany(...)` under src/app/api and src/lib must
 * either
 *   - carry a `take:` (explicit row cap), or
 *   - be bounded by construction (an id-set, a parent id, or a date range), or
 *   - appear in ACCEPTED below with a stated reason.
 *
 * The allowlist is the point. An exception should be a decision somebody made
 * and signed, not an oversight nobody noticed. Adding an entry is cheap;
 * adding one without a reason should not get through review.
 *
 * NOTE ON SCOPE: this is a static text check, not a type-aware analysis. It is
 * deliberately simple — a guard that is easy to reason about and hard to
 * silently defeat beats a clever one nobody maintains.
 */

import fs from 'fs'
import path from 'path'

const SRC = path.join(process.cwd(), 'src')
const SCAN_DIRS = [path.join(SRC, 'app', 'api'), path.join(SRC, 'lib')]

/**
 * Queries that legitimately read a whole collection, each with the reason it
 * is safe. Keyed by "<relative path>:<model>".
 */
const ACCEPTED: Record<string, string> = {
  // — Small, naturally-bounded collections —————————————————————————————
  'app/api/shops/route.ts:shop': 'A user has a handful of shops.',
  'app/api/bootstrap/route.ts:shop': 'A user has a handful of shops.',
  'app/api/export/full/route.ts:shop': 'A user has a handful of shops.',
  'app/api/reports/consolidated/route.ts:shop': 'A user has a handful of shops.',
  'app/api/staff/route.ts:user': 'Bounded by team size (staff + CAs of one owner).',
  'app/api/feature-flags/route.ts:featureFlag': 'Small global config table.',
  'lib/feature-flags.ts:featureFlag': 'Small global config table.',
  'app/api/referral/status/route.ts:referral': "Bounded by one user's own referrals.",
  'app/api/documents/route.ts:document': 'Document vault per user; small by nature.',

  // — Bounded by a parent row —————————————————————————————————————————
  'app/api/transactions/[id]/route.ts:transaction': 'Credit/debit notes against ONE invoice.',

  // — Not request paths: one-off recovery / maintenance ————————————————
  'app/api/import/restore/route.ts:party': 'One-off restore operation, not a hot path.',
  'app/api/import/restore/route.ts:transaction': 'One-off restore operation, not a hot path.',
  'lib/restore-utils.ts:product': 'One-off restore operation, not a hot path.',
  'lib/restore-utils.ts:transactionItem': 'One-off restore operation, not a hot path.',

  // — Deliberate full exports ——————————————————————————————————————————
  // These SHOULD stream rather than buffer, tracked separately; they are not
  // on a hot path and the user explicitly asked for everything.
  'app/api/account/export/route.ts:product': 'Deliberate full export (DSAR/backup).',
  'app/api/account/export/route.ts:party': 'Deliberate full export (DSAR/backup).',
  'app/api/account/export/route.ts:transaction': 'Deliberate full export (DSAR/backup).',
  'app/api/account/export/route.ts:payment': 'Deliberate full export (DSAR/backup).',
  'app/api/account/export/route.ts:auditLog': 'Deliberate full export (DSAR/backup).',

  // — Cron: bounded by the work that is actually due ————————————————————
  'app/api/cron/expire-subscriptions/route.ts:subscription':
    'Bounded by EXPIRING subscriptions (status active + endDate < now), not all of them.',

  // — Known open findings, tracked in docs/audit/04-scale-sweep.md ————————
  // Listed so the suite is green while the work is scheduled. Each MUST be
  // removed from this list when fixed — that is the point of naming them.
  // N3 (dashboard) is FIXED — its entries were removed from this list by the
  // stale-entry check the moment the aggregates landed. That is the intended
  // lifecycle: an entry here is a debt, and paying it off deletes the line.
  'app/api/insights/route.ts:product': 'N4 — OPEN. Tracked in docs/audit/04-scale-sweep.md.',
  'app/api/analytics/route.ts:product': 'N4 — OPEN. Tracked in docs/audit/04-scale-sweep.md.',
  'app/api/reports/route.ts:product': 'N4 — OPEN. Tracked in docs/audit/04-scale-sweep.md.',
  'app/api/reports/route.ts:party': 'N4 — OPEN. Tracked in docs/audit/04-scale-sweep.md.',
  'app/api/reports/consolidated/route.ts:product': 'N4 — OPEN. Tracked in docs/audit/04-scale-sweep.md.',
  // NOTE: parties/[id]/balance-as-of is deliberately ABSENT. It needed an
  // exception until the N5 fix pushed `date <= asOfDate` into SQL; now the
  // scanner sees it as date-bounded and no exception is required. That is the
  // stale-entry check earning its keep — it forced this list to shrink.
}

/** Blank out comments so documentation examples are not read as live code. */
function stripComments(s: string): string {
  const out = s.split('')
  let i = 0
  while (i < s.length) {
    if (s[i] === '/' && s[i + 1] === '/') {
      while (i < s.length && s[i] !== '\n') { out[i] = ' '; i++ }
    } else if (s[i] === '/' && s[i + 1] === '*') {
      while (i < s.length && !(s[i] === '*' && s[i + 1] === '/')) {
        if (s[i] !== '\n') out[i] = ' '
        i++
      }
      if (i < s.length) { out[i] = ' '; out[i + 1] = ' '; i += 2 }
    } else i++
  }
  return out.join('')
}

interface Finding { rel: string; line: number; model: string; key: string }

function scan(): Finding[] {
  const findings: Finding[] = []

  const walk = (dir: string) => {
    if (!fs.existsSync(dir)) return
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) { walk(full); continue }
      if (!/\.tsx?$/.test(entry.name)) continue

      const raw = fs.readFileSync(full, 'utf8')
      const src = stripComments(raw)
      const rel = path.relative(SRC, full).split(path.sep).join('/')

      // Founder-gated maintenance endpoints are not user request paths.
      if (rel.startsWith('app/api/debug/')) continue

      const re = /(?:db|tx|prisma)\.(\w+)\.findMany\(/g
      let m: RegExpExecArray | null
      while ((m = re.exec(src)) !== null) {
        const start = m.index + m[0].length - 1
        let depth = 0, j = start
        for (; j < Math.min(src.length, start + 5000); j++) {
          if (src[j] === '(') depth++
          else if (src[j] === ')') { depth--; if (depth === 0) break }
        }
        const block = src.slice(start, j + 1).replace(/\s+/g, ' ')

        if (/\btake\s*:/.test(block)) continue                       // explicit cap
        if (/\bid:\s*\{\s*in:/.test(block)) continue                 // id-set
        if (/\btransactionId:/.test(block)) continue                 // parent id
        if (/\bdate:\s*\{/.test(block) || /\bgte:/.test(block)) continue // date range

        findings.push({
          rel,
          line: raw.slice(0, m.index).split('\n').length,
          model: m[1],
          key: `${rel}:${m[1]}`,
        })
      }
    }
  }

  SCAN_DIRS.forEach(walk)
  return findings
}

describe('unbounded queries on request paths', () => {
  const findings = scan()

  test('the scanner actually finds queries (guards against a silently broken regex)', () => {
    // If a refactor breaks the scan, this suite would "pass" by finding
    // nothing. Assert it still sees a realistic number of call sites.
    expect(findings.length).toBeGreaterThan(0)
  })

  test('every unbounded findMany is either bounded or explicitly accepted', () => {
    const unexplained = findings.filter(f => !(f.key in ACCEPTED))

    if (unexplained.length > 0) {
      const detail = unexplained
        .map(f => `  ${f.rel}:${f.line}  db.${f.model}.findMany  (key: "${f.key}")`)
        .join('\n')
      throw new Error(
        `Found ${unexplained.length} unbounded findMany call(s) with no row cap and no stated reason:\n\n` +
        `${detail}\n\n` +
        `A findMany on a request path must do ONE of:\n` +
        `  • add \`take: N\` (preferred — an explicit cap),\n` +
        `  • bound it by an id-set / parent id / date range, or\n` +
        `  • add the key to ACCEPTED in this file WITH a reason.\n\n` +
        `This guard exists because N1-N5 (see docs/audit/04-scale-sweep.md) all\n` +
        `shipped unnoticed for want of it. If you are adding to ACCEPTED, say why\n` +
        `the collection cannot grow without bound for a single user.`
      )
    }

    expect(unexplained).toEqual([])
  })

  test('the allowlist has no stale entries', () => {
    // A key that no longer matches anything means the query was fixed or moved.
    // Removing it keeps the list honest — otherwise it silently accumulates
    // permissions for code that no longer exists.
    const liveKeys = new Set(findings.map(f => f.key))
    const stale = Object.keys(ACCEPTED).filter(k => !liveKeys.has(k))
    expect(stale).toEqual([])
  })
})
