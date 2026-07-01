/**
 * Next.js instrumentation hook — runs once on server startup.
 * Loads Sentry before any request is processed.
 *
 * This file is automatically picked up by Next.js (no config needed).
 * See: https://nextjs.org/docs/app/building-your-application/optimizing/instrumentation
 */

export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    await import('../sentry.server.config')
  }
  if (process.env.NEXT_RUNTIME === 'edge') {
    await import('../sentry.server.config')
  }
}
