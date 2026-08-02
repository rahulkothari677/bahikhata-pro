import { NextRequest, NextResponse } from 'next/server'
import crypto from 'crypto'
import { db } from '@/lib/db'
import { runReconciliationChecksNightly } from '@/lib/reconciliation'
import { apiError } from '@/lib/api-error'

/**
 * GET /api/cron/nightly-reconciliation
 *
 * 🔒 V20-018: Nightly "does the ledger tie out?" job (auditor §5.6).
 *
 * The auditor's recommendation:
 *   "A one-command 'does the whole ledger tie out?' job run nightly across
 *    all shops (you have the reconciliation logic — schedule it and alert
 *    on any mismatch)."
 *
 * This endpoint:
 *   1. Iterates ALL users in the database.
 *   2. Runs the 3 reconciliation checks (party balances, GST, orphaned data)
 *      for each user.
 *   3. Collects failures.
 *   4. Captures each failure to Sentry with `module: reconciliation` tag
 *      (triggers Alert Rule 4 in docs/sentry-alerts.md).
 *   5. Returns a summary: total users checked, total failures, per-user details.
 *
 * Auth: protected by CRON_SECRET header. The caller (GitHub Actions cron or
 * Vercel Cron) must send `Authorization: Bearer <CRON_SECRET>`. This is NOT
 * a user-auth endpoint — it runs across all users, so the secret gate is
 * critical. Without it, anyone could trigger a heavy multi-user DB scan.
 *
 * Triggered by:
 *   - .github/workflows/nightly-reconciliation.yml (GitHub Actions, 2 AM IST)
 *   - Can also be triggered manually for ad-hoc checks
 *
 * Performance: O(users × checks). Each check is O(1) memory via SQL aggregates.
 * At 100 users, this is ~300 SQL queries total, completing in ~10-30s.
 * At 1000 users, ~3000 queries, ~2-5 min. Vercel serverless timeout is 60s on
 * Hobby, 300s on Pro — if we outgrow Hobby, this job needs batching.
 */

export const maxDuration = 300  // 5 min (Vercel Pro) — gives room for large user counts

export async function GET(req: NextRequest) {
  // ─── Auth: verify CRON_SECRET ─────────────────────────────────────────────
  const authHeader = req.headers.get('authorization')
  const expectedSecret = process.env.CRON_SECRET

  if (!expectedSecret) {
    // CRON_SECRET not configured — refuse to run (security: without a secret,
    // anyone could trigger this endpoint and DDoS the DB).
    return NextResponse.json(
      { error: 'CRON_SECRET not configured. Set it in Vercel env vars.' },
      { status: 503 },
    )
  }

  // 🔒 V26 M3 FIX: Use crypto.timingSafeEqual instead of !== to prevent
  // timing attacks on the cron secret.
  const expectedAuth = `Bearer ${expectedSecret}`
  const authBuf = Buffer.from(authHeader || '')
  const expectedBuf = Buffer.from(expectedAuth)
  if (authBuf.length !== expectedBuf.length || (authBuf.length > 0 && !crypto.timingSafeEqual(authBuf, expectedBuf))) {
    return NextResponse.json(
      { error: 'Unauthorized — invalid or missing CRON_SECRET' },
      { status: 401 },
    )
  }

  const startedAt = Date.now()

  try {
    // ═══════════════════════════════════════════════════════════════════════
    // 🔒 AUDIT PASS-1 N2: users are streamed in cursor-paginated batches.
    //
    // WAS: `db.user.findMany({ ... })` with no pagination, loading EVERY user
    // into this function's memory, then reconciling them one at a time in a
    // single invocation. The original docblock even predicted the wall:
    // "if we outgrow Hobby, this job needs batching."
    //
    // WHY THIS ONE MATTERS MORE THAN AN ORDINARY SLOW JOB: this is the job
    // that DETECTS LEDGER DRIFT. When it stops completing, you do not merely
    // lose a background task — you lose the mechanism that tells you the books
    // have gone wrong, and you lose it silently, because a job that never
    // reaches its own summary never reports anything. It fails exactly when
    // scale makes it most necessary.
    //
    // THREE CHANGES:
    //   1. Cursor pagination (keyset on id) — memory stays flat regardless of
    //      user count. No OFFSET, which degrades on large tables.
    //   2. Bounded concurrency inside each batch — still gentle on the
    //      connection pool (the original's stated reason for going sequential),
    //      but no longer one-at-a-time.
    //   3. A time budget. The run stops cleanly before the platform kills it,
    //      reports `completed: false` and a `resumeCursor`, and the next
    //      invocation continues from there instead of restarting from user #1
    //      and never reaching the tail of the table.
    //
    // The per-user `results` array is also gone: it accumulated one object per
    // user purely to compute two counters at the end. Counters are now
    // incremented in place, so memory does not grow with the user count.
    // ═══════════════════════════════════════════════════════════════════════
    const BATCH_SIZE = 200          // users fetched per round-trip
    const CONCURRENCY = 5           // reconciliations in flight at once
    const MAX_FAILURES_RETURNED = 500 // cap the response body, not the alerting
    // Leave headroom under maxDuration (300s) so we can finish cleanly, write
    // the summary, and flush Sentry rather than being killed mid-flight.
    const TIME_BUDGET_MS = 240_000

    // Resume support: the caller passes ?cursor=<userId> from the previous
    // run's `resumeCursor`. Absent = start from the beginning.
    //
    // Parsed defensively. `new URL(undefined)` THROWS, and an exception here
    // would be caught by the outer handler and returned as a 500 — killing the
    // entire reconciliation sweep because of an optional query parameter. For
    // the one job whose purpose is to detect ledger drift, failing closed over
    // a missing cursor is the wrong trade: no cursor simply means "start from
    // the beginning", which is the correct default.
    // (Found by v20-nightly-reconciliation.test.ts, whose request mock has no
    // `url` — a fair model of any caller that does not set one.)
    let startCursor: string | null = null
    try {
      if (req.url) startCursor = new URL(req.url).searchParams.get('cursor')
    } catch {
      startCursor = null
    }

    let cursor: string | null = startCursor
    let totalUsers = 0
    let totalPassed = 0
    let totalFailed = 0
    let completed = true
    let batches = 0

    // ─── Run reconciliation for each user ────────────────────────────────────
    const failures: Array<{
      userId: string
      userEmail: string
      checkName: string
      details: string
    }> = []

    // Reconcile ONE user. Returns nothing; updates the counters and failure
    // list. Never throws — a single user with corrupt data must not abort the
    // run for everybody else (the original guarantee, preserved).
    const reconcileUser = async (user: { id: string; email: string; name: string | null }) => {
      try {
        // 🔒 Critical #3: Nightly uses the extended function that ALSO runs
        // checkPaiseAnomalies (the 100× corruption signature check). The
        // on-demand /api/reconcile endpoint uses the basic function so the
        // raw-SQL paise check doesn't slow the one-tap UI check.
        const result = await runReconciliationChecksNightly(user.id)
        if (result.allPassed) totalPassed++
        else totalFailed++

        // Collect failures for Sentry alerting
        if (!result.allPassed) {
          for (const check of result.checks) {
            if (!check.passed) {
              failures.push({
                userId: user.id,
                userEmail: user.email,
                checkName: check.name,
                details: check.details,
              })
            }
          }
        }
      } catch (userErr) {
        // If reconciliation itself crashes for one user (e.g. DB error),
        // don't abort the whole job — record the failure and continue.
        // This is critical: one user with corrupt data shouldn't prevent
        // checking the other users.
        totalFailed++
        failures.push({
          userId: user.id,
          userEmail: user.email,
          checkName: 'reconciliation-crash',
          details: `Reconciliation threw an error: ${userErr instanceof Error ? userErr.message : String(userErr)}`,
        })
      }
    }

    // ─── Stream users in keyset-paginated batches ────────────────────────────
    for (;;) {
      const batch: Array<{ id: string; email: string; name: string | null }> =
        await db.user.findMany({
          select: { id: true, email: true, name: true },
          // Keyset on id, not OFFSET: stays O(1) as the table grows, and is
          // stable if users are created while the job is running.
          where: cursor ? { id: { gt: cursor } } : undefined,
          orderBy: { id: 'asc' },
          take: BATCH_SIZE,
        })

      if (batch.length === 0) break
      batches++

      // Bounded concurrency: CONCURRENCY reconciliations in flight at a time.
      // The original went strictly sequential to protect the connection pool;
      // this keeps that intent while removing the one-at-a-time ceiling.
      for (let i = 0; i < batch.length; i += CONCURRENCY) {
        await Promise.all(batch.slice(i, i + CONCURRENCY).map(reconcileUser))
      }

      totalUsers += batch.length
      cursor = batch[batch.length - 1].id

      // Stop cleanly before the platform kills us, so the summary is written,
      // Sentry is flushed, and the next run resumes instead of restarting.
      if (Date.now() - startedAt > TIME_BUDGET_MS) {
        completed = false
        break
      }

      if (batch.length < BATCH_SIZE) break
    }

    if (totalUsers === 0) {
      return NextResponse.json({
        ok: true,
        message: startCursor
          ? 'No users after the supplied cursor — nothing left to reconcile.'
          : 'No users found — nothing to reconcile.',
        totalUsers: 0,
        totalFailures: 0,
        completed: true,
        durationMs: Date.now() - startedAt,
        runAt: new Date().toISOString(),
      })
    }

    // ─── Capture failures to Sentry ──────────────────────────────────────────
    // Each failure becomes a separate Sentry event so alert rules can fire
    // per-check, per-user. We use the `module: reconciliation` tag (matching
    // Alert Rule 4 in docs/sentry-alerts.md).
    if (failures.length > 0) {
      try {
        const Sentry = await import('@sentry/nextjs')
        for (const failure of failures) {
          Sentry.withScope((scope) => {
            scope.setTag('module', 'reconciliation')
            scope.setTag('reconciliation_check', failure.checkName)
            scope.setTag('reconciliation_user', failure.userId)
            scope.setContext('reconciliation_failure', {
              userId: failure.userId,
              userEmail: failure.userEmail,
              checkName: failure.checkName,
              details: failure.details,
              runAt: new Date().toISOString(),
            })
            // Capture as a message (not exception) — this is a data integrity
            // issue, not a code crash. Message level = error so it triggers alerts.
            Sentry.captureMessage(
              `Reconciliation FAILED for ${failure.userEmail}: ${failure.checkName}`,
              'error',
            )
          })
        }
      } catch {
        // Sentry not available — the failures are still in the response + logs
      }
    }

    const durationMs = Date.now() - startedAt

    // ─── Return summary ──────────────────────────────────────────────────────
    // Always return 200 (even if there are failures) — the cron job itself
    // succeeded. Failures are captured to Sentry for alerting. Returning 500
    // would make the cron job look broken in GitHub Actions, masking the real
    // signal (data integrity issues, not job execution failures).
    return NextResponse.json({
      ok: true,
      runAt: new Date().toISOString(),
      durationMs,
      totalUsers,
      totalPassed,
      totalFailed,
      totalFailures: failures.length,
      // 🔒 N2: when false, the time budget was hit before the table ended.
      // The caller MUST re-invoke with ?cursor=<resumeCursor> to finish the
      // sweep. A monitor that only checks `ok` would miss a run that has
      // silently stopped covering the tail of the user table — which is the
      // exact failure this fix exists to prevent, so it is surfaced explicitly.
      completed,
      resumeCursor: completed ? null : cursor,
      batches,
      // The response body is capped; Sentry still receives every failure above.
      failuresTruncated: failures.length > MAX_FAILURES_RETURNED,
      failures: failures.slice(0, MAX_FAILURES_RETURNED).map(f => ({
        userId: f.userId,
        userEmail: f.userEmail,
        checkName: f.checkName,
        details: f.details,
      })),
    })
  } catch (err) {
    // This catch is for catastrophic failures (DB unreachable, etc.) —
    // not for per-user reconciliation failures (those are handled above).
    return apiError(err, 'Nightly reconciliation job crashed', 500, {
      durationMs: Date.now() - startedAt,
    })
  }
}
