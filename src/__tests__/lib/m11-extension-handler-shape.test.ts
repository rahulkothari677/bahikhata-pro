/**
 * 🔒 M11 ROOT-CAUSE GUARD — extension handlers must be keyed by model.
 *
 * THE BUG THIS LOCKS OUT (the ₹100 settle that moved a balance by ₹10,000)
 * ------------------------------------------------------------------------
 * generateModelHandlers() returned its handlers UNKEYED:
 *
 *     return { findMany, create, update, ... }
 *
 * and the call sites spread them straight into `query`:
 *
 *     ...generateModelHandlers('Subscription',    'subscription'),
 *     ...generateModelHandlers('RevenueSchedule', 'revenueSchedule'),
 *
 * All ten spreads collided on the same keys, so `query.create` /
 * `query.findMany` became TOP-LEVEL catch-all handlers permanently bound to
 * modelName='RevenueSchedule', which Prisma then ran for EVERY model on top
 * of that model's own handler.
 *
 * Any model sharing a money column with RevenueSchedule (['amount']) was
 * therefore converted TWICE on write and twice on read:
 *
 *     ₹100 -> 10,000 paise (correct) -> 1,000,000 (stored)
 *
 * Reads through Prisma divided twice too, so the UI looked correct while the
 * raw column — and every raw-SQL balance query — was 100× too large.
 * Verified against a real Postgres instance: before the fix the column held
 * 1,000,000; after it, 10,000.
 *
 * These tests assert the SHAPE of the extension, which is what actually broke.
 */

import { withMoneyConversion, __testing } from '@/lib/prisma-money-extension'

/** Capture the object passed to client.$extends() without a real client. */
function captureExtensionSpec(): any {
  let captured: any
  const fakeClient: any = { $extends: (spec: any) => { captured = spec; return {} } }
  withMoneyConversion(fakeClient)
  return captured
}

// Prisma treats these as special; everything else at this level is a model name.
const PRISMA_SPECIAL_KEYS = new Set(['$allModels', '$allOperations'])
// If any of these appear as a TOP-LEVEL key, they are catch-all operation
// handlers applied to every model — the exact defect.
const OPERATION_NAMES = new Set([
  'findMany', 'findFirst', 'findUnique', 'create', 'createMany',
  'update', 'updateMany', 'upsert', 'delete', 'deleteMany',
  'aggregate', 'groupBy', 'count',
])

describe('M11 — money extension handler shape', () => {
  const spec = captureExtensionSpec()

  test('the extension exposes a query component', () => {
    expect(spec).toBeDefined()
    expect(spec.query).toBeDefined()
  })

  test('NO bare operation name appears as a top-level key', () => {
    // This is the assertion that would have caught the bug on the day it
    // shipped: a top-level `create` is a catch-all that runs for every model.
    const offenders = Object.keys(spec.query).filter(k => OPERATION_NAMES.has(k))
    expect(offenders).toEqual([])
  })

  test('every top-level key is a model name whose handlers are an object', () => {
    for (const [key, value] of Object.entries<any>(spec.query)) {
      if (PRISMA_SPECIAL_KEYS.has(key)) continue
      expect(typeof value).toBe('object')
      // A model entry maps operation names -> functions.
      for (const [op, fn] of Object.entries<any>(value)) {
        expect(OPERATION_NAMES.has(op)).toBe(true)
        expect(typeof fn).toBe('function')
      }
    }
  })

  test('every model with money columns has its own handler entry', () => {
    // camelCase the model name the way Prisma exposes it on the client.
    const expected = Object.keys(__testing.MONEY_COLUMNS)
      .map(m => m.charAt(0).toLowerCase() + m.slice(1))
    const present = Object.keys(spec.query)
    for (const model of expected) {
      expect(present).toContain(model)
    }
  })

  test('models sharing the "amount" column each have a DISTINCT handler entry', () => {
    // Payment, Subscription, BankTransaction and RevenueSchedule all have an
    // `amount` column. Before the fix they shared one catch-all handler, so a
    // Payment write was also converted as a RevenueSchedule.
    for (const m of ['payment', 'subscription', 'bankTransaction', 'revenueSchedule']) {
      expect(spec.query[m]).toBeDefined()
      expect(typeof spec.query[m].create).toBe('function')
    }
    expect(spec.query.payment.create).not.toBe(spec.query.revenueSchedule.create)
  })

  test('write conversion is idempotent (safe if a handler re-runs on retry)', () => {
    const { convertDataOnWrite } = __testing
    const once = convertDataOnWrite('Payment', { amount: 100 })
    expect(once.amount).toBe(10000)
    // Re-converting the SAME object must not multiply again.
    const twice = convertDataOnWrite('Payment', once)
    expect(twice.amount).toBe(10000)
    expect(twice.amount).not.toBe(1000000)
  })
})
