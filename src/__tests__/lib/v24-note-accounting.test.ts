/**
 * 🔒 AUDIT V24 — behavioral tests for the note-accounting fixes.
 *
 * §1  resolveFinalPaid: a credit/debit note with a MISSING paidAmount must
 *     default to 0 (khata adjustment), not totalAmount ("fully refunded").
 *     The old default made a sales return reduce the customer's balance by ₹0.
 *     Includes the end-to-end balance invariant: sale ₹1000 unpaid + CN ₹300
 *     (paid omitted) → party owes ₹700.
 *
 * §2  validateNoteAgainstOriginal: ownership, type pairing, party match, and
 *     the cumulative cap (Σ notes ≤ original). Uses an injected stub db —
 *     behavioral, not text-grep (per audit protocol).
 *
 * POS fix: GSTR-1 place of supply must be the BUYER's state. buildB2B/B2CL/
 *     B2CS/CDNUR with an inter-state party must emit the party's state code,
 *     while walk-ins still fall back to the shop's state.
 */

import { describe, test, expect } from '@jest/globals'
import { resolveFinalPaid, isNoteType } from '@/lib/paid-amount'
import { validateNoteAgainstOriginal, type NoteValidationDb } from '@/lib/note-validation'
import { roundMoney } from '@/lib/money'
import {
  buildB2B, buildB2CL, buildB2CS, buildCDNUR,
  type Gstr1Transaction, type Gstr1Item, type ShopInfo,
} from '@/lib/gstr1-builder'

// ─── §1 resolveFinalPaid ────────────────────────────────────────────────────

describe('V24 §1 — resolveFinalPaid (note paidAmount semantics)', () => {
  test('sale with missing paid → full payment (unchanged behavior)', () => {
    expect(resolveFinalPaid('sale', undefined, 1000)).toBe(1000)
    expect(resolveFinalPaid('purchase', undefined, 500.5)).toBe(500.5)
  })

  test('THE BUG: credit note with missing paid → 0 (khata adjustment), NOT total', () => {
    expect(resolveFinalPaid('credit-note', undefined, 300)).toBe(0)
    expect(resolveFinalPaid('debit-note', undefined, 300)).toBe(0)
    expect(resolveFinalPaid('credit-note', '', 300)).toBe(0)
    expect(resolveFinalPaid('credit-note', null, 300)).toBe(0)
  })

  test('explicit values are respected for all types', () => {
    expect(resolveFinalPaid('sale', 400, 1000)).toBe(400)
    expect(resolveFinalPaid('credit-note', 300, 300)).toBe(300)  // full cash refund
    expect(resolveFinalPaid('credit-note', 100, 300)).toBe(100)  // partial refund
  })

  test('explicit 0 on a note stays 0 — even when total < ₹1 (snap must not fire)', () => {
    expect(resolveFinalPaid('credit-note', 0, 0.6)).toBe(0)
  })

  test('FIX M3 snap: explicit paid within ₹1 of total snaps to total', () => {
    expect(resolveFinalPaid('sale', 999.6, 1000)).toBe(1000)
    expect(resolveFinalPaid('credit-note', 299.5, 300)).toBe(300)  // full-refund w/ round-off residue
  })

  test('negative paid clamps to 0 (zod blocks this upstream; belt-and-braces)', () => {
    expect(resolveFinalPaid('sale', -50, 1000)).toBe(0)
  })

  test('V24 §6.4: overpayment clamps to total (no negative outstanding / phantom advance)', () => {
    expect(resolveFinalPaid('sale', 1500, 1000)).toBe(1000)
    expect(resolveFinalPaid('purchase', 2000.75, 2000)).toBe(2000)   // snap zone
    expect(resolveFinalPaid('credit-note', 500, 300)).toBe(300)      // refund capped at note value
  })

  test('isNoteType classifier', () => {
    expect(isNoteType('credit-note')).toBe(true)
    expect(isNoteType('debit-note')).toBe(true)
    expect(isNoteType('sale')).toBe(false)
    expect(isNoteType('income')).toBe(false)
  })

  test('END-TO-END INVARIANT: sale ₹1000 unpaid + CN ₹300 (paid omitted) → balance ₹700', () => {
    // Replicates party-balance.ts exactly:
    //   balance = opening + (sale.total − sale.paid) − (cn.total − cn.paid) − payments
    const salePaid = resolveFinalPaid('sale', 0, 1000)         // udhaar sale: explicit 0 paid
    const cnPaid = resolveFinalPaid('credit-note', undefined, 300)  // return, field left empty
    const salesOutstanding = roundMoney(1000 - salePaid)
    const creditNoteOutstanding = roundMoney(300 - cnPaid)
    const balance = roundMoney(0 + salesOutstanding - creditNoteOutstanding)
    expect(balance).toBe(700)  // old default produced 1000 — the V24 §1 bug
  })
})

// ─── §2 validateNoteAgainstOriginal ─────────────────────────────────────────

function stubDb(opts: {
  original?: any
  existingNotesTotal?: number
  captureAggregateWhere?: (w: any) => void
}): NoteValidationDb {
  return {
    transaction: {
      async findFirst() { return opts.original ?? null },
      async aggregate(args: any) {
        opts.captureAggregateWhere?.(args.where)
        return { _sum: { totalAmount: opts.existingNotesTotal ?? 0 } }
      },
    },
  }
}

const ORIGINAL_SALE = { id: 'orig1', type: 'sale', partyId: 'party1', totalAmount: 1000, invoiceNo: 'INV-0042' }

describe('V24 §2 — validateNoteAgainstOriginal', () => {
  const base = { userId: 'u1', type: 'credit-note', partyId: 'party1', originalTransactionId: 'orig1' }

  test('rejects when the original does not exist / belongs to another user', async () => {
    const res = await validateNoteAgainstOriginal(stubDb({ original: null }), { ...base, noteTotal: 100 })
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.status).toBe(404)
  })

  test('rejects a credit note against a purchase (type pairing)', async () => {
    const res = await validateNoteAgainstOriginal(
      stubDb({ original: { ...ORIGINAL_SALE, type: 'purchase' } }),
      { ...base, noteTotal: 100 },
    )
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.error).toBe('Invalid original transaction type')
  })

  test('rejects a debit note against a sale (type pairing)', async () => {
    const res = await validateNoteAgainstOriginal(
      stubDb({ original: ORIGINAL_SALE }),
      { ...base, type: 'debit-note', noteTotal: 100 },
    )
    expect(res.ok).toBe(false)
  })

  test('rejects a party mismatch', async () => {
    const res = await validateNoteAgainstOriginal(
      stubDb({ original: ORIGINAL_SALE }),
      { ...base, partyId: 'someone-else', noteTotal: 100 },
    )
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.error).toBe('Party mismatch')
  })

  test('walk-in note against walk-in sale is allowed (null === null)', async () => {
    const res = await validateNoteAgainstOriginal(
      stubDb({ original: { ...ORIGINAL_SALE, partyId: null } }),
      { ...base, partyId: null, noteTotal: 100 },
    )
    expect(res.ok).toBe(true)
  })

  test('THE BUG: rejects a ₹5000 credit note against a ₹1000 sale', async () => {
    const res = await validateNoteAgainstOriginal(
      stubDb({ original: ORIGINAL_SALE }),
      { ...base, noteTotal: 5000 },
    )
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.error).toBe('Note exceeds original invoice')
  })

  test('rejects when CUMULATIVE notes exceed the original (₹800 existing + ₹300 new > ₹1000)', async () => {
    const res = await validateNoteAgainstOriginal(
      stubDb({ original: ORIGINAL_SALE, existingNotesTotal: 800 }),
      { ...base, noteTotal: 300 },
    )
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.message).toContain('200.00')  // remaining headroom surfaced
  })

  test('accepts a note exactly at the cap (₹800 existing + ₹200 new = ₹1000)', async () => {
    const res = await validateNoteAgainstOriginal(
      stubDb({ original: ORIGINAL_SALE, existingNotesTotal: 800 }),
      { ...base, noteTotal: 200 },
    )
    expect(res.ok).toBe(true)
  })

  test('1-paisa float tolerance does not reject a legitimate full return', async () => {
    const res = await validateNoteAgainstOriginal(
      stubDb({ original: { ...ORIGINAL_SALE, totalAmount: 1000 } }),
      { ...base, noteTotal: 1000.01 },
    )
    expect(res.ok).toBe(true)
  })

  test('PUT: excludes the note being edited from the cumulative sum', async () => {
    let capturedWhere: any = null
    const res = await validateNoteAgainstOriginal(
      stubDb({ original: ORIGINAL_SALE, existingNotesTotal: 0, captureAggregateWhere: w => { capturedWhere = w } }),
      { ...base, noteTotal: 900, excludeNoteId: 'note-being-edited' },
    )
    expect(res.ok).toBe(true)
    expect(capturedWhere.id).toEqual({ not: 'note-being-edited' })
    expect(capturedWhere.deletedAt).toBeNull()
    expect(capturedWhere.originalTransactionId).toBe('orig1')
  })
})

// ─── GSTR-1 Place of Supply fix ─────────────────────────────────────────────

const SHOP: ShopInfo = { gstin: '27ABCDE1234F1Z5', state: 'Maharashtra', stateCode: '27' }

const ITEM_IGST: Gstr1Item = {
  productId: 'p1', productName: 'Rice', hsn: '1006',
  quantity: 100, unit: 'kg', unitPrice: 50, gstRate: 18,
  discountAmount: 0, cgst: 0, sgst: 0, igst: 900, csamt: 0,
}

function interStateTxn(overrides: Partial<Gstr1Transaction>): Gstr1Transaction {
  return {
    id: 'tx1', type: 'sale', invoiceNo: 'INV-100', date: new Date('2026-07-10'),
    totalAmount: 5900, subtotal: 5000, discountAmount: 0,
    cgst: 0, sgst: 0, igst: 900, isInterState: true, isReverseCharge: false,
    partyId: 'pD', partyName: 'Delhi Traders', partyGstin: null, partyState: 'Delhi',
    items: [ITEM_IGST],
    ...overrides,
  }
}

describe('V24 POS fix — GSTR-1 place of supply is the buyer state', () => {
  test('B2B: inter-state buyer GSTIN 07… → pos 07 (was: shop state 27)', () => {
    const txn = interStateTxn({ partyGstin: '07AAAPL1234C1Z5' })
    const result = buildB2B([txn], SHOP)
    expect(result[0].inv[0].pos).toBe('07')
  })

  test('B2B: same-state buyer keeps pos 27 (regression guard)', () => {
    const txn = interStateTxn({ partyGstin: '27AAAPL1234C1Z5', partyState: 'Maharashtra', isInterState: false })
    const result = buildB2B([txn], SHOP)
    expect(result[0].inv[0].pos).toBe('27')
  })

  test('B2CL: inter-state unregistered buyer (state name) → buyer state code', () => {
    const txn = interStateTxn({ partyGstin: null, partyState: 'Delhi', totalAmount: 150000 })
    const result = buildB2CL([txn], SHOP)
    expect(result).toHaveLength(1)
    expect(result[0].pos).toBe('07')
  })

  test('B2CS: inter-state small sale groups under buyer state, intra under shop state', () => {
    const inter = interStateTxn({ partyGstin: null, partyState: 'Delhi', totalAmount: 5900 })
    const intraWalkIn = interStateTxn({
      id: 'tx2', partyId: null, partyName: null, partyGstin: null, partyState: null,
      isInterState: false, igst: 0, cgst: 450, sgst: 450,
      items: [{ ...ITEM_IGST, igst: 0, cgst: 450, sgst: 450 }],
    })
    const result = buildB2CS([inter, intraWalkIn], SHOP)
    const posList = result.map(r => r.pos).sort()
    expect(posList).toEqual(['07', '27'])  // buyer state + shop-state fallback for walk-in
  })

  test('CDNUR: unregistered inter-state credit note carries buyer state', () => {
    const cn = interStateTxn({ type: 'credit-note', partyGstin: null, partyState: 'Delhi' })
    const result = buildCDNUR([cn], SHOP)
    expect(result[0].pos).toBe('07')
  })
})
