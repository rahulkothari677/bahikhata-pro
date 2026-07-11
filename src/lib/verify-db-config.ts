/**
 * 🔒 AUDIT FIX V4 P5: Runtime verification of database pooling configuration.
 *
 * The auditor flagged that "already configured" was an assumption that
 * conflicted with the user's 20s cold-start complaint. This module verifies
 * the actual env vars at server startup and logs clear warnings if any of
 * the three pooling requirements are missing:
 *
 *   1. `DATABASE_URL` host contains `-pooler` (uses Neon's pooled endpoint)
 *   2. `DATABASE_URL` query string contains `connection_limit=1` (and ideally
 *      `pgbouncer=true`) — on serverless each function must hold exactly 1
 *      connection.
 *   3. `DIRECT_URL` is set and uses the NON-pooler host (for migrations only).
 *
 * The Neon "Scale to zero / Suspend" setting is in the Neon console, not
 * code — we can't check it from here. See docs/AUDIT-AND-FIX-PLAN.md →
 * "V4 Phase — P5" for the manual check.
 *
 * This module is safe to call multiple times — checks run once and cache.
 * Called from instrumentation.ts on server startup.
 */

let _checked = false

export function verifyDatabaseConfig(): void {
  if (_checked) return
  _checked = true

  const databaseUrl = process.env.DATABASE_URL || ''
  const directUrl = process.env.DIRECT_URL || ''

  const warnings: string[] = []
  const ok: string[] = []

  // Parse the connection string to extract host + query string
  // Format: postgresql://user:pass@host/db?query
  const dbUrlMatch = databaseUrl.match(/^postgresql?:\/\/[^@]+@([^\/?:]+)\/?[^?]*(\?.*)?$/i)
  const dbHost = dbUrlMatch?.[1] || ''
  const dbQuery = dbUrlMatch?.[2] || ''

  // Check 1: -pooler in host
  if (!dbHost) {
    warnings.push('DATABASE_URL could not be parsed (expected postgresql://user:pass@host/db?query). Pooling checks skipped.')
  } else if (!dbHost.includes('-pooler')) {
    warnings.push(
      `DATABASE_URL host "${dbHost}" does NOT contain "-pooler". ` +
      `On Vercel serverless, every function instance opens its own DB connections — ` +
      `without the pooled endpoint, Postgres runs out of connections under load. ` +
      `Fix: in Neon console → Connection Details → copy the "Pooled connection" string ` +
      `(it has -pooler in the hostname) and set DATABASE_URL to it.`
    )
  } else {
    ok.push(`DATABASE_URL uses pooled host: ${dbHost}`)
  }

  // Check 2: connection_limit=1 (and ideally pgbouncer=true)
  if (dbHost && dbHost.includes('-pooler')) {
    if (!dbQuery.includes('connection_limit=1')) {
      warnings.push(
        `DATABASE_URL is missing "connection_limit=1" in the query string. ` +
        `On Vercel serverless, each function must hold exactly 1 connection. ` +
        `Fix: append &connection_limit=1 to your DATABASE_URL. ` +
        `Current query: ${dbQuery || '(none)'}`
      )
    } else {
      ok.push('DATABASE_URL has connection_limit=1')
    }
    if (!dbQuery.includes('pgbouncer=true')) {
      warnings.push(
        `DATABASE_URL is missing "pgbouncer=true" in the query string. ` +
        `Without PgBouncer mode, Prisma can't use the pooled endpoint correctly ` +
        `for transaction-mode pooling. Fix: append &pgbouncer=true to your DATABASE_URL.`
      )
    } else {
      ok.push('DATABASE_URL has pgbouncer=true')
    }
  }

  // Check 3: DIRECT_URL is set and uses the non-pooler host (for migrations)
  if (!directUrl) {
    warnings.push(
      `DIRECT_URL is not set. Prisma needs the DIRECT (non-pooler) connection ` +
      `for migrations — the pooled endpoint can't run DDL through PgBouncer. ` +
      `Fix: in Neon console → Connection Details → copy the "Direct connection" ` +
      `string (no -pooler) and set DIRECT_URL to it.`
    )
  } else {
    const directUrlMatch = directUrl.match(/^postgresql?:\/\/[^@]+@([^\/?:]+)/i)
    const directHost = directUrlMatch?.[1] || ''
    if (directHost.includes('-pooler')) {
      warnings.push(
        `DIRECT_URL host "${directHost}" contains "-pooler" — but DIRECT_URL ` +
        `should be the NON-pooled endpoint (for migrations only). Using the ` +
        `pooled endpoint for migrations will fail or hang. Fix: copy the ` +
        `"Direct connection" string from Neon console.`
      )
    } else {
      ok.push(`DIRECT_URL uses non-pooled host: ${directHost}`)
    }
  }

  // Log results
  if (warnings.length > 0) {
    console.warn('=========================================================')
    console.warn('⚠️  DATABASE POOLING CONFIGURATION WARNINGS (audit P5)')
    console.warn('=========================================================')
    warnings.forEach((w, i) => console.warn(`  ${i + 1}. ${w}`))
    console.warn('')
    console.warn('  These are likely the root cause of slow cold-starts (15-20s).')
    console.warn('  Also check Neon → Settings → Compute → "Suspend" is OFF.')
    console.warn('  See docs/AUDIT-AND-FIX-PLAN.md → "V4 Phase — P5" for details.')
    console.warn('=========================================================')
  }
  if (ok.length > 0) {
    // 🔒 V7 Audit M2: Changed from console.log to console.debug to reduce
    // serverless log noise. console.debug is filtered by default in Vercel.
    console.debug('[db-config] Pooling checks passed:', ok.join(', '))
  }
}

/**
 * Returns a JSON snapshot of the DB config checks — useful for a diagnostic
 * endpoint or admin panel. Never logs secrets (passwords are stripped).
 */
export function getDatabaseConfigStatus(): {
  databaseUrlHasPooler: boolean
  databaseUrlHasConnectionLimit: boolean
  databaseUrlHasPgbouncer: boolean
  directUrlSet: boolean
  directUrlHasPooler: boolean  // should be FALSE
  databaseUrlHost: string
  directUrlHost: string
  warnings: string[]
} {
  const databaseUrl = process.env.DATABASE_URL || ''
  const directUrl = process.env.DIRECT_URL || ''

  const dbUrlMatch = databaseUrl.match(/^postgresql?:\/\/[^@]+@([^\/?:]+)\/?[^?]*(\?.*)?$/i)
  const dbHost = dbUrlMatch?.[1] || ''
  const dbQuery = dbUrlMatch?.[2] || ''

  const directUrlMatch = directUrl.match(/^postgresql?:\/\/[^@]+@([^\/?:]+)/i)
  const directHost = directUrlMatch?.[1] || ''

  return {
    databaseUrlHasPooler: dbHost.includes('-pooler'),
    databaseUrlHasConnectionLimit: dbQuery.includes('connection_limit=1'),
    databaseUrlHasPgbouncer: dbQuery.includes('pgbouncer=true'),
    directUrlSet: !!directUrl,
    directUrlHasPooler: directHost.includes('-pooler'),
    databaseUrlHost: dbHost,
    directUrlHost: directHost,
    warnings: [],
  }
}
