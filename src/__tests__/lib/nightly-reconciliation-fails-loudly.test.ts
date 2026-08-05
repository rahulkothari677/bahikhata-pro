/**
 * @jest-environment node
 *
 * A ledger that does not tie out must fail the nightly job.
 *
 * WHY (audit 2026-08-05, Phase 10). The nightly reconciliation ran every night
 * and reported success every night. Running it by hand against the live account
 * returned:
 *
 *     GST Reconciliation — FAILED
 *     CGST items ₹7,550.21 vs headers ₹7,581.21
 *     SGST items ₹7,549.76 vs headers ₹7,581.11
 *
 * The workflow printed a warning and exited 0, on the reasoning that "the job
 * itself succeeded — failures are for Sentry". That holds only while Sentry is
 * receiving them, and Sentry initialises only when SENTRY_DSN is set on the
 * deployment. This same audit already found READONLY_DATABASE_URL absent and
 * NEXTAUTH_URL set to the literal string "NEXTAUTH_URL", so a silent dependency
 * on one more env var is not something to rest a ledger check on.
 *
 * The result was the by-now familiar shape: the check ran, the answer was
 * correct, and nothing carried it to a human. Same as the audit chain nobody
 * verified and the bulk job that reported success after doing nothing.
 *
 * Sentry stays as the richer per-user signal. The exit code is the one that
 * cannot quietly stop working.
 */
import fs from 'fs'
import path from 'path'

const WORKFLOW = path.join(process.cwd(), '.github/workflows/nightly-reconciliation.yml')
const yml = fs.readFileSync(WORKFLOW, 'utf8').replace(/\r\n/g, '\n')

/** The block that decides the job's outcome from the parsed summary. */
const verdictBlock = yml.slice(yml.indexOf('TOTAL_FAILED'))

describe('the nightly job fails when the books do not tie out', () => {
  it('exits non-zero when any user failed to reconcile', () => {
    expect(verdictBlock).toMatch(/TOTAL_FAILED" != "0"[\s\S]{0,600}exit 1/)
  })

  it('no longer treats a data failure as a success', () => {
    // The exact reasoning that let a broken ledger show a green tick.
    expect(yml).not.toMatch(/Don't exit 1 here/)
  })

  it('fails when the result cannot be parsed', () => {
    // A check whose answer cannot be read is not a check. Previously a
    // parse-error fell through to the "all reconciled" branch.
    expect(verdictBlock).toMatch(/parse-error"[\s\S]{0,400}exit 1/)
  })

  it('still exits non-zero if the endpoint itself errors', () => {
    // The pre-existing guard, which must survive this change.
    expect(yml).toMatch(/HTTP_CODE" != "200"[\s\S]{0,200}exit 1/)
  })
})

describe('the job still runs on a schedule and is reachable', () => {
  it('has a cron schedule', () => {
    expect(yml).toMatch(/schedule:/)
    expect(yml).toMatch(/- cron:/)
  })

  it('calls the reconciliation endpoint', () => {
    expect(yml).toMatch(/api\/cron\/nightly-reconciliation/)
  })
})

describe('the route keeps returning 200 on a data failure', () => {
  // Deliberate and correct: the ROUTE distinguishes "the job crashed" from
  // "the job ran and found problems". The workflow is what turns the second
  // into a visible failure. Pinning this so a future change does not conflate
  // them and lose the distinction between an outage and a discrepancy.
  const route = fs.readFileSync(
    path.join(process.cwd(), 'src/app/api/cron/nightly-reconciliation/route.ts'),
    'utf8',
  )

  it('reports the failure count in the body', () => {
    expect(route).toMatch(/totalFailures/)
  })

  it('names the failing checks so the log says what broke', () => {
    expect(route).toMatch(/failures:/)
  })
})
