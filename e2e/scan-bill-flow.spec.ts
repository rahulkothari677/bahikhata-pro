import { test, expect } from './fixtures'

/**
 * The bill scanner opens and can accept a photo.
 *
 * WHY THIS WAS REWRITTEN (#22 + #19, audit 2026-08-13). The previous version
 * ended in `expect(loggedInPage.url()).toContain('bahikhata')` — true of every
 * page on the site — and reached the scanner via
 * `locator('text=AI Bill Scanner, text=Scan Bill')`, which is not valid
 * Playwright syntax for "either of these": it looks for one selector with a
 * comma in it. So the click was caught by `.catch()` and the test carried on
 * regardless.
 *
 * Nothing here uploads a real bill. Scanning sends the photo to an AI provider,
 * which costs money and would make CI depend on a third party being up — a test
 * that fails when Google has a bad morning teaches everyone to ignore it. What
 * IS checked is everything up to that line: the screen opens, and the control
 * that takes a photo is present and configured for images.
 */
test.describe('Bill scanner', () => {
  test('the scanner screen opens from the dashboard', async ({ loggedInPage }) => {
    const page = loggedInPage
    await page.getByRole('button', { name: 'Scan a Bill' }).first().click()

    // Its own screen. Waiting on a real control rather than a URL, because this
    // app swaps views inside one page and never changes URL.
    await expect(
      page.getByText(/Take Photo|Upload|Choose (a )?(file|photo)/i).first(),
    ).toBeVisible({ timeout: 25_000 })
  })

  test('the upload control accepts images', async ({ loggedInPage }) => {
    const page = loggedInPage
    await page.getByRole('button', { name: 'Scan a Bill' }).first().click()

    const fileInput = page.locator('input[type="file"]').first()
    // attached, not visible: these inputs are deliberately hidden behind a
    // styled button, which is why the old visibility check skipped the assert.
    await expect(fileInput).toBeAttached({ timeout: 25_000 })
    await expect(fileInput).toHaveAttribute('accept', /image/)
  })
})
