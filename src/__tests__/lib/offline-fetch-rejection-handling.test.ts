/**
 * offlineFetch resolves on 4xx/5xx — callers MUST check r.ok (2026-07-26).
 *
 * This bug class has now landed three separate times in this codebase:
 *
 *   1. Settings toggles (R16-1/R16-2): "revert on failure" catch blocks that
 *      could never run, so "Hide profit from staff" silently failed OPEN.
 *   2. Onboarding seed: a rejected seed fell through to the success toast and
 *      rendered "Added undefined products".
 *   3. Recurring entries (P6-7): a fix that tracked failures and toasted them —
 *      but only on the catch path. A SERVER rejection (period locked,
 *      validation, quota) skipped the success block AND never reached the
 *      catch, so a month's rent and salary entries vanished in total silence.
 *
 * The shared root cause: `offlineFetch` RESOLVES with the Response on a 4xx or
 * 5xx and throws ONLY when the request never completes. `try/catch` alone
 * therefore handles the *rarer* failure and misses the likelier one.
 *
 * This guard asserts the contract and that the money-touching callers respect
 * it, so the next person writing `try { await offlineFetch(...) } catch` has a
 * test telling them why that is not enough.
 */
import fs from 'fs'
import path from 'path'

function read(rel: string): string {
  return fs.readFileSync(path.join(process.cwd(), 'src', rel), 'utf8')
}

function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')
}

describe('the offlineFetch contract', () => {
  test('it returns the response on a non-ok status instead of throwing', () => {
    // If this ever changes, the `r.ok` checks below become belt-and-braces
    // rather than load-bearing — but until then they are the only thing
    // standing between a server rejection and silence.
    const src = stripComments(read('lib/offline-fetch.ts'))
    const mutationPath = src.slice(src.indexOf('const res = await fetch(url,'))
    const beforeReturn = mutationPath.slice(0, mutationPath.indexOf('return res'))
    expect(beforeReturn).not.toMatch(/if \(!res\.ok\) throw/)
  })
})

describe('recurring entries surface server rejections', () => {
  const src = stripComments(read('hooks/use-recurring-entries.ts'))

  test('a non-ok response is recorded as failed, not ignored', () => {
    // The bug: `if (r.ok) { created++ }` with no else. A 4xx did nothing at
    // all — no success, no failure, no toast.
    expect(src).toMatch(/\}\s*else\s*\{[\s\S]{0,400}failed\.push/)
  })

  test('the failure toast covers both rejection and network paths', () => {
    // Exactly two places can record a failure, and both must.
    const pushes = src.match(/failed\.push\(/g) || []
    expect(pushes.length).toBe(2)
    expect(src).toMatch(/failed\.length > 0/)
  })

  test('the success toast lists only what actually posted', () => {
    // Was `due.map(...)` — every entry that was DUE, including failed ones.
    // "1 entry posted" listing three categories is a small lie in a ledger.
    expect(src).toMatch(/posted\.map\(/)
    expect(src).not.toMatch(/description: due\.map\(/)
  })

  test('money caches are still invalidated when entries post', () => {
    // Recurring entries are real money (rent, salary) — the dashboard and
    // party balances must not lag behind them.
    expect(src).toMatch(/invalidateMoneyCaches\(queryClient\)/)
  })
})

describe('previously-fixed callers have not regressed', () => {
  test.each([
    ['components/settings/Settings.tsx', /if \(!r\.ok\) throw new Error\(await readError\(r\)\)/],
    ['hooks/use-setting.ts', /if \(!r\.ok\) throw new Error/],
    ['components/layout/Onboarding.tsx', /if \(!r\.ok\) throw new Error\('seed failed'\)/],
  ])('%s still checks r.ok', (file, pattern) => {
    expect(stripComments(read(file))).toMatch(pattern)
  })
})
