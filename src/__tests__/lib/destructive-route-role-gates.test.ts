/**
 * 🔒 DESTRUCTIVE-ROUTE ROLE GATES
 *
 * WHY THIS EXISTS
 * ---------------
 * Round 17 identified — correctly — that "any staff could delete any document"
 * from the Document Vault (GST certificates, ID proofs, bank statements). The
 * fix hid the delete button in DocumentVault.tsx. The ENDPOINT kept accepting
 * the request, so a staff member could still call
 * `DELETE /api/documents?id=...` directly and destroy the owner's records.
 *
 * This is the third time in one day that a fix was applied to the UI while the
 * server kept doing the dangerous thing (the others: /api/products still
 * returning cost prices, and /api/transactions/[id]/convert still returning
 * grossProfit). Hiding a control is not access control.
 *
 * Note that staff SHARE the owner's `userId` — authCtx.userId is the ownerId —
 * so an ownership lookup does NOT distinguish them. The role check has to be
 * explicit, which is exactly why this class keeps slipping through.
 *
 * Every DELETE route must therefore carry a deliberate gate: an explicit role
 * check, an owner/founder-only helper, or a module-permission helper (which is
 * a considered decision that staff holding that module may delete).
 */

import fs from 'fs'
import path from 'path'

const API_DIR = path.join(process.cwd(), 'src/app/api')

/** Any of these counts as a deliberate authorization decision. */
const GATE_PATTERNS = [
  /role\s*!==\s*'owner'/,          // explicit owner-only
  /getAuthUserIdOwnerOnly/,        // owner-only helper
  /requireFounder/,                // founder-only helper
  /getAuthContextForWrite\(/,      // module permission + CA read-only block
  /getAuthUserIdWithModule\(/,     // module permission
  /canAccessModule\(/,             // explicit module check
]

function walk(dir: string, out: string[] = []): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) walk(p, out)
    else if (e.name === 'route.ts') out.push(p)
  }
  return out
}

/** Extract the body of a named handler (best-effort, brace-free heuristic). */
function handlerBody(src: string, method: string): string | null {
  const start = src.indexOf(`export async function ${method}(`)
  if (start === -1) return null
  // Until the next top-level `export async function`, or EOF.
  const rest = src.slice(start + 10)
  const nextExport = rest.indexOf('\nexport async function ')
  return nextExport === -1 ? rest : rest.slice(0, nextExport)
}

describe('destructive routes carry an explicit authorization gate', () => {
  const routes = walk(API_DIR)

  test('the sweep finds DELETE handlers (guard is wired)', () => {
    const withDelete = routes.filter(f =>
      fs.readFileSync(f, 'utf8').includes('export async function DELETE('))
    expect(withDelete.length).toBeGreaterThan(5)
  })

  test('every DELETE handler is gated', () => {
    const offenders: string[] = []

    for (const file of routes) {
      const src = fs.readFileSync(file, 'utf8')
      const body = handlerBody(src, 'DELETE')
      if (!body) continue

      // Strip comments so prose about roles doesn't count as a gate.
      const code = body
        .replace(/\/\*[\s\S]*?\*\//g, ' ')
        .replace(/\/\/[^\n]*/g, ' ')

      // A handler that never touches the database cannot destroy anything —
      // e.g. the deprecated DELETE /api/transactions stub that just returns
      // 410 Gone. Requiring a gate there would be noise, and a noisy guard
      // gets ignored.
      if (!/\bdb\./.test(code)) continue

      if (GATE_PATTERNS.some(re => re.test(code))) continue

      const rel = file.replace(/\\/g, '/').split('src/app/api/')[1]
      offenders.push(
        `${rel} — DELETE has no role/module gate. Staff share the owner's userId, ` +
        `so an ownership lookup does not restrict them. Add an explicit check.`,
      )
    }

    expect(offenders).toEqual([])
  })

  test('document deletion specifically is owner-only', () => {
    const src = fs.readFileSync(path.join(API_DIR, 'documents/route.ts'), 'utf8')
    const body = handlerBody(src, 'DELETE')!
    // Documents hold GST certificates and ID proofs — module permission is not
    // enough here; it must be the owner.
    expect(body).toMatch(/authCtx\.role !== 'owner'/)
    expect(body).toMatch(/status:\s*403/)
  })
})
