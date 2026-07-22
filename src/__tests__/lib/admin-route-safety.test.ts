/**
 * Safety rules for /api/admin/* routes (2026-07-22).
 *
 * The agent added these routes in 532a865. One of them, repair-headers, WROTE
 * to the database from a GET handler (`?fix=true`) and queried every
 * transaction in the system with no userId filter. In shop terms: an admin
 * opening a bookmarked link — or a browser quietly prefetching it — would
 * rewrite the invoice totals of every shopkeeper on the platform at once.
 *
 * Admin routes are the least-guarded surface in the app and the most
 * dangerous, so the rules are asserted rather than remembered.
 */
import fs from 'fs'
import path from 'path'

const ADMIN_DIR = path.join(process.cwd(), 'src/app/api/admin')

function adminRoutes(): string[] {
  const out: string[] = []
  const walk = (dir: string) => {
    if (!fs.existsSync(dir)) return
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) walk(full)
      else if (entry.name === 'route.ts') out.push(full)
    }
  }
  walk(ADMIN_DIR)
  return out
}

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

const routes = adminRoutes()

describe('admin routes', () => {
  test('there is at least one, so this suite is not silently vacuous', () => {
    expect(routes.length).toBeGreaterThan(0)
  })

  test.each(routes)('%s requires admin before doing anything', (file) => {
    const src = stripComments(fs.readFileSync(file, 'utf8'))
    for (const method of ['GET', 'POST', 'PUT', 'PATCH', 'DELETE']) {
      const body = handlerBody(src, method)
      if (!body) continue
      expect(body).toMatch(/requireAdmin\(\)/)
      // The gate must come before any database access.
      const gateIdx = body.indexOf('requireAdmin()')
      const dbIdx = body.search(/\bdb\.\w+\./)
      if (dbIdx > -1) expect(gateIdx).toBeLessThan(dbIdx)
    }
  })

  test.each(routes)('%s never writes from a GET', (file) => {
    const src = stripComments(fs.readFileSync(file, 'utf8'))
    const get = handlerBody(src, 'GET')
    if (!get) return
    // A GET is safe to prefetch by definition; browsers act on that.
    expect(get).not.toMatch(/db\.\w+\.(update|updateMany|create|createMany|delete|deleteMany|upsert)\(/)
    expect(get).not.toMatch(/\$executeRaw/)
  })

  test.each(routes)('%s scopes every write to a single user', (file) => {
    const src = stripComments(fs.readFileSync(file, 'utf8'))
    for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
      const body = handlerBody(src, method)
      if (!body) continue
      if (!/db\.\w+\.(update|updateMany|delete|deleteMany|upsert)\(/.test(body)) continue
      // Cross-tenant writes are how one admin action damages every shop.
      expect(body).toMatch(/userId/)
    }
  })
})

describe('repair-headers specifically', () => {
  const file = path.join(ADMIN_DIR, 'repair-headers/route.ts')
  const src = stripComments(fs.readFileSync(file, 'utf8'))

  test('the fix=true write path is gone', () => {
    expect(src).not.toMatch(/shouldFix/)
    expect(src).not.toMatch(/searchParams\.get\('fix'\)/)
  })

  test('repair is by explicit id list, never a sweep', () => {
    // The same protocol the payment repair follows: a heuristic that looks
    // safe in aggregate destroys legitimate rows.
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
})
