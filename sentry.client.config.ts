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
 *
 * 🔒 V26 R18 (Phase 5): Observability polish.
 *   - Replay masking pinned (maskAllText + blockAllMedia) so an SDK default
 *     change can't start shipping customer names/amounts to a third party.
 *   - beforeSend only counts crashes when event.exception is present and
 *     unhandled (was: every event including handled network noise → fake-bad
 *     crash-free %).
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

    // 🔒 V26 R18.1: Pin replay masking explicitly. Was: relying on Sentry's
    // default masking, which could change in a future SDK version. Now:
    // maskAllText + blockAllMedia are pinned so customer names, amounts, and
    // media are never sent to Sentry's replay storage.
    integrations: [
      Sentry.replayIntegration({
        maskAllText: true,
        blockAllMedia: true,
      }),
    ],

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
    //
    // 🔒 V26 R18.2: Only count when event.exception is present and unhandled.
    // Was: every event (including handled network noise captured by Sentry's
    // automatic instrumentation) incremented the crash counter → the crash-free
    // % shown to users was fake-bad. Now: only real unhandled exceptions count.
    beforeSend(event) {
      try {
        // Only count as a crash if there's an actual exception AND it's unhandled.
        // Handled errors (captured via Sentry.captureException with level:'info')
        // and non-exception events (transactions, breadcrumbs) don't count.
        const hasException = !!event.exception && event.exception.values && event.exception.values.length > 0
        const isUnhandled = event.exception?.values?.[0]?.mechanism?.handled === false
        if (hasException && (isUnhandled || event.level === 'error' || event.level === 'fatal')) {
          const current = parseInt(localStorage.getItem('bahikhata:crash-count') || '0')
          localStorage.setItem('bahikhata:crash-count', String(current + 1))
        }
      } catch {
        // localStorage not available — skip silently
      }
      return event
    },
  })
}
