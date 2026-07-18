import * as Sentry from '@sentry/nextjs'

/**
 * Sentry client-side configuration.
 *
 * Captures browser errors, React render errors, and client-side exceptions.
 * Automatically attaches to the global error handler and unhandled rejections.
 *
 * To enable: set SSENTRY_DSN in Vercel env vars.
 * Get the DSN from: https://sentry.io/settings/projects/bahikhata-pro/keys/
 *
 * If SENTRY_DSN is not set, Sentry is a no-op (safe for local dev).
 */

const SENTRY_DSN = process.env.NEXT_PUBLIC_SENTRY_DSN || process.env.SENTRY_DSN

if (SENTRY_DSN) {
  Sentry.init({
    dsn: SENTRY_DSN,

    // Performance monitoring — sample 10% of transactions to keep cost down
    // (Sentry charges per transaction). Increase to 1.0 for full tracing.
    tracesSampleRate: 0.1,

    // Session replay — disabled by default to save cost. Enable if you need
    // to see what users did before a crash.
    replaysSessionSampleRate: 0,
    replaysOnErrorSampleRate: 1.0,  // always replay errors

    // Environment tagging — separate prod errors from staging/dev
    environment: process.env.NODE_ENV || 'development',

    // Release tracking — tags errors with the current git commit
    release: process.env.NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA || 'local',

    // Filter out noisy errors that aren't actionable
    ignoreErrors: [
      'ResizeObserver loop limit exceeded',  // browser quirk, not actionable
      'Network request failed',  // offline mode handles this
      'Failed to fetch',  // offline mode handles this
    ],

    // Don't send errors from browser extensions
    denyUrls: [
      /chrome-extension:/,
      /moz-extension:/,
      /safari-web-extension:/,
    ],

    // 🔒 Feature Phase 2: Crash-free metric — increment local crash counter
    // on every error captured by Sentry. Used by the "Report a Problem" form
    // and the About page to show the user their crash-free session %.
    beforeSend(event) {
      try {
        const current = parseInt(localStorage.getItem('bahikhata:crash-count') || '0')
        localStorage.setItem('bahikhata:crash-count', String(current + 1))
      } catch {
        // localStorage not available — skip silently
      }
      return event
    },
  })
}
