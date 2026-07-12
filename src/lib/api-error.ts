import { NextResponse } from 'next/server'
import { randomBytes } from 'crypto'

/**
 * 🔒 V10 §3.3: Shared error-response helper.
 *
 * WHY: The V9 dashboard route was fixed to use generic messages + errorId,
 * but 8 other routes still echoed `String(error)` or `error.message` to the
 * client — leaking internal details (file paths, SQL fragments, stack traces
 * in some Node error subclasses) that help attackers fingerprint the stack.
 *
 * This helper:
 *   1. Logs the real error server-side with a short errorId for log lookup.
 *   2. Returns a generic message + the errorId to the client.
 *   3. 🔒 V20-017: Captures the error to Sentry with context (route, errorId,
 *      message, status). This is the single chokepoint — fixing it here means
 *      ALL ~22 API routes that use apiError() automatically report 500s to
 *      Sentry. The GST filing routes get additional tagging via
 *      captureGstFilingError() in src/lib/sentry-gst.ts.
 *
 * Usage:
 *   } catch (error) {
 *     return apiError(error, 'Failed to load transactions', 500)
 *   }
 *
 * The client can show `errorId` to the user, who can quote it to support
 * for log lookup — without ever seeing the raw error string.
 */

// 🔒 V20-017: Fire-and-forget Sentry capture. We intentionally do NOT await
// this — Sentry's SDK buffers events internally and flushes them asynchronously.
// Awaiting would add latency to every 500 response (bad UX) for no benefit
// (the error is already logged to console synchronously).
//
// The dynamic import is cached after the first call (Node module cache), so
// there's no per-request import overhead. If @sentry/nextjs is not installed
// or SENTRY_DSN is not set, the import succeeds but captureException is a
// no-op — the try/catch makes this resilient.
function captureInSentry(
  error: unknown,
  errorId: string,
  message: string,
  status: number,
  context?: Record<string, unknown>,
) {
  // Don't await — fire and forget
  import('@sentry/nextjs')
    .then((Sentry) => {
      Sentry.withScope((scope) => {
        scope.setTag('error_id', errorId)
        scope.setTag('http_status', status)
        scope.setTag('source', 'apiError')
        scope.setContext('api_error', {
          message,
          errorId,
          status,
          ...context,
        })
        Sentry.captureException(error)
      })
    })
    .catch(() => {
      // @sentry/nextjs not installed — silently skip
    })
}

export function apiError(
  error: unknown,
  message: string,
  status: number = 500,
  context?: Record<string, unknown>,
): NextResponse {
  // Short 8-char errorId — easy to read aloud / paste in a support email
  const errorId = randomBytes(4).toString('hex')

  // Server-side log with the full error + errorId + optional context.
  // Never sent to the client.
  console.error(`[apiError ${errorId}]`, message, error, context ?? '')

  // 🔒 V20-017: Capture to Sentry for alerting. Only capture 5xx errors —
  // 4xx errors are client mistakes (bad input, not found) and would spam
  // Sentry with non-actionable noise.
  if (status >= 500) {
    captureInSentry(error, errorId, message, status, context)
  }

  return NextResponse.json(
    {
      error: message,
      errorId,
    },
    { status },
  )
}


