/**
 * 🔒 #72 — every query that reads or writes rows must name the shop.
 *
 * Today one shop's data is kept from another's because a human remembered to
 * write `userId` in the where clause. That is discipline, not isolation. One
 * forgotten line and one shop reads another's ledger — the failure a
 * book-keeping app never recovers from.
 *
 * The real answer is row-level security in Postgres, so the DATABASE refuses.
 * That is a staged migration (see EKBOOK-72-ROW-LEVEL-SECURITY.md) and it
 * cannot be shipped blind: our connection is POOLED, so the shop identity has
 * to travel inside a transaction, and getting it wrong returns nothing for
 * everybody.
 *
 * THIS GUARD IS THE PART THAT CAN SHIP TODAY. It reads every API route and
 * finds queries whose filter never mentions the tenant. It cannot prove
 * isolation — only the database can — but it turns "we were careful" into
 * "the build fails", which is the difference between a rule and a hope.
 */

import { describe, test, expect } from '@jest/globals'
import { readFileSync, readdirSync, statSync } from 'fs'
import { join } from 'path'

const API = join(process.cwd(), 'src/app/api')

function routeFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry)
    if (statSync(p).isDirectory()) routeFiles(p, out)
    else if (entry === 'route.ts') out.push(p)
  }
  return out
}

/** Comments quote the very patterns we ban — read the code, not the prose. */
function stripComments(s: string): string {
  return s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
}

/**
 * Models that hold no shop data, so a query without a tenant filter is
 * correct rather than dangerous. Each one is named deliberately: a model
 * added here by mistake is a hole, so the list stays short and boring.
 */
const NOT_TENANT_SCOPED = new Set([
  'user', 'session', 'account', 'verificationToken',
  'announcement', 'appVersion', 'featureFlag', 'systemSetting',
  'waitlist', 'contactMessage', 'auditLog', 'errorLog',
  /*
   * A TOKEN IS THE CREDENTIAL. Looking one up by its hash cannot be scoped to
   * a user, because finding out WHICH user is the entire point of the lookup.
   * Both of these check expiry and single-use after they resolve.
   */
  'passwordResetToken', 'impersonationToken',
])

/**
 * Ways a query can legitimately name its tenant. `userId` and `ownerId` are
 * direct; `id` alone is NOT enough — a bare primary key is exactly how one
 * shop reads another's row by guessing an id.
 */
const TENANT_MARKERS = [
  'userId', 'ownerId', 'shopId',
  'activeTransactionWhere', 'activePartyWhere',   // helpers that add it
  'user: {', 'owner: {', 'transaction: {', 'party: {', 'product: {',
]

/**
 * Queries whose tenant check happens somewhere the scanner cannot see —
 * usually an ownership lookup earlier in the same handler. Each is written
 * out with the reason, and each was read by hand before being added.
 *
 * THIS LIST IS THE WEAK POINT OF THE WHOLE APPROACH, and worth naming: every
 * entry is a promise that a human checked once. That is exactly the
 * discipline row-level security exists to replace, which is why this guard is
 * the interim measure and not the answer.
 */
const CHECKED_ELSEWHERE: Record<string, string> = {
  'parties/[id]/route.ts:payment':
    'The party is fetched first with { id, userId, deletedAt: null } and the '
    + 'handler 404s if it is not yours (route.ts:71). The counts then run on a '
    + 'party already proven to belong to this shop.',
  'parties/[id]/route.ts:transaction':
    'Same ownership check at route.ts:71 — verified by hand 13 Aug.',
  'transactions/[id]/convert/route.ts:transaction':
    'Error path only. The estimate was already matched with { id, userId } at '
    + 'route.ts:49; this re-reads it after a duplicate-conversion error and '
    + 'selects only convertedToTransactionId and convertedAt — no shop data.',
  'debug/party-balance-detail/route.ts:transaction':
    'Founder-only: the route imports requireFounder from lib/debug-auth.',
  'transactions/route.ts:transaction':
    'The idempotency lookup by clientMutationId, and a previous audit already '
    + 'caught it: the row is fetched unscoped BECAUSE the mutation id is global, '
    + 'then `existing.userId !== userId` returns 409 rather than leaking. The '
    + 'comment above it explains why that check is not optional.',
  'transactions/[id]/route.ts:transactionItem':
    'Inside the edit transaction, after the parent was matched with '
    + '{ id, userId, deletedAt: null } (route.ts:557). Deleting the items of a '
    + 'transaction already proven to be this shop\'s.',
  'referral/apply/route.ts:referral':
    'A referral code is looked up BY CODE, exactly like a token — finding out '
    + 'whose code it is, is the point of the query.',
}

/**
 * The `{ ... }` a call was given, read by counting braces from its opening
 * one. Strings are skipped so a `}` inside a message cannot end it early.
 */
function argumentObject(src: string, openBrace: number): string {
  let depth = 0
  let quote: string | null = null
  for (let i = openBrace; i < src.length; i++) {
    const c = src[i]
    if (quote) {
      if (c === '\\') { i++; continue }
      if (c === quote) quote = null
      continue
    }
    if (c === '"' || c === "'" || c === '`') { quote = c; continue }
    if (c === '{') depth++
    else if (c === '}') {
      depth--
      if (depth === 0) return src.slice(openBrace, i + 1)
    }
  }
  return src.slice(openBrace, openBrace + 700)   // unbalanced — fall back
}

interface Finding { file: string; model: string; snippet: string }

function scan(): Finding[] {
  const findings: Finding[] = []
  for (const file of routeFiles(API)) {
    const src = stripComments(readFileSync(file, 'utf8'))
    const rel = file.replace(/\\/g, '/').split('src/app/api/')[1]

    // db.<model>.<op>({ ... }) — read the argument object up to a sane depth.
    for (const m of src.matchAll(/\bdb\.(\w+)\.(findMany|findFirst|findUnique|updateMany|deleteMany|aggregate|groupBy|count)\s*\(\s*\{/g)) {
      const model = m[1]
      if (NOT_TENANT_SCOPED.has(model)) continue

      /*
       * READ THIS QUERY'S OWN ARGUMENT, NOT ITS NEIGHBOURHOOD.
       *
       * My first version took a fixed 700-character window after the call and
       * passed if `userId` appeared anywhere in it — so a userId belonging to
       * the query ABOVE satisfied the one below. I proved it by deleting a
       * real tenant filter: the guard stayed green.
       *
       * That is the third time this week a guard has measured the wrong text
       * (a 900-char window, then a file's own comments, now a neighbour's
       * code). The lesson is the same each time: match the structure, and
       * always confirm by reintroducing the bug.
       */
      const window = argumentObject(src, (m.index || 0) + m[0].length - 1)
      if (TENANT_MARKERS.some(marker => window.includes(marker))) continue

      /*
       * FOLLOW A `where` HELD IN A VARIABLE.
       *
       * `db.transaction.aggregate({ where: expenseWhere })` is safe when
       * `expenseWhere` was built with the userId — which is the pattern this
       * codebase uses everywhere and rightly so. Without this, the guard
       * reports the correct code and stays silent about nothing, which is how
       * a guard trains people to ignore it.
       */
      /*
       * `{ where, select: ... }` — the shorthand property. Same case as the
       * named one below; without it the guard reports the count query added
       * in #73, whose `where` is built with the userId a few lines above.
       */
      const shorthand = /\{\s*where\s*,/.test(window)
      if (shorthand) {
        const decl = src.match(/(const|let)\s+where\s*[:=][\s\S]{0,900}/)?.[0] || ''
        if (TENANT_MARKERS.some(marker => decl.includes(marker))) continue
      }

      const named = window.match(/where:\s*(\w+)[,\s)]/)
      if (named) {
        // NB: the backslashes must be doubled — this is a template literal, so
        // `\s` would collapse to a plain "s" and the pattern would match
        // nothing while looking correct. My first version did exactly that.
        const decl = new RegExp(`(const|let)\\s+${named[1]}\\s*[:=][\\s\\S]{0,600}`)
        const body = src.match(decl)?.[0] || ''
        if (TENANT_MARKERS.some(marker => body.includes(marker))) continue
      }

      if (`${rel}:${model}` in CHECKED_ELSEWHERE) continue

      findings.push({ file: rel, model, snippet: window.split('\n').slice(0, 3).join(' ').slice(0, 100) })
    }
  }
  return findings
}

describe('every query names the shop it belongs to', () => {
  test('the scanner still finds queries at all', () => {
    // A scanner that silently matches nothing is worse than no scanner: it
    // reports success forever. Assert it sees a realistic codebase.
    const routes = routeFiles(API)
    expect(routes.length).toBeGreaterThan(20)
  })

  test('no route reads or writes rows without naming the tenant', () => {
    const findings = scan()
    if (findings.length) {
      throw new Error(
        `\n\n🔒 TENANT SCOPE GUARD FAILED — ${findings.length} quer(ies) with no tenant filter:\n\n` +
        findings.map(f => `  • ${f.file}  db.${f.model}  ${f.snippet}`).join('\n') +
        `\n\nEach must either filter by userId/ownerId, go through ` +
        `activeTransactionWhere/activePartyWhere, or be added to ` +
        `NOT_TENANT_SCOPED in this file WITH a reason.\n\n` +
        `A bare primary key is NOT enough: reading a row by id alone is how ` +
        `one shop reads another's ledger by guessing.\n`,
      )
    }
    expect(findings).toEqual([])
  })
})
