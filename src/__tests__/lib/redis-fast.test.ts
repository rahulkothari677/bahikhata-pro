/**
 * #286 (Phase 7h): no Redis call may hold a screen for long. Every Redis client in
 * the app uses FAST_REDIS_OPTIONS (1.5 s per request, one retry) — the Upstash
 * defaults (5 retries, growing waits) fit the 12-second first signed-in request.
 */
import { readdirSync, readFileSync, statSync } from 'fs'
import { join, relative } from 'path'
import { FAST_REDIS_OPTIONS, REDIS_TIMEOUT_MS } from '@/lib/redis-fast'

function tsFiles(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) { if (name !== '__tests__') tsFiles(p, out) }
    else if (/\.tsx?$/.test(name)) out.push(p)
  }
  return out
}

/** `new Redis({ … })` calls that do not spread the shared options. */
function slowRedisClients(code: string): string[] {
  return (code.match(/new Redis\(\{[^}]*\}\)/g) || []).filter((c) => !c.includes('...FAST_REDIS_OPTIONS'))
}

describe('Redis never holds a screen', () => {
  it('one short limit and one retry', () => {
    expect(REDIS_TIMEOUT_MS).toBeLessThanOrEqual(2000)
    expect(FAST_REDIS_OPTIONS.retry.retries).toBeLessThanOrEqual(1)
    const a = FAST_REDIS_OPTIONS.signal()
    const b = FAST_REDIS_OPTIONS.signal()
    expect(a).not.toBe(b) // a fresh signal per request
  })
  it('the check finds a client on the defaults', () => {
    expect(slowRedisClients('x = new Redis({ url, token })')).toHaveLength(1)
    expect(slowRedisClients('x = new Redis({ url, token, ...FAST_REDIS_OPTIONS })')).toHaveLength(0)
  })
  it('every Redis client in src uses the shared options, and there is at least one', () => {
    const src = join(process.cwd(), 'src')
    let clients = 0
    const slow: string[] = []
    for (const f of tsFiles(src)) {
      const code = readFileSync(f, 'utf8')
      clients += (code.match(/new Redis\(\{/g) || []).length
      for (const c of slowRedisClients(code)) slow.push(`${relative(src, f)}: ${c}`)
    }
    expect(clients).toBeGreaterThanOrEqual(2)
    expect(slow).toEqual([])
  })
})
