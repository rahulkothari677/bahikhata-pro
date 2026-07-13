/**
 * 🔒 V20-017: GST filing-specific Sentry error capture.
 *
 * The auditor's §5.5 recommendation:
 *   "Sentry is wired — set up alerts on 500s (especially the GST filing
 *    routes) so a §1.1-class bug surfaces from telemetry within minutes
 *    of beta, not from an angry CA."
 *
 * This helper adds GST-specific tags to Sentry events so you can create
 * alert rules like:
 *   - "Alert me when module = 'gst-filing' AND action = 'file'"
 *   - "Alert me when route = '/api/gstr-3b' AND status >= 500"
 *   - "Page the on-call when gst_filing_failure count > 0 in 1 hour"
 *
 * Usage in GST routes:
 *   } catch (err) {
 *     captureGstFilingError(err, {
 *       route: '/api/gstr-3b',
 *       action: 'file',           // 'compute' | 'save' | 'file'
 *       monthYear: '072026',
 *       userId,
 *     })
 *     return apiError(err, 'Failed to file GSTR-3B', 500)
 *   }
 *
 * The captureGstFilingError call is fire-and-forget — it doesn't block the
 * error response. The apiError() call handles the client response + a generic
 * Sentry capture; this helper adds the GST-specific tags on TOP of that.
 *
 * Why both? apiError() captures every 500 across the app (good for general
 * alerting). This helper adds GST-specific context (good for targeted alerts
 * like "GST filing is broken — page someone now"). The Sentry event will
 * have BOTH sets of tags (the withScope here is separate from apiError's
 * withScope — they produce two events, which is fine: one for the general
 * 500 alert, one for the GST-filing-specific alert).
 *
 * Actually — to avoid double-capturing, if you call captureGstFilingError
 * BEFORE apiError(), the GST tags get set on the current scope and apiError's
 * withScope will inherit them. So the single event has both the GST tags AND
 * the apiError context. That's the recommended pattern.
 */

export interface GstFilingErrorContext {
  /** The API route path, e.g. '/api/gstr-3b' */
  route: '/api/gstr-3b' | '/api/gstr-1' | '/api/gstr-export' | '/api/gstr-2b/import' | '/api/gstr-2b/reconcile' | '/api/e-invoice/irn'
  /** What the user was trying to do */
  action: 'compute' | 'save' | 'file' | 'export' | 'import' | 'reconcile' | 'generate' | 'cancel' | 'store'
  /** The filing period (MMYYYY), if applicable */
  monthYear?: string
  /** The user ID (for correlating with user reports) */
  userId?: string
  /** Additional context (e.g. transactionId, gstin, etc.) */
  metadata?: Record<string, unknown>
}

/**
 * Capture a GST filing error with GST-specific Sentry tags.
 *
 * Call this BEFORE apiError() in GST route catch blocks. The tags are set
 * on the current scope, so apiError's withScope will inherit them —
 * producing a SINGLE Sentry event with both GST tags AND apiError context.
 *
 * Example:
 *   } catch (err) {
 *     captureGstFilingError(err, {
 *       route: '/api/gstr-3b',
 *       action: 'file',
 *       monthYear,
 *       userId,
 *     })
 *     return apiError(err, 'Failed to file GSTR-3B', 500)
 *   }
 */
export function captureGstFilingError(error: unknown, ctx: GstFilingErrorContext): void {
  // Fire-and-forget — same pattern as apiError's captureInSentry
  import('@sentry/nextjs')
    .then((Sentry) => {
      // Set tags on the CURRENT scope (not a withScope) so they persist
      // and apiError's withScope inherits them.
      Sentry.setTag('module', 'gst-filing')
      Sentry.setTag('gst_route', ctx.route)
      Sentry.setTag('gst_action', ctx.action)
      if (ctx.monthYear) {
        Sentry.setTag('gst_month_year', ctx.monthYear)
      }
      Sentry.setContext('gst_filing', {
        route: ctx.route,
        action: ctx.action,
        monthYear: ctx.monthYear,
        userId: ctx.userId,
        ...ctx.metadata,
      })
      // Don't captureException here — apiError() will do that.
      // We just set the tags/context so the apiError capture includes them.
    })
    .catch(() => {
      // @sentry/nextjs not installed — silently skip
    })
}
