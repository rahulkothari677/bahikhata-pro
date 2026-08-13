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
import { chromium, type FullConfig } from '@playwright/test'
import fs from 'fs'
import path from 'path'

/** Where the signed-in cookies are parked for every test to reuse. */
export const STORAGE_STATE = path.join(__dirname, '.auth', 'state.json')

/** Must match e2e/fixtures.ts. Both read these, so they cannot drift. */
export const E2E_EMAIL = 'test@bahikhata.dev'
export const E2E_PASSWORD = 'test1234'

/**
 * The CI database is empty apart from what this file creates, so the critical
 * flow — record a sale — has nothing to sell until we put something in it.
 *
 * Deliberately round numbers at 0% GST. The point of the E2E test is that the
 * SALE reaches the ledger with the right total; proving GST arithmetic is the
 * unit tests' job, and a tax fraction here would only make a failure ambiguous.
 * 2 × ₹150 must appear as ₹300, and nothing else can explain it.
 */
export const E2E_PRODUCT = { name: 'E2E Test Widget', price: 150, gstRate: 0 }
export const E2E_CUSTOMER = { name: 'E2E Test Customer' }

/**
 * Playwright's globalSetup — see playwright.config.ts.
 *
 * Deliberately NOT a separate CI step. As a step it could be reordered,
 * skipped, or simply forgotten in a second workflow, and the failure it causes
 * looks like a broken app rather than a missing seed. As globalSetup it runs
 * before every test run, locally and in CI, or the run does not start.
 */
export default async function globalSetup(config: FullConfig) {
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

    /*
     * Something to sell, and someone to sell it to. Both are matched on name
     * within this user, so a re-run updates rather than duplicating — a second
     * "E2E Test Widget" would make the product picker ambiguous and the test
     * would fail for a reason that is not a bug.
     */
    const existingProduct = await db.product.findFirst({
      where: { userId: user.id, name: E2E_PRODUCT.name },
      select: { id: true },
    })
    if (existingProduct) {
      await db.product.update({
        where: { id: existingProduct.id },
        data: { salePrice: E2E_PRODUCT.price, gstRate: E2E_PRODUCT.gstRate, currentStock: 1000 },
      })
    } else {
      await db.product.create({
        data: {
          userId: user.id,
          name: E2E_PRODUCT.name,
          salePrice: E2E_PRODUCT.price,
          gstRate: E2E_PRODUCT.gstRate,
          // Plenty, so the sale is never blocked by an out-of-stock guard.
          openingStock: 1000,
          currentStock: 1000,
        },
      })
    }

    const existingParty = await db.party.findFirst({
      where: { userId: user.id, name: E2E_CUSTOMER.name },
      select: { id: true },
    })
    if (!existingParty) {
      await db.party.create({
        data: { userId: user.id, name: E2E_CUSTOMER.name, type: 'customer' },
      })
    }

    console.log(
      `[e2e-seed] ready: ${E2E_EMAIL} (user ${user.id}) ` +
        `+ product "${E2E_PRODUCT.name}" + customer "${E2E_CUSTOMER.name}"`,
    )

    /*
     * 🔒 2026-08-13: log in ONCE here and save the cookies, instead of logging
     * in inside every test.
     *
     * The first CI run of this suite proved why that matters. 8 tests, each
     * retried twice, meant about 22 logins for one account in ten minutes —
     * and login is rate limited, 10 per minute per address and (since #17) 10
     * per fifteen minutes per account. So the early tests signed in fine and
     * everything after was refused. The evidence was a passing test whose trace
     * shows a fully loaded dashboard, alongside later tests stuck on the login
     * form with the right credentials typed in.
     *
     * That is the rate limiter doing exactly its job. The suite was wrong to
     * log in 22 times: a shopkeeper signs in once and works for hours. One
     * login, reused, is both faster and closer to how the app is really used.
     */
    const baseURL = config.projects[0]?.use?.baseURL ?? 'http://localhost:3000'
    const browser = await chromium.launch()
    try {
      const page = await browser.newPage({ baseURL })
      await page.goto('/')
      await page.locator('input[type="email"], input[name="email"]').first().fill(E2E_EMAIL)
      await page.locator('input[type="password"]').first().fill(E2E_PASSWORD)
      await page.locator('button[type="submit"]').first().click()

      // Wait for something the app really renders once signed in. There is no
      // /dashboard URL to wait for — this is one page at / that swaps views.
      await page
        .getByRole('button', { name: 'Dashboard' })
        .first()
        .waitFor({ state: 'visible', timeout: 60_000 })

      fs.mkdirSync(path.dirname(STORAGE_STATE), { recursive: true })
      await page.context().storageState({ path: STORAGE_STATE })
      console.log(`[e2e-seed] signed in once; session saved to ${STORAGE_STATE}`)
    } finally {
      await browser.close()
    }
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
