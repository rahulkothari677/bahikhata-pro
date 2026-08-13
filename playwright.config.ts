import { defineConfig, devices } from '@playwright/test'

/**
 * Playwright E2E test configuration for BahiKhata Pro.
 *
 * Tests run against a local dev server (started automatically by Playwright).
 * For CI, we only run Chromium to keep it fast. For local dev, you can run
 * all 3 browsers with: npx playwright test --project=mobile-chrome
 *
 * Run tests:     npx playwright test
 * Run with UI:   npx playwright test --ui
 * View report:   npx playwright show-report
 */
export default defineConfig({
  testDir: './e2e',
  /*
   * 🔒 2026-08-13 (#22): creates the account the tests log in as.
   *
   * Every E2E test used to fail at the same point — setting up `loggedInPage` —
   * because no such user existed. fixtures.ts said so itself: "For CI, we'd
   * create this user in a global setup script." This is that script, and it is
   * globalSetup rather than a CI step so it cannot be reordered, skipped, or
   * forgotten in another workflow. If it fails, the run does not start.
   */
  globalSetup: './e2e/seed-e2e-user.ts',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: 'html',
  use: {
    baseURL: 'http://localhost:3000',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'mobile-chrome',
      use: { ...devices['Pixel 5'] },
      // Only run mobile tests on PRs (skip on main pushes for speed)
      testMatch: /mobile.*\.spec\.ts/,
    },
  ],
  webServer: {
    command: 'npm run dev',
    url: 'http://localhost:3000',
    reuseExistingServer: !process.env.CI,
    timeout: 120 * 1000,
  },
})
