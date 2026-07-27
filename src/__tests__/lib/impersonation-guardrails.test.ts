/**
 * Impersonation guardrails (2026-07-26).
 *
 * An admin can log in AS a shopkeeper via /api/impersonate to provide support.
 * The token mechanics are sound (256-bit, hashed at rest, 5-minute expiry,
 * atomic single-use), but the session that results is a FULL session for that
 * user. Before this change `isImpersonated` did nothing except render a yellow
 * banner — an admin could delete the account, wipe the books, export the whole
 * dataset or start a payment, and only an audit-log entry would show it.
 *
 * Posture chosen (option A): ordinary ledger writes stay ALLOWED so support is
 * still useful, but actions that are irreversible, export everything, or move
 * money are refused. Those remain the real owner's decision.
 *
 * These are structural guards. A new destructive route that forgets the gate is
 * exactly the failure this catches — the list below is the contract.
 */
import fs from 'fs'
import path from 'path'

function read(rel: string): string {
  return fs.readFileSync(path.join(process.cwd(), 'src', rel), 'utf8')
}

function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')
}

/** Routes that must refuse an impersonating admin, and why. */
const MUST_GUARD: Array<[string, string]> = [
  ['app/api/account/delete/route.ts', 'deletes the account and all its data'],
  ['app/api/account/export/route.ts', 'exports the entire dataset'],
  ['app/api/export/full/route.ts', 'exports the entire dataset'],
  ['app/api/import/restore/route.ts', 'overwrites the books wholesale'],
  ['app/api/seed/route.ts', 'wipes all data (DELETE)'],
  ['app/api/payment/create-order/route.ts', "moves the owner's money"],
  ['app/api/payment/verify/route.ts', "moves the owner's money"],
]

/**
 * Owner-only routes that must NOT be blocked. These are reads support needs;
 * blocking bootstrap in particular would break impersonation outright, since
 * the app cannot load without it.
 */
const MUST_NOT_BLOCK = [
  'app/api/bootstrap/route.ts',
  'app/api/subscription/status/route.ts',
  'app/api/ai-usage/route.ts',
]

describe('the guard helper', () => {
  const auth = stripComments(read('lib/get-auth.ts'))

  test('assertNotImpersonated exists and returns 403', () => {
    expect(auth).toMatch(/export function assertNotImpersonated/)
    const fn = auth.slice(auth.indexOf('export function assertNotImpersonated'))
    expect(fn.slice(0, 600)).toMatch(/status: 403/)
  })

  test('the auth context exposes isImpersonated so routes can consult it', () => {
    expect(auth).toMatch(/isImpersonated: boolean/)
    expect(auth).toMatch(/\(session\.user as any\)\.isImpersonated === true/)
  })

  test('the owner-only helper reports impersonation rather than blocking wholesale', () => {
    // A blanket block inside the helper would break bootstrap — see MUST_NOT_BLOCK.
    const fn = auth.slice(auth.indexOf('export async function getAuthUserIdOwnerOnly'))
    const body = fn.slice(0, fn.indexOf('\n}'))
    expect(body).toMatch(/isImpersonated/)
    expect(body).not.toMatch(/assertNotImpersonated/)
  })
})

describe('destructive and money routes refuse an impersonating admin', () => {
  test.each(MUST_GUARD)('%s (%s)', (rel) => {
    const src = stripComments(read(rel))
    expect(src).toMatch(/assertNotImpersonated/)
    // The guard must be wired to a real value, not a literal that defeats it.
    expect(src).not.toMatch(/assertNotImpersonated\(\{\s*isImpersonated:\s*false\s*\}\)/)
  })

  test('the guard runs before any database work', () => {
    // Refusing after a partial write would be worse than not guarding at all.
    for (const [rel] of MUST_GUARD) {
      const src = stripComments(read(rel))
      const guardIdx = src.indexOf('assertNotImpersonated')
      const dbIdx = src.search(/\bdb\.\w+\.(create|update|delete|deleteMany|updateMany|upsert)\(/)
      if (dbIdx > -1) expect(guardIdx).toBeLessThan(dbIdx)
    }
  })
})

describe('support can still do its job', () => {
  test.each(MUST_NOT_BLOCK)('%s is not blocked', (rel) => {
    const src = stripComments(read(rel))
    expect(src).not.toMatch(/assertNotImpersonated/)
  })
})

describe('there is exactly one impersonation consumer route', () => {
  test('the orphan under /api/auth is gone', () => {
    // Two near-identical redemption endpoints existed. The admin app mints
    // /api/impersonate (bahikhata-admin commit #6), and /api/auth/* is
    // swallowed by the NextAuth catch-all, so the /api/auth one was dead code
    // that a security fix could silently miss.
    expect(fs.existsSync(path.join(process.cwd(), 'src/app/api/auth/impersonate/route.ts'))).toBe(false)
    expect(fs.existsSync(path.join(process.cwd(), 'src/app/api/impersonate/route.ts'))).toBe(true)
  })

  test('nothing still points at the dead URL', () => {
    for (const rel of ['app/layout.tsx', 'components/common/ImpersonationBanner.tsx', 'lib/auth.ts', 'types/next-auth.d.ts']) {
      expect(read(rel)).not.toMatch(/api\/auth\/impersonate/)
    }
  })
})
