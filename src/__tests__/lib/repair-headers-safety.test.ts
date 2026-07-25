/**
 * Safety rules for /api/debug/repair-headers (moved from admin-route-safety.test.ts).
 *
 * 🔒 INTEGRATION PHASE D.2 (2026-07-25): This test was originally at
 * src/__tests__/lib/admin-route-safety.test.ts and covered all /api/admin/*
 * routes. Those 5 routes were deleted in Phase D.2 (B.3) — the separate
 * bahikhata-admin app handles all admin functionality now. The only route
 * that was preserved (moved, not deleted) is repair-headers, because it's
 * a documented data-repair tool (see BUGS-FOUND.md BUG-009).
 *
 * The route was moved from /api/admin/repair-headers to /api/debug/repair-headers
 * and its auth was upgraded from requireAdmin() (hardcoded 2-email allowlist)
 * to requireFounder() (env-var-based) + isRepairAllowed() (env-gated in prod).
 *
 * The safety invariants below are PRESERVED from the original test — they
 * guard against the bugs that were fixed on 2026-07-22 (GET-writes, unscoped
 * repairs) regressing.
 */
import fs from 'fs'
import path from 'path'

const REPAIR_HEADERS = path.join(process.cwd(), 'src/app/api/debug/repair-headers/route.ts')

function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')
}

/** Body of a single exported handler, up to the next `export async function`. */
function handlerBody(src: string, method: string): string | null {
  const marker = `export async function ${method}(`
  const start = src.indexOf(marker)
  if (start === -1) return null
  const next = src.indexOf('export async function ', start + marker.length)
  return src.slice(start, next === -1 ? undefined : next)
}

describe('repair-headers route exists at the new debug location', () => {
  test('the file exists', () => {
    expect(fs.existsSync(REPAIR_HEADERS)).toBe(true)
  })
})

describe('repair-headers auth (upgraded in Phase D.2)', () => {
  const src = stripComments(fs.readFileSync(REPAIR_HEADERS, 'utf8'))

  test('GET uses requireFounder() (not the deleted requireAdmin())', () => {
    const get = handlerBody(src, 'GET')!
    expect(get).toMatch(/requireFounder\(\)/)
    expect(get).not.toMatch(/requireAdmin\(\)/)
  })

  test('POST uses requireFounder() + isRepairAllowed() (defense-in-depth)', () => {
    const post = handlerBody(src, 'POST')!
    expect(post).toMatch(/requireFounder\(\)/)
    expect(post).toMatch(/isRepairAllowed\(\)/)
    expect(post).not.toMatch(/requireAdmin\(\)/)
  })
})

describe('repair-headers safety invariants (preserved from 2026-07-22 fix)', () => {
  const src = stripComments(fs.readFileSync(REPAIR_HEADERS, 'utf8'))

  test('the fix=true write path is gone (GET must never write)', () => {
    expect(src).not.toMatch(/shouldFix/)
    expect(src).not.toMatch(/searchParams\.get\('fix'\)/)
    const get = handlerBody(src, 'GET')!
    expect(get).not.toMatch(/db\.\w+\.(update|updateMany|create|createMany|delete|deleteMany|upsert)\(/)
    expect(get).not.toMatch(/\$executeRaw/)
  })

  test('repair is by explicit id list, never a sweep', () => {
    const post = handlerBody(src, 'POST')!
    expect(post).toMatch(/transactionIds/)
    expect(post).toMatch(/id: \{ in: transactionIds \}/)
    expect(post).toMatch(/userId/)
  })

  test('it refuses an unscoped or empty repair request', () => {
    const post = handlerBody(src, 'POST')!
    expect(post).toMatch(/if \(!userId \|\| transactionIds\.length === 0\)/)
    expect(post).toMatch(/status: 400/)
  })

  test('GET requires a userId query param (no cross-user scans)', () => {
    const get = handlerBody(src, 'GET')!
    expect(get).toMatch(/targetUserId/)
    expect(get).toMatch(/userId.*is required/)
  })
})
