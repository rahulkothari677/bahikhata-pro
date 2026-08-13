import { test, expect } from './fixtures'
import { E2E_CUSTOMER } from './seed-e2e-user'

/**
 * The screens a shopkeeper reaches for when someone asks for paperwork.
 *
 * WHY THIS WAS REWRITTEN (#22 + #19, audit 2026-08-13). The previous version
 * asserted `expect(loggedInPage.url()).toContain('bahikhata')` — true of every
 * page on the site, including the login screen — and wrapped each step in
 * `if (await thing.isVisible())`, so a missing control was skipped rather than
 * reported. Two of its three tests could pass without opening anything.
 *
 * These assert that the screen actually opened and shows its own content. They
 * are deliberately modest: opening a real PDF and reading it is a different and
 * much heavier job, and a modest test that genuinely fails beats an ambitious
 * one that cannot.
 */
test.describe('Paperwork screens open and show real content', () => {
  test('the parties screen lists the shop\'s customers', async ({ loggedInPage }) => {
    const page = loggedInPage
    await page.getByRole('button', { name: 'Parties' }).first().click()

    // The seeded customer must be there. Asserting a NAMED row, not just that
    // some list rendered — an empty list would satisfy the weaker check.
    await expect(page.getByText(E2E_CUSTOMER.name).first()).toBeVisible({ timeout: 20_000 })
  })

  test('the reports screen offers the reports it promises', async ({ loggedInPage }) => {
    const page = loggedInPage
    await page.getByRole('button', { name: 'Reports' }).first().click()

    // Named reports, so a blank screen cannot pass. These are the headline
    // promises on this screen.
    await expect(page.getByText(/P&L Statement/i).first()).toBeVisible({ timeout: 20_000 })
    await expect(page.getByText(/Bank Reconciliation/i).first()).toBeVisible({ timeout: 20_000 })
  })

  test('a report opens when chosen', async ({ loggedInPage }) => {
    const page = loggedInPage
    await page.getByRole('button', { name: 'Reports' }).first().click()
    await page.getByText(/Bank Reconciliation/i).first().click()

    // Its own screen, not the hub it was opened from.
    await expect(page.getByText(/Import Bank Statement/i).first()).toBeVisible({ timeout: 20_000 })
  })
})
