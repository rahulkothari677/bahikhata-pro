/**
 * 🔒 GUARD: the Khata screen counts on the server, over every party
 * (Phase 5e-1, ledger model v4: "a count from the database, never from the
 * rows on screen").
 */
import { describe, test, expect } from '@jest/globals'
import { translations } from '@/lib/i18n'
import { readCode } from '@/test-support/read-source'

describe('Khata', () => {
  const screen = readCode('src/components/parties/Parties.tsx')
  const route = readCode('src/app/api/parties/list/route.ts')
  test('the screen pages the server list and sums nothing itself', () => {
    expect(screen).toMatch(/offlineFetch\(`\/api\/parties\/list\?\$\{qp\}`\)/)
    expect(screen).not.toMatch(/\.reduce\(/)
    expect(screen).not.toMatch(/offlineFetch\('\/api\/parties'\)/)
    expect(screen).toMatch(/getNextPageParam: \(last: any\) => \(last\.hasMore/)
  })
  test('the route uses the shared balance, the shared "still due" rule and the tested list logic', () => {
    expect(route).toMatch(/getReceivablePayable\(userId\)/)
    expect(route).toMatch(/oldestDueSaleSql\(userId\)/)
    expect(route).toMatch(/khataList\(rows, \{ side, chip, search, sort, offset \}\)/)
  })
  test('#261: Home and Insights take "to collect / to pay" from khataSides — the rule Khata\'s cards use — never from the sign', () => {
    const dash = readCode('src/app/api/dashboard/route.ts')
    const ins = readCode('src/app/api/insights/route.ts')
    expect(dash).toMatch(/const sides = khataSides\(\[\.\.\.receivablePayable\.partyBalances\.values\(\)\]\)/)
    expect(dash).toMatch(/const totalReceivable = sides\.collect\.amount/)
    expect(dash).toMatch(/const receivableCount = sides\.collect\.count/)
    expect(dash).not.toMatch(/\{\s*totalReceivable,\s*totalPayable\s*\}\s*=\s*receivablePayable/)
    expect(dash).not.toMatch(/receivableCount\+\+|payableCount\+\+/)
    expect(ins).toMatch(/const sides = khataSides\(balances\)/)
    expect(ins).toMatch(/toCollect: sides\.collect\.amount/)
    expect(ins).toMatch(/total: sides\.pay\.amount/)
    expect(ins).toMatch(/udhaarAge\(owing, now\)/)
    expect(ins).not.toMatch(/rp\.totalReceivable|rp\.totalPayable/)
  })
  test('#267: the counter-returns khata gets its own row, never a reminder', () => {
    expect(screen).toMatch(/data\?\.counter && \(/)
    expect(screen).toMatch(/handleViewParty\(data\.counter\.id\)/)
  })
  test('every Khata word exists in English and Hindi', () => {
    const en = translations.en as unknown as Record<string, string>, hi = translations.hi as unknown as Record<string, string>
    const keys = Object.keys(en).filter((k) => k.startsWith('khata.'))
    expect(keys.length).toBeGreaterThanOrEqual(24)
    expect(keys.filter((k) => !hi[k])).toEqual([])
  })
})
