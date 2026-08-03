/**
 * 🔒 Four backlog fixes, 2026-08-03. Grouped because three of them share one
 * mistake: a per-BROWSER or invoice-only fact standing in for an account-wide
 * one.
 *
 *  #9  The tour greeted an established shop with "Record Your First Sale".
 *  #10 The theme picker reappeared on every single load.
 *  #12 The party report's periodActivity ignored money collected in the period.
 *  #13 Ledger search said "No sales yet" to a shop with 50+ sales.
 */
import fs from 'fs'
import path from 'path'

/**
 * Normalises CRLF. These files are checked out with Windows line endings, so
 * any anchor containing `\n` silently matches nothing and the assertion passes
 * against an empty string — a guard that guards nothing. Caught here by a slice
 * coming back empty; normalising once removes the trap for every test below.
 */
const read = (rel: string) =>
  fs.readFileSync(path.join(process.cwd(), rel), 'utf8').replace(/\r\n/g, '\n')

const page = read('src/app/page.tsx')
const tour = read('src/components/common/OnboardingTour.tsx')
const shell = read('src/components/layout/AppShell.tsx')
const ledger = read('src/components/ledger/Ledger.tsx')
const reports = read('src/app/api/reports/route.ts')

describe('#10 — the theme picker is asked once, not every load', () => {
  test('the done-flag is seeded from localStorage, like its neighbour', () => {
    // It was plain useState(false), so it reset on every mount and
    // `!themePickerDone && !!session` fired forever.
    expect(page).toMatch(/themePickerDone.*=.*useState\(\(\) => \{[\s\S]{0,200}bahikhata-theme-picker-done/)
  })

  test('choosing a theme persists that it was asked', () => {
    expect(page).toMatch(/setItem\('bahikhata-theme-picker-done', 'true'\)/)
  })

  test('it is gated on the account being new, not just the browser', () => {
    // Persistence alone cannot help a second device.
    expect(page).toMatch(/showThemePicker = !themePickerDone && !!session[\s\S]{0,120}hasNoData/)
  })
})

describe('#9 — the tour is first-run guidance, and knows it', () => {
  test('the tour accepts an isFirstRun signal', () => {
    expect(tour).toMatch(/isFirstRun\s*=\s*true/)
  })

  test('a non-first-run account is dismissed without showing the tour', () => {
    const effect = tour.slice(tour.indexOf('const seen = localStorage'), tour.indexOf('setVisible(true)'))
    expect(effect).toMatch(/if \(!isFirstRun\)/)
    // Marked seen so it is not re-evaluated on every load.
    expect(effect).toMatch(/setItem\(STORAGE_KEY, 'true'\)/)
  })

  test('the effect re-runs if isFirstRun arrives late', () => {
    // dashboardData loads asynchronously; a stale closure would defeat this.
    expect(tour).toMatch(/\}, \[onDone, isFirstRun\]\)/)
  })

  test('the signal is threaded page -> shell -> tour', () => {
    expect(page).toMatch(/isFirstRun: dashboardData !== undefined && hasNoData/)
    expect(shell).toMatch(/isFirstRun\?: boolean/)
    expect(shell).toMatch(/<OnboardingTour onDone=\{onTourDone\} isFirstRun=\{isFirstRun\} \/>/)
  })
})

describe('#13 — "nothing matched" is not "nothing exists"', () => {
  const api = read('src/app/api/transactions/route.ts')

  test('a no-match state exists that is distinct from the empty ledger', () => {
    expect(ledger).toMatch(/filtered\.length === 0 && transactions\.length > 0/)
    expect(ledger).toMatch(/No \{isSale \? 'sales' : 'purchases'\} match/)
  })

  test('the real empty state still exists for a genuinely empty ledger', () => {
    expect(ledger).toMatch(/No \$\{isSale \? 'sales' : 'purchases'\} yet/)
  })

  test('it offers a way out', () => {
    const i = ledger.indexOf('match &ldquo;')
    expect(i).toBeGreaterThan(-1)
    expect(ledger.slice(i, i + 1800)).toMatch(/setSearch\(''\)/)
  })

  /*
   * Browser testing showed the empty state alone was not enough: search only
   * filtered the loaded page, so a three-month-old invoice was still missing
   * after pressing "Load more" twice (50 → 100 rows). On a real shop it is
   * unfindable. Search now runs on the server.
   */
  test('the API accepts a search param', () => {
    expect(api).toMatch(/searchParams\.get\('search'\)/)
  })

  test('search matches invoice, party name, phone and notes', () => {
    const block = api.slice(api.indexOf("const search = "), api.indexOf("const search = ") + 900)
    expect(block).toMatch(/invoiceNo: \{ contains: search/)
    expect(block).toMatch(/notes: \{ contains: search/)
    expect(block).toMatch(/party: \{ name: \{ contains: search/)
  })

  test('the search clause is ANDed inside the tenant scope, never ORed at top level', () => {
    // A top-level OR beside `userId` would leak other shops' transactions.
    const block = api.slice(api.indexOf("const search = "), api.indexOf("const search = ") + 900)
    expect(block).toMatch(/where\.AND\.push\(\{\s*OR:/)
  })

  test('the client debounces and keys the query on the search term', () => {
    // Un-keyed, paging would continue from a cursor belonging to the previous
    // result set; un-debounced, every keystroke would hit the database.
    expect(ledger).toMatch(/setDebouncedSearch\(search\.trim\(\)\), 350\)/)
    expect(ledger).toMatch(/showVoided \? 'voided' : 'active', debouncedSearch\]/)
    expect(ledger).toMatch(/qp\.set\('search', debouncedSearch\)/)
  })
})

describe('#12 — periodActivity counts collections, not just invoices', () => {
  test('the party report aggregates payments over the same window', () => {
    expect(reports).toMatch(/periodPaymentAgg/)
    const q = reports.slice(reports.indexOf('db.payment.groupBy'), reports.indexOf('db.payment.groupBy') + 400)
    expect(q).toMatch(/by: \['partyId', 'type'\]/)
    expect(q).toMatch(/date: \{ gte: from, lte: to \}/)
    expect(q).toMatch(/deletedAt: null/)
  })

  test('a customer paying reduces what they owe; paying a supplier reduces what we owe', () => {
    const loop = reports.slice(reports.indexOf('for (const row of periodPaymentAgg) {\n        const entry'))
    const body = loop.slice(0, 700)
    expect(body).toMatch(/'received'[\s\S]{0,120}periodActivity - amount/)
    expect(body).toMatch(/'paid'[\s\S]{0,120}periodActivity \+ amount/)
  })

  test('a party whose only activity was settling is still fetched', () => {
    // No row in periodPartyAgg, and their balance may now be exactly zero.
    expect(reports).toMatch(/for \(const row of periodPaymentAgg\) \{\s*relevantPartyIds\.add\(row\.partyId\)/)
  })

  test('...and is not dropped by the final filter', () => {
    expect(reports).toMatch(/p\.balance !== 0 \|\| p\.periodActivity !== 0/)
  })
})
