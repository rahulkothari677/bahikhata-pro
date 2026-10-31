/**
 * 🔒 GUARD: a deleted payment settles nothing (#266, 19 Oct, Phase 5d-1).
 *
 * Deleting a payment only marks the payment; its allocation rows stay. Eight
 * reads summed every allocation, so a bill settled by a deleted payment still
 * read as paid in the Bills list, a party's bills, the bill screen, the
 * WhatsApp invoice and reminder, Ask and Settle — while the khata balance
 * said it was owed. Every `paymentAllocations: { … }` read must filter with
 * LIVE_ALLOCATIONS (lib/invoice-due.ts) or select the payment's deletedAt and
 * filter it itself (ca-pack, itc-reversal).
 */
import { describe, test, expect } from '@jest/globals'
import * as fs from 'fs'
import * as path from 'path'
import { stripComments } from '@/test-support/read-source'
import { ALLOCATED_JOIN, allocatedLateral } from '@/lib/invoice-due-sql'

/** Line numbers of `paymentAllocations: {…}` objects that neither use LIVE_ALLOCATIONS nor look at deletedAt. */
function unfilteredAllocationReads(code: string): number[] {
  const out: number[] = []
  const re = /paymentAllocations:\s*\{/g
  let m: RegExpExecArray | null
  while ((m = re.exec(code))) {
    const open = code.indexOf('{', m.index)
    let depth = 0, j = open
    for (; j < code.length; j++) {
      if (code[j] === '{') depth++
      else if (code[j] === '}' && --depth === 0) break
    }
    const body = code.slice(open, j + 1)
    if (!/LIVE_ALLOCATIONS|deletedAt/.test(body)) out.push(code.slice(0, m.index).split(/\r?\n/).length)
  }
  return out
}

describe('settlements of deleted payments never count', () => {
  test('the rule works on good and bad input', () => {
    expect(unfilteredAllocationReads('include: { paymentAllocations: { where: LIVE_ALLOCATIONS, select: { amount: true } } }')).toEqual([])
    expect(unfilteredAllocationReads('x\npaymentAllocations: { select: { amount: true, payment: { select: { deletedAt: true } } } }')).toEqual([])
    expect(unfilteredAllocationReads('a\nb\ninclude: { paymentAllocations: { select: { amount: true } } }')).toEqual([3])
  })

  test('sweep of src/app/api and src/lib (comments do not count)', () => {
    const offenders: string[] = []
    let reads = 0
    const walk = (dir: string) => fs.readdirSync(dir, { withFileTypes: true }).forEach((e) => {
      const full = path.join(dir, e.name)
      if (e.isDirectory()) return walk(full)
      if (!/\.tsx?$/.test(e.name)) return
      const code = stripComments(fs.readFileSync(full, 'utf8'))
      reads += (code.match(/paymentAllocations:\s*\{/g) || []).length
      for (const line of unfilteredAllocationReads(code)) offenders.push(`${path.relative(process.cwd(), full).split(path.sep).join('/')}:${line}`)
    })
    walk(path.resolve(process.cwd(), 'src/app/api'))
    walk(path.resolve(process.cwd(), 'src/lib'))
    // 9 since #327 Step B (31 Oct): the party statement's Prisma read became SQL
    // (allocatedLateral, checked below).
    expect(reads).toBeGreaterThanOrEqual(9)
    expect(offenders).toEqual([])
  })

  test('the SQL readers of allocations join only live payments', () => {
    for (const sql of [ALLOCATED_JOIN, allocatedLateral('u1')]) {
      expect(sql.sql).toMatch(/JOIN "Payment" py ON py\."id" = pa\."paymentId" AND py\."deletedAt" IS NULL/)
    }
  })
})
