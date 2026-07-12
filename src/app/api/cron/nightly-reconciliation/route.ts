import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { runReconciliationChecks } from '@/lib/reconciliation'
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

  if (authHeader !== `Bearer ${expectedSecret}`) {
    return NextResponse.json(
      { error: 'Unauthorized — invalid or missing CRON_SECRET' },
      { status: 401 },
    )
  }

  const startedAt = Date.now()

  try {
    // ─── Fetch all users ─────────────────────────────────────────────────────
    // We only need the id + email (for Sentry context). No passwords, no PII.
    const users = await db.user.findMany({
      select: {
        id: true,
        email: true,
        name: true,
      },
      orderBy: { createdAt: 'asc' },
    })

    if (users.length === 0) {
      return NextResponse.json({
        ok: true,
        message: 'No users found — nothing to reconcile.',
        totalUsers: 0,
        totalFailures: 0,
        durationMs: Date.now() - startedAt,
        runAt: new Date().toISOString(),
      })
    }

    // ─── Run reconciliation for each user ────────────────────────────────────
    // Sequential (not parallel) to avoid overwhelming the DB connection pool.
    // At ~100ms per user, 100 users = 10s. Acceptable for a nightly job.
    const results: Array<{
      userId: string
      userEmail: string
      userName: string | null
      allPassed: boolean
      checks: Array<{ name: string; passed: boolean; details: string }>
    }> = []

    const failures: Array<{
      userId: string
      userEmail: string
      checkName: string
      details: string
    }> = []

    for (const user of users) {
      try {
        const result = await runReconciliationChecks(user.id)
        results.push({
          userId: user.id,
          userEmail: user.email,
          userName: user.name,
          allPassed: result.allPassed,
          checks: result.checks.map(c => ({
            name: c.name,
            passed: c.passed,
            details: c.details,
          })),
        })

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
        failures.push({
          userId: user.id,
          userEmail: user.email,
          checkName: 'reconciliation-crash',
          details: `Reconciliation threw an error: ${userErr instanceof Error ? userErr.message : String(userErr)}`,
        })
        results.push({
          userId: user.id,
          userEmail: user.email,
          userName: user.name,
          allPassed: false,
          checks: [{
            name: 'reconciliation-crash',
            passed: false,
            details: String(userErr),
          }],
        })
      }
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
    const totalPassed = results.filter(r => r.allPassed).length
    const totalFailed = results.length - totalPassed

    // ─── Return summary ──────────────────────────────────────────────────────
    // Always return 200 (even if there are failures) — the cron job itself
    // succeeded. Failures are captured to Sentry for alerting. Returning 500
    // would make the cron job look broken in GitHub Actions, masking the real
    // signal (data integrity issues, not job execution failures).
    return NextResponse.json({
      ok: true,
      runAt: new Date().toISOString(),
      durationMs,
      totalUsers: results.length,
      totalPassed,
      totalFailed,
      totalFailures: failures.length,
      failures: failures.map(f => ({
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
