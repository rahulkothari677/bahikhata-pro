/**
 * 🔒 #348 (1 Nov 2026): Settle decides which bills are OPEN before it caps the
 * list. It took the party's oldest 500 bills paid or not, so a customer with
 * more than 500 bills could never have a payment reach a newer unpaid one.
 */
import { readCode } from '@/test-support/read-source'

const src = readCode('src/app/api/payments/route.ts')

/** The SQL that picks Settle's bills: must filter by the due rule before LIMIT. */
export function opensBeforeCap(code: string): boolean {
  const m = code.match(/SELECT t\."id" FROM "Transaction" t \$\{ALLOCATED_JOIN\}[\s\S]*?LIMIT 500/)
  if (!m) return false
  const q = m[0]
  return q.includes('${DUE_SQL} > 0') && q.indexOf('${DUE_SQL} > 0') < q.indexOf('LIMIT 500')
}

test('the rule catches what it claims', () => {
  expect(opensBeforeCap('SELECT t."id" FROM "Transaction" t ${ALLOCATED_JOIN} WHERE x AND ${DUE_SQL} > 0 ORDER BY t."date" LIMIT 500')).toBe(true)
  expect(opensBeforeCap('SELECT t."id" FROM "Transaction" t ${ALLOCATED_JOIN} WHERE x ORDER BY t."date" LIMIT 500')).toBe(false)
  expect(opensBeforeCap('findMany({ take: 500 })')).toBe(false)
})

test('Settle picks still-due bills in SQL, oldest first, then caps', () => {
  expect(opensBeforeCap(src)).toBe(true)
  expect(src).toContain('id: { in: openIds.map((r) => r.id) }')
})
