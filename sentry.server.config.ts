import * as Sentry from '@sentry/nextjs'

/**
 * Sentry server-side configuration.
 *
 * Captures API route errors, server-side rendering errors, and edge function
 * exceptions. Runs on Vercel serverless functions.
 *
 * To enable: set SENTRY_DSN in Vercel env vars.
 *
 * 🔒 V26 R18.3 (Phase 5): Server beforeSend scrub — deletes event.extra and
 * breadcrumb payloads matching /amount|phone|gstin/i keys. Prisma validation
 * errors embed field values (names, amounts) into error metadata; without the
 * scrub, these would be visible in Sentry's Vercel logs.
 */

const SENTRY_DSN = process.env.SENTRY_DSN

if (SENTRY_DSN) {
  Sentry.init({
    dsn: SENTRY_DSN,

    // Lower sample rate on server — API routes are high-volume
    tracesSampleRate: 0.05,  // 5% of server transactions

    environment: process.env.NODE_ENV || 'development',
    release: process.env.NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA || 'local',

    // Filter out common server-side noise
    ignoreErrors: [
      'rate limit exceeded',  // our own rate limiter handles this
      'quota_exceeded',  // subscription quota — handled by paywall
    ],

    // 🔒 V26 R18.3: Scrub sensitive keys from event.extra + breadcrumbs.
    // Prisma validation errors embed field values (amount, phone, gstin) into
    // error metadata. This beforeSend deletes any extra/breadcrumb payload
    // whose key matches the sensitive pattern, so customer data doesn't land
    // in Sentry's storage.
    beforeSend(event) {
      const SENSITIVE_KEY_RE = /amount|phone|gstin|email|password|token|secret|upi/i

      // Scrub event.extra
      if (event.extra) {
        for (const key of Object.keys(event.extra)) {
          if (SENSITIVE_KEY_RE.test(key)) {
            delete event.extra[key]
          }
        }
      }

      // Scrub breadcrumbs
      if (event.breadcrumbs) {
        for (const crumb of event.breadcrumbs) {
          if (crumb.data) {
            for (const key of Object.keys(crumb.data)) {
              if (SENSITIVE_KEY_RE.test(key)) {
                delete crumb.data[key]
              }
            }
          }
        }
      }

      return event
    },
  })
}
