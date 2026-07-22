/**
 * Behavioural tests for the Prisma error mapper (2026-07-22).
 *
 * The bug this exists for: an edit that failed on a duplicate invoice number or
 * a pool timeout surfaced as "Failed to update transaction" — a generic 500
 * whose real cause was only in the server log, so the user could not act and
 * support could not diagnose from a screenshot.
 */
import fs from 'fs'
import path from 'path'
import { mapPrismaError } from '@/lib/prisma-error-message'

describe('mapPrismaError', () => {
  test('a duplicate invoice number is a 409 that names the field to change', () => {
    const mapped = mapPrismaError({
      code: 'P2002',
      meta: { target: ['userId', 'invoiceNo'] },
    })
    expect(mapped).not.toBeNull()
    expect(mapped!.status).toBe(409)
    expect(mapped!.code).toBe('P2002')
    expect(mapped!.message).toMatch(/invoice number/i)
    // It must tell the user what to DO, not just what broke.
    expect(mapped!.message).toMatch(/change/i)
  })

  test('a non-invoice unique violation still maps, without inventing a field', () => {
    const mapped = mapPrismaError({ code: 'P2002', meta: { target: ['rowHash'] } })
    expect(mapped!.status).toBe(409)
    expect(mapped!.message).toMatch(/rowHash/)
    expect(mapped!.message).not.toMatch(/invoice number/i)
  })

  test('timeouts promise that nothing changed — the user must not re-enter a bill twice', () => {
    for (const code of ['P2024', 'P2028']) {
      const mapped = mapPrismaError({ code })
      expect(mapped!.status).toBe(503)
      expect(mapped!.message).toMatch(/nothing (was )?changed|rolled back/i)
    }
  })

  test('connection failures map to 503, not 500', () => {
    expect(mapPrismaError({ code: 'P1001' })!.status).toBe(503)
    expect(mapPrismaError({ code: 'P1017' })!.status).toBe(503)
  })

  test('anything else falls through so genuine internals stay behind apiError', () => {
    expect(mapPrismaError({ code: 'P2003' })).toBeNull()
    expect(mapPrismaError(new Error('boom'))).toBeNull()
    expect(mapPrismaError(null)).toBeNull()
    expect(mapPrismaError({ message: 'no code here' })).toBeNull()
  })

  test('the mapped message never echoes the raw error string', () => {
    const mapped = mapPrismaError({
      code: 'P2002',
      meta: { target: ['invoiceNo'] },
      message: 'Invalid `db.transaction.update()` invocation in /var/task/.next/server/app/...',
    })
    expect(mapped!.message).not.toMatch(/var\/task|invocation|\.next/)
  })
})

describe('transaction routes consult the mapper before apiError', () => {
  const routes = [
    'app/api/transactions/route.ts',
    'app/api/transactions/[id]/route.ts',
  ]

  test.each(routes)('%s wires prismaErrorResponse ahead of the generic 500', (rel) => {
    const src = fs.readFileSync(path.join(process.cwd(), 'src', rel), 'utf8')
    expect(src).toMatch(/prismaErrorResponse/)
    // Every generic transaction 500 must be preceded by the mapper — the
    // sibling-implementation trap: fixing one handler and leaving the others.
    const generic = /return apiError\(error, 'Failed to (create|update|delete) transaction', 500\)/g
    let m: RegExpExecArray | null
    while ((m = generic.exec(src)) !== null) {
      const preceding = src.slice(Math.max(0, m.index - 400), m.index)
      expect(preceding).toMatch(/prismaErrorResponse\(error/)
    }
  })
})
