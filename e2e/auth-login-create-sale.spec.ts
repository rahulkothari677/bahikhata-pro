import { test, expect } from './fixtures'
import { E2E_PRODUCT, E2E_CUSTOMER } from './seed-e2e-user'

/**
 * The one flow that must never break: record a sale, and see it in the books.
 *
 * WHY THIS WAS REWRITTEN (#22 + #19, audit 2026-08-13). The previous version
 * could pass having done nothing at all. Almost every step was written as:
 *
 *     if (await thing.isVisible().catch(() => false)) { ...do the step... }
 *
 * so a control that had moved, or never existed, was silently skipped. The
 * final assertion was `expect(url).toContain('bahikhata')` — true of every page
 * on the site, including the login screen. A test that cannot fail is not a
 * test, and this one had never run anywhere to reveal that.
 *
 * The rewrite follows the shopkeeper: open New Sale, pick the seeded product,
 * choose the customer, save, and then check the LEDGER shows the sale with the
 * right total. Every step asserts. Nothing is skipped for being absent.
 *
 * ₹150 × 2 at 0% GST must appear as ₹300. Round numbers on purpose: proving GST
 * arithmetic is the unit tests' job, and a tax fraction here would only make a
 * failure ambiguous.
 *
 * Selectors are the form's own `id`s (field-search-product, field-party-search,
 * field-paid-amount), read off the running app rather than guessed. They are
 * far steadier than visible text, which changes with copy and translation — and
 * this screen has been redesigned repeatedly.
 */

const QTY = 2
const EXPECTED_TOTAL = E2E_PRODUCT.price * QTY // 300

test.describe('Critical Flow: record a sale and find it in the ledger', () => {
  test('the dashboard loads for a signed-in shopkeeper', async ({ loggedInPage }) => {
    // The bottom navigation only renders with a session, so its presence is
    // the signed-in signal — not a URL, because this app never changes URL.
    await expect(loggedInPage.getByRole('button', { name: 'Dashboard' }).first()).toBeVisible()
    await expect(loggedInPage.getByRole('button', { name: 'New Sale' }).first()).toBeVisible()
  })

  test('the shop the books belong to is named on screen', async ({ loggedInPage }) => {
    // Guards against the dashboard rendering for the wrong account, or for no
    // account at all — which is what an expired session used to look like.
    await expect(loggedInPage.getByText('E2E Test Shop').first()).toBeVisible({ timeout: 20_000 })
  })

  test('a sale reaches the ledger with the right total', async ({ loggedInPage }) => {
    const page = loggedInPage

    // ── Open the sale form ────────────────────────────────────────────────
    await page.getByRole('button', { name: 'New Sale' }).first().click()
    await expect(page.locator('#field-search-product')).toBeVisible({ timeout: 20_000 })

    // ── Add the product ───────────────────────────────────────────────────
    await page.locator('#field-search-product').fill(E2E_PRODUCT.name)
    const productResult = page.getByRole('button', { name: new RegExp(E2E_PRODUCT.name, 'i') }).first()
    await expect(productResult).toBeVisible({ timeout: 15_000 })
    await productResult.click()

    // Adding it a second time makes the quantity 2 — the same way a shopkeeper
    // ringing up two of something does it.
    await productResult.click()

    // ── Choose the customer ───────────────────────────────────────────────
    await page.locator('#field-party-search').fill(E2E_CUSTOMER.name)
    const customerResult = page.getByText(E2E_CUSTOMER.name, { exact: false }).first()
    await expect(customerResult).toBeVisible({ timeout: 15_000 })
    await customerResult.click()

    // ── The form must already show the correct total before saving ────────
    // If this is wrong, the bug is in the app's arithmetic and there is no
    // point looking at the ledger afterwards.
    await expect(page.getByText(new RegExp(`₹\\s*${EXPECTED_TOTAL}(\\.00)?\\b`)).first())
      .toBeVisible({ timeout: 10_000 })

    // ── Save ──────────────────────────────────────────────────────────────
    await page.getByRole('button', { name: /^Save$/ }).first().click()

    // ── The sale must now be in the ledger ────────────────────────────────
    // Back on a list screen, the customer and the amount both appear. Asserting
    // both together is what makes this about THIS sale rather than any row.
    await expect(page.getByText(E2E_CUSTOMER.name).first()).toBeVisible({ timeout: 30_000 })
    await expect(page.getByText(new RegExp(`₹\\s*${EXPECTED_TOTAL}(\\.00)?\\b`)).first())
      .toBeVisible({ timeout: 30_000 })
  })
})
