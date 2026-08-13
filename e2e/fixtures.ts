import { test as base, expect, type Page } from '@playwright/test'
import { E2E_EMAIL, E2E_PASSWORD } from './seed-e2e-user'

/**
 * Test fixtures for BahiKhata Pro E2E tests.
 *
 * Provides a `loggedInPage` fixture: a page that is signed in as the seeded
 * E2E account (see e2e/seed-e2e-user.ts).
 *
 * WHY THIS WAS REWRITTEN (#22, audit 2026-08-13). All 8 E2E tests failed here,
 * every time, and had done since they were written — the job only ran on pull
 * requests and everything here is pushed straight to main, so nobody saw it.
 *
 * Three faults, and all three had to go:
 *
 *  1. NO SEEDED USER. The old comment said "For CI, we'd create this user in a
 *     global setup script" — that script did not exist. There was nothing to
 *     log in as.
 *
 *  2. IT WAITED FOR A URL THAT DOES NOT EXIST. `waitForURL('**\/dashboard')`
 *     never matches: this app is a single page at `/` that swaps views in the
 *     client, which is why authOptions sets `pages.signIn = '/'`. There is no
 *     /dashboard route to arrive at.
 *
 *  3. IT SWALLOWED ITS OWN FAILURE. That wait ended in `.catch(() => {})`, and
 *     the whole login was inside `if (emailInput is visible)`. So a login that
 *     never happened produced no error here — it produced a confusing failure
 *     later, in whichever test first tried to use the page. A fixture that
 *     hides a failed login sends you hunting in the wrong file.
 *
 * Now it waits for something the app actually renders, and fails HERE with a
 * clear message if the login did not work.
 */

type Fixtures = {
  loggedInPage: Page
}

export const test = base.extend<Fixtures>({
  loggedInPage: async ({ page }, use) => {
    await page.goto('/')

    const emailInput = page.locator('input[type="email"], input[name="email"]').first()

    // Already signed in from a reused browser context? Nothing to do.
    const needsLogin = await emailInput
      .waitFor({ state: 'visible', timeout: 15_000 })
      .then(() => true)
      .catch(() => false)

    if (needsLogin) {
      await emailInput.fill(E2E_EMAIL)
      await page.locator('input[type="password"]').first().fill(E2E_PASSWORD)
      await page.locator('button[type="submit"]').first().click()
    }

    /*
     * The signed-in signal: the bottom navigation only renders once there is a
     * session. Waiting on a DOM element the app really produces, rather than on
     * a URL it never navigates to.
     */
    const signedIn = page.getByRole('button', { name: 'Dashboard' }).first()
    await signedIn.waitFor({ state: 'visible', timeout: 45_000 }).catch(() => {
      throw new Error(
        `E2E login failed for ${E2E_EMAIL}. The app did not reach a signed-in ` +
          `state. Check that e2e/seed-e2e-user.ts ran against the same database ` +
          `the dev server is using, and that migrations were applied.`,
      )
    })

    // Let the dashboard's first data load settle so tests do not race it.
    await page.waitForLoadState('networkidle').catch(() => {})

    await use(page)
  },
})

export { expect }
