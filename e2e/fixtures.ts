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
    /*
     * No login happens here any more. globalSetup signs in once and saves the
     * cookies; playwright.config.ts hands them to every test via storageState.
     *
     * The first real CI run showed why. 8 tests retried twice meant ~22 logins
     * for one account in ten minutes, and login is rate limited — 10/min per
     * address, and since #17, 10 per 15 minutes per account. Early tests signed
     * in, everything after was refused. That was the limiter working correctly;
     * the suite was wrong to log in 22 times. A shopkeeper signs in once and
     * works for hours.
     */
    await page.goto('/')

    /*
     * The signed-in signal: the bottom navigation only renders once there is a
     * session. Waiting on a DOM element the app really produces, rather than on
     * a URL it never navigates to.
     */
    const signedIn = page.getByRole('button', { name: 'Dashboard' }).first()
    await signedIn.waitFor({ state: 'visible', timeout: 45_000 }).catch(() => {
      throw new Error(
        `E2E session not usable for ${E2E_EMAIL}. The saved storageState did not ` +
          `produce a signed-in page. Check that globalSetup logged in successfully ` +
          `(see e2e/seed-e2e-user.ts) and that its cookies were written.`,
      )
    })

    // Let the dashboard's first data load settle so tests do not race it.
    await page.waitForLoadState('networkidle').catch(() => {})

    await use(page)
  },
})

export { expect }
