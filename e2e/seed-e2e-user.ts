/**
 * Creates the one account the E2E tests log in as.
 *
 * WHY THIS EXISTS (#22, audit 2026-08-13). The E2E fixture said, in its own
 * comment: "these should match a user in the dev database. For CI, we'd create
 * this user in a global setup script." That script was never written.
 *
 * So the tests could never log in. All 8 of them failed at exactly the same
 * point — setting up `loggedInPage` — and nobody found out, because the job was
 * gated to pull requests and everything here is pushed straight to main. The
 * suite looked like coverage for months and guarded nothing.
 *
 * CI also pointed DATABASE_URL at `file:./e2e-test.db` — a SQLite path against
 * a Postgres schema — so even a seeded user would have had nowhere to live.
 * The workflow now runs a real Postgres service and applies the real
 * migrations, which is the only way an end-to-end test is worth running: a
 * fake database tests the fake database.
 *
 * Idempotent, so a re-run or a retry does not fail on a duplicate.
 */
import { PrismaClient } from '@prisma/client'
import bcrypt from 'bcryptjs'

/** Must match e2e/fixtures.ts. Both read these, so they cannot drift. */
export const E2E_EMAIL = 'test@bahikhata.dev'
export const E2E_PASSWORD = 'test1234'

/**
 * Playwright's globalSetup — see playwright.config.ts.
 *
 * Deliberately NOT a separate CI step. As a step it could be reordered,
 * skipped, or simply forgotten in a second workflow, and the failure it causes
 * looks like a broken app rather than a missing seed. As globalSetup it runs
 * before every test run, locally and in CI, or the run does not start.
 */
export default async function globalSetup() {
  const db = new PrismaClient()
  try {
    const password = await bcrypt.hash(E2E_PASSWORD, 10)

    const user = await db.user.upsert({
      where: { email: E2E_EMAIL },
      update: { password },
      create: { email: E2E_EMAIL, password, name: 'E2E Test Shop' },
    })

    /*
     * Settings are created alongside the user by the real signup route, and
     * several screens read them. Seeding a user without them would exercise a
     * state the app never actually produces, and the tests would fail on
     * something that is not a bug.
     */
    await db.setting.upsert({
      where: { userId: user.id },
      update: {},
      create: {
        userId: user.id,
        shopName: 'E2E Test Shop',
        ownerName: 'E2E Test Shop',
      },
    })

    console.log(`[e2e-seed] ready: ${E2E_EMAIL} (user ${user.id})`)
  } catch (err) {
    /*
     * Rethrow. Playwright aborts the whole run when globalSetup throws, which
     * is what we want: a seed that quietly does nothing gives us back exactly
     * the problem this file was written to fix — tests that fail later, in a
     * confusing place, for a reason nobody connects to the database.
     */
    console.error('[e2e-seed] FAILED — the tests cannot log in without this.', err)
    throw err
  } finally {
    await db.$disconnect()
  }
}
