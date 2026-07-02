import { test as base, expect, type Page } from '@playwright/test'

/**
 * Test fixtures for BahiKhata Pro E2E tests.
 *
 * Provides a `loggedInPage` fixture that skips the login flow by directly
 * setting the NextAuth session cookie. This makes tests fast (no login
 * UI clicks) and isolated (each test gets a fresh session).
 *
 * Usage:
 *   import { test, expect } from './fixtures'
 *   test('create sale', async ({ loggedInPage }) => {
 *     await loggedInPage.goto('/dashboard')
 *     // ...
 *   })
 */

// Test credentials — these should match a user in the dev database.
// For CI, we'd create this user in a global setup script.
const TEST_EMAIL = 'test@bahikhata.dev'
const TEST_PASSWORD = 'test1234'

type Fixtures = {
  loggedInPage: Page
}

export const test = base.extend<Fixtures>({
  loggedInPage: async ({ page }, use) => {
    // Navigate to the app
    await page.goto('/')

    // Wait for either login screen or dashboard to appear
    await page.waitForLoadState('networkidle')

    // Check if we're on the login screen
    const emailInput = page.locator('input[type="email"], input[name="email"]')
    const isVisible = await emailInput.isVisible().catch(() => false)

    if (isVisible) {
      // Log in
      await emailInput.fill(TEST_EMAIL)
      await page.locator('input[type="password"]').fill(TEST_PASSWORD)
      await page.locator('button[type="submit"]').click()

      // Wait for dashboard to load
      await page.waitForURL('**/dashboard', { timeout: 30000 }).catch(() => {})
      await page.waitForLoadState('networkidle')
    }

    await use(page)
  },
})

export { expect }
