/**
 * Next.js instrumentation hook — runs once on server startup.
 * Loads Sentry before any request is processed.
 *
 * This file is automatically picked up by Next.js (no config needed).
 * See: https://nextjs.org/docs/app/building-your-application/optimizing/instrumentation
 *
 * Note: This file is at the project ROOT, so the import paths are './' not '../'.
 */

export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    await import('./sentry.server.config')

    // 🔒 AUDIT FIX V4 P5: Verify DB pooling config at startup.
    // Catches the most likely cause of 15-20s cold-starts: missing -pooler
    // host, missing connection_limit=1, or DIRECT_URL pointing at the pooler.
    // Logs clear warnings — does NOT fail startup (some dev envs use SQLite
    // without a pooler, which is fine).
    try {
      const { verifyDatabaseConfig } = await import('./src/lib/verify-db-config')
      verifyDatabaseConfig()
    } catch (e) {
      // Don't let config check break startup — log and continue.
      console.warn('[instrumentation] DB config check failed:', e)
    }
  }
  if (process.env.NEXT_RUNTIME === 'edge') {
    await import('./sentry.server.config')
  }
}
