/**
 * updateHideProfit must write ONE field, not the whole settings row.
 *
 * 🔒 2026-08-09. Found while auditing every control on the Account screen.
 *
 * The hook used to PUT `{ ...currentSetting, hideProfit: newValue }`.
 * /api/settings applies every key present in the body, so a one-field toggle
 * became a full-row overwrite from whatever snapshot that tab happened to be
 * holding. Anything changed since — from the shopkeeper's desktop, by staff,
 * from a second phone — was silently reverted.
 *
 * Reproduced in a browser against a real database before the fix: with the
 * Preferences page open, setting a UPI ID elsewhere and then flipping Hide
 * Profit erased it. No error, no warning. The shop would just stop being able
 * to collect money, because buildUpiLink returns null without a VPA and the
 * Pay button disappears from every bill link.
 *
 * A scan for "does the body contain only the intended key" is the honest test
 * here: the failure was never about the value being wrong, it was about extra
 * keys riding along.
 */

import { readFileSync } from 'fs'
import { join } from 'path'

const src = readFileSync(
  join(process.cwd(), 'src/hooks/use-setting.ts'),
  'utf8',
).replace(/\r\n/g, '\n')

/** The body expression passed to the settings PUT. */
function settingsPutBody(): string {
  const put = src.indexOf("offlineFetch('/api/settings'")
  expect(put).toBeGreaterThan(-1)
  const bodyAt = src.indexOf('body:', put)
  expect(bodyAt).toBeGreaterThan(-1)
  return src.slice(bodyAt, src.indexOf('\n', bodyAt))
}

describe('useSetting → updateHideProfit', () => {
  it('sends only hideProfit, never a spread of the cached row', () => {
    const body = settingsPutBody()
    expect(body).toContain('hideProfit')
    // The spread is the bug. `{ ...currentSetting, hideProfit }` and
    // `{ ...setting, hideProfit }` both reintroduce it.
    expect(body).not.toMatch(/\.\.\./)
  })

  it('does not read the whole cached setting object to build the write', () => {
    // Belt and braces: even if the spread moved to a variable one line up,
    // the hook has no reason to assemble a currentSetting for the request.
    expect(src).not.toContain('const currentSetting')
  })

  it('still reverts the optimistic update when the server rejects', () => {
    // The surrounding guard that an earlier audit added — offlineFetch
    // resolves on 4xx/5xx, so without this check a failed save would leave
    // the switch showing a privacy setting that was never stored.
    expect(src).toContain('if (!r.ok) throw')
  })
})
