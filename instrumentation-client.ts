/**
 * Next.js CLIENT instrumentation hook.
 *
 * 🐛 WHY THIS FILE EXISTS (audit 2026-07-28):
 * Next 15.3+ (this project is on 16.1.1) no longer picks up
 * `sentry.client.config.ts` automatically. Browser-side Sentry init must happen
 * here, or it NEVER RUNS.
 *
 * Before this file, `sentry.client.config.ts` was imported nowhere in the app —
 * only by src/__tests__/lib/v26-phase5-polish-ci.test.ts, which reads it AS
 * TEXT and asserts its contents. So the test passed, the config looked correct
 * in review, and no browser error was ever captured. Server errors worked
 * (instrumentation.ts imports sentry.server.config), which made the gap harder
 * to notice: Sentry had data in it, just never from a browser.
 *
 * That is the same "tests validating code that does not ship" pattern that
 * previously let 31 behavioural tests validate helper files nothing imported.
 *
 * This file sits at the project ROOT to match instrumentation.ts, so the
 * import path is './'.
 */
import './sentry.client.config'

/**
 * Router transition instrumentation. Next looks for this export by name;
 * it is a no-op when Sentry has no DSN configured.
 */
export { captureRouterTransitionStart as onRouterTransitionStart } from '@sentry/nextjs'
