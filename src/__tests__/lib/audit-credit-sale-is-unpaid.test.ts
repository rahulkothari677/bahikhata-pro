/**
 * @jest-environment node
 *
 * An udhaar sale with an empty Paid field owes the full amount.
 *
 * WHY (audit 2026-08-05, Phase 10). Reproduced through the APP, not the API:
 *
 *   New Sale → pick a customer → add an item → Payment Mode "Credit (Udhaar)"
 *   → leave Paid Amount empty, which is exactly what the field's own hint said
 *   to do ("Leave empty for full payment") → Save.
 *
 * The ₹129.80 sale stored as:
 *
 *     totalAmount 129.80   paidAmount 129.80   outstanding 0
 *
 * and the customer's balance stayed ₹0 across ₹1,129.80 of udhaar sales.
 *
 * `paymentMode` and `paidAmount` were completely independent — choosing
 * "Credit (Udhaar)" changed nothing about the paid field — and the server then
 * applied the ordinary sale default of "empty means paid in full". So the one
 * thing a khata app exists to record could be entered exactly as the interface
 * instructed and disappear.
 *
 * This is the same shape as the V24 §1 note bug it sits beside: a default that
 * is right for one case, applied where it means the opposite.
 */
import fs from 'fs'
import path from 'path'
import { resolveFinalPaid } from '@/lib/paid-amount'

describe('an empty Paid field on a credit sale means nothing was paid', () => {
  it.each([
    ['undefined', undefined],
    ['null', null],
    ['empty string', ''],
    ['NaN', NaN],
  ])('paidAmount %s with mode credit -> 0', (_label, paid) => {
    expect(resolveFinalPaid('sale', paid, 1000, 'credit')).toBe(0)
  })

  it('applies to purchases too — udhaar owed TO a supplier is the same shape', () => {
    expect(resolveFinalPaid('purchase', undefined, 2000, 'credit')).toBe(0)
  })

  it('leaves the whole amount outstanding', () => {
    const total = 129.8
    const paid = resolveFinalPaid('sale', undefined, total, 'credit')
    expect(total - paid).toBe(total)
  })
})

describe('an explicit amount still wins — part payment on udhaar is real', () => {
  it('keeps a partial payment against a credit sale', () => {
    // Customer takes ₹1,000 of goods on udhaar and hands over ₹300 now.
    expect(resolveFinalPaid('sale', 300, 1000, 'credit')).toBe(300)
  })

  it('keeps an explicit zero', () => {
    expect(resolveFinalPaid('sale', 0, 1000, 'credit')).toBe(0)
  })

  it('still caps an over-payment at the total', () => {
    expect(resolveFinalPaid('sale', 1500, 1000, 'credit')).toBe(1000)
  })
})

describe('every other payment mode is unchanged', () => {
  // The control. "Leave empty for full payment" is correct for cash and card,
  // and breaking that would swing the error the other way — every counter sale
  // suddenly showing as unpaid.
  it.each(['cash', 'upi', 'card', 'bank'])('%s with an empty field is still paid in full', (mode) => {
    expect(resolveFinalPaid('sale', undefined, 1000, mode)).toBe(1000)
  })

  it('no mode supplied at all behaves as before', () => {
    // Callers that predate the parameter must not change meaning.
    expect(resolveFinalPaid('sale', undefined, 1000)).toBe(1000)
    expect(resolveFinalPaid('purchase', undefined, 500)).toBe(500)
  })

  it('notes are still khata adjustments regardless of mode', () => {
    // The V24 §1 rule, which this must not disturb.
    expect(resolveFinalPaid('credit-note', undefined, 300, 'credit')).toBe(0)
    expect(resolveFinalPaid('credit-note', undefined, 300, 'cash')).toBe(0)
    expect(resolveFinalPaid('debit-note', undefined, 300, 'cash')).toBe(0)
  })
})

describe('the interface no longer tells people the wrong thing', () => {
  const entry = fs.readFileSync(
    path.join(process.cwd(), 'src/components/ledger/TransactionEntry.tsx'),
    'utf8',
  )

  it('the hint depends on the payment mode', () => {
    // A server-side fix alone would leave the field still instructing the
    // shopkeeper to do the thing that used to lose the debt.
    expect(entry).toMatch(/paymentMode === 'credit'\s*\?\s*`Leave empty for full udhaar/)
  })

  it('the placeholder no longer says "Full" in credit mode', () => {
    expect(entry).toMatch(/paymentMode === 'credit' \? 'Unpaid: 0'/)
  })
})

describe('both write paths pass the payment mode through', () => {

  it.each([
    ['create', 'src/app/api/transactions/route.ts'],
    ['edit', 'src/app/api/transactions/[id]/route.ts'],
  ])('%s passes paymentMode to resolveFinalPaid', (_label, rel) => {
    // Fixing create alone would mean editing an udhaar sale silently marked it
    // paid — the bug returning through the other door.
    const src = fs.readFileSync(path.join(process.cwd(), rel), 'utf8')
    expect(src).toMatch(/resolveFinalPaid\(type, paidAmount, totalAmount, paymentMode\)/)
  })
})
