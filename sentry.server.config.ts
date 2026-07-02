import * as Sentry from '@sentry/nextjs'

/**
 * Sentry server-side configuration.
 *
 * Captures API route errors, server-side rendering errors, and edge function
 * exceptions. Runs on Vercel serverless functions.
 *
 * To enable: set SENTRY_DSN in Vercel env vars.
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
  })
}
