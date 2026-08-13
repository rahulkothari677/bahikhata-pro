/**
 * @jest-environment node
 *
 * The shop archive/delete API has a button, and it is wired to the right things.
 *
 * WHY (#30, audit 2026-08-13). #21 shipped `DELETE /api/shops` with archive and
 * empty-shop delete, fully tested — and nothing called it. A shopkeeper still
 * could not remove a shop created by mistake. That is the same shape as #27,
 * where the bank-statement endpoint existed a day before its button, and it is
 * why "the API is done" is not the same sentence as "the feature is done".
 *
 * These are structural checks, and that is stated plainly rather than dressed
 * up: rendering the settings screen needs most of the app. The BEHAVIOUR either
 * side of this is properly covered — the server rules by 18 tests in
 * shop-archive-and-delete.test.ts, and the wording decisions by the tests in
 * edit-conflict.test.ts. What is left, and what these pin, is that the two ends
 * are actually connected.
 */
import fs from 'fs'
import path from 'path'

const read = (p: string) => fs.readFileSync(path.join(process.cwd(), 'src', p), 'utf8')
const SETTINGS = read('components/settings/Settings.tsx')
const HOOK = read('hooks/use-shops.ts')

/**
 * Just the removeShop function.
 *
 * Added after break-testing: the "shows the server's explanation" check below
 * originally searched the whole file, and `description: e?.message` also
 * appears in createShop and renameShop — so deleting it from removeShop left
 * the test green. A guard satisfied by a neighbouring function is not a guard.
 */
const REMOVE_SHOP = (() => {
  const start = HOOK.indexOf('const removeShop = useCallback')
  expect(start).toBeGreaterThan(-1)
  const end = HOOK.indexOf('const activeShop =', start)
  expect(end).toBeGreaterThan(start)
  return HOOK.slice(start, end)
})()

describe('the hook can actually call the endpoint', () => {
  it('sends DELETE to the shops route', () => {
    expect(REMOVE_SHOP).toMatch(/method: 'DELETE'/)
    expect(HOOK).toMatch(/\/api\/shops\$\{qs\}/)
  })

  it('asks for archiving with the flag the server reads', () => {
    // `?archive=1` is what separates "put it away" from "destroy it". A typo
    // here would silently turn every archive into a delete attempt.
    expect(REMOVE_SHOP).toMatch(/archive=1/)
  })

  it('shows the SERVER\'s explanation, not a generic failure', () => {
    // The refusal names what the shop holds — "12 bill(s), 3 customer(s)" —
    // and that sentence is the whole value. An earlier version of this repo's
    // shop-create path threw that away and showed "Failed", which hid a plan
    // limit from the owner for weeks.
    expect(REMOVE_SHOP).toMatch(/description: e\?\.message/)
  })

  it('stops pointing at a shop that has gone', () => {
    expect(REMOVE_SHOP).toMatch(/activeShopId === shopId/)
  })
})

describe('the settings screen offers it', () => {
  it('has a remove control on each shop row', () => {
    expect(SETTINGS).toMatch(/aria-label=\{`Remove \$\{shop\.name\}`\}/)
  })

  it('calls the handler rather than the API directly', () => {
    expect(SETTINGS).toMatch(/handleRemoveShop\(shop\)/)
  })

  it('hides the control when only one shop is left', () => {
    // The server refuses this anyway. A button whose only possible outcome is
    // a rejection is worse than no button — the same reasoning that hides the
    // bank-statement delete from read-only staff.
    expect(SETTINGS).toMatch(/shops\.length > 1 &&/)
  })

  it('asks before doing anything', () => {
    expect(SETTINGS).toMatch(/confirmDialog\([\s\S]{0,200}Remove "\$\{shop\.name\}"\?/)
  })

  it('promises nothing is lost, because that is the fear', () => {
    expect(SETTINGS).toMatch(/nothing is lost/i)
  })

  it('offers archiving as the second question when the delete is refused', () => {
    // Two questions only in the case that deserves two.
    expect(SETTINGS).toMatch(/Put this shop away\?/)
    expect(SETTINGS).toMatch(/removeShop\(shop\.id, 'archive'\)/)
  })

  it('tries the delete first, so the refusal can carry the counts', () => {
    // Guessing emptiness on the client would duplicate a rule the server
    // already owns — and the two would disagree eventually.
    expect(SETTINGS).toMatch(/removeShop\(shop\.id, 'delete'\)/)
  })
})
