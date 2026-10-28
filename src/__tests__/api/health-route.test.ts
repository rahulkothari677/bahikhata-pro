/**
 * @jest-environment node
 *
 * #286 (Phase 7h): /api/health tells a server start from a sleeping database.
 * It returns timings only — no sign-in, no shop data.
 */
jest.mock('@/lib/db', () => ({ db: { $queryRaw: jest.fn(async () => [{ '?column?': 1 }]) } }))

import { GET } from '@/app/api/health/route'

describe('/api/health', () => {
  it('first request on a fresh instance is cold, the next is warm; both time the database', async () => {
    const a = await (await GET()).json()
    const b = await (await GET()).json()
    expect(a.warm).toBe(false)
    expect(b.warm).toBe(true)
    for (const r of [a, b]) {
      expect(typeof r.dbMs).toBe('number')
      expect(r.dbOk).toBe(true)
      expect(Object.keys(r).sort()).toEqual(['dbMs', 'dbOk', 'instanceAgeMs', 'warm'])
    }
  })
  it('is never cached', async () => {
    const res = await GET()
    expect(res.headers.get('Cache-Control')).toBe('no-store')
  })
})
