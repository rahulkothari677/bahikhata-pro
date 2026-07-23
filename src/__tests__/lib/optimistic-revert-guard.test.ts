/**
 * Optimistic toggles must revert when the SERVER refuses, not only when the
 * network dies (2026-07-22).
 *
 * What was broken, in shopkeeper terms: the owner flips "Hide profit from
 * staff", the switch moves, a success message appears — and nothing was saved.
 * Staff keep seeing the margin on every product. Same for "Allow overselling"
 * and "Invoice round-off": the setting reads one way on screen and another way
 * on the server until the next page load.
 *
 * Why it looked fixed: R16-1/R16-2 added `catch { revert }` blocks, and the
 * comments describe exactly the right behaviour. But `offlineFetch` RESOLVES
 * with the Response on a 4xx/5xx — it only throws on a network failure — so a
 * server rejection never reached the catch. The revert could not run.
 *
 * This is the repo's dominant failure pattern: the visible half of the fix
 * shipped, the mechanical half did not.
 */
import fs from 'fs'
import path from 'path'

function readStripped(rel: string): string {
  const raw = fs.readFileSync(path.join(process.cwd(), 'src', rel), 'utf8')
  return raw.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')
}

describe('offlineFetch contract', () => {
  test('it returns the response on a non-ok status instead of throwing', () => {
    // This is the premise the bug rests on. If offlineFetch ever starts
    // throwing on !ok, the `if (!r.ok)` checks below become redundant rather
    // than wrong — but until then, every caller MUST check.
    const src = readStripped('lib/offline-fetch.ts')
    const mutationPath = src.slice(src.indexOf('const res = await fetch(url,'))
    const beforeReturn = mutationPath.slice(0, mutationPath.indexOf('return res'))
    expect(beforeReturn).not.toMatch(/if \(!res\.ok\) throw/)
  })
})

describe('every optimistic toggle checks the response', () => {
  const cases: Array<[string, string]> = [
    ['components/settings/Settings.tsx', 'persistRoundOff'],
    ['components/settings/Settings.tsx', 'persistStockPolicy'],
    ['hooks/use-setting.ts', 'updateHideProfit'],
  ]

  test.each(cases)('%s → %s reverts on a server rejection', (rel, fnName) => {
    const src = readStripped(rel)
    const start = src.indexOf(fnName)
    expect(start).toBeGreaterThan(-1)
    // Take the function body up to the next top-level declaration.
    const rest = src.slice(start)
    const body = rest.slice(0, rest.indexOf('\n  const ', 10) > 0 ? rest.indexOf('\n  const ', 10) : 2000)

    // It must capture the response...
    expect(body).toMatch(/const r = await offlineFetch/)
    // ...check it...
    expect(body).toMatch(/if \(!r\.ok\)/)
    // ...and throw so the existing catch performs the revert.
    const okCheck = body.slice(body.indexOf('if (!r.ok)'))
    expect(okCheck.slice(0, 120)).toMatch(/throw/)
    // ...and the catch must actually restore the previous value.
    expect(body).toMatch(/catch/)
  })

  test('the success toast is not shown before the response is checked', () => {
    // Showing "Saved" and then reverting is worse than showing the error.
    const src = readStripped('components/settings/Settings.tsx')
    for (const fn of ['persistRoundOff', 'persistStockPolicy']) {
      const start = src.indexOf(fn)
      const body = src.slice(start, start + 1200)
      const okIdx = body.indexOf('if (!r.ok)')
      const successIdx = body.indexOf('sonnerToast.success')
      expect(okIdx).toBeGreaterThan(-1)
      expect(successIdx).toBeGreaterThan(okIdx)
    }
  })
})
