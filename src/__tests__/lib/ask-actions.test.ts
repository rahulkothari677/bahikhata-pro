/**
 * Ask your books Phase 2.2 — the actions offered on an answer.
 *
 * The tests that matter here are the ones about DIRECTION and about NOT
 * GUESSING. Everything else is labels.
 */

import { describe, test, expect } from '@jest/globals'
import { buildBalanceActions } from '@/lib/ask-actions'

const bill = (id: string, invoiceNo: string | null, due: number) => ({ id, invoiceNo, due })

describe('buildBalanceActions', () => {
  describe('direction', () => {
    test('a customer who owes us gets a reminder and a payment button', () => {
      const a = buildBalanceActions({
        partyId: 'p1', phone: '9811111111', balance: 1025,
        unpaid: [bill('t1', 'INV-0001', 1025)],
      })
      expect(a.map(x => x.kind)).toEqual(['remind', 'settle', 'open-party'])
      expect(a.find(x => x.kind === 'settle')!.label).toBe('Record payment')
    })

    /*
     * THE ONE THAT WOULD EMBARRASS US.
     *
     * A negative balance means WE owe THEM. Offering "send reminder" here would
     * open WhatsApp addressed to a supplier, in the shopkeeper's name, chasing
     * them for money the shopkeeper actually owes. It is the single worst thing
     * this feature could do, and it is one flipped comparison away.
     */
    test('a supplier we owe is NEVER offered a reminder', () => {
      const a = buildBalanceActions({
        partyId: 'p2', phone: '9822222222', balance: -1025,
        unpaid: [bill('t2', 'SUP-01', 1025)],
      })
      expect(a.map(x => x.kind)).not.toContain('remind')
      expect(a.map(x => x.kind)).toEqual(['settle', 'open-party'])
    })

    test('the verb follows the direction, so money out never reads as money in', () => {
      const owedToUs = buildBalanceActions({ partyId: 'p', phone: '98', balance: 500, unpaid: [] })
      const owedByUs = buildBalanceActions({ partyId: 'p', phone: '98', balance: -500, unpaid: [] })
      expect(owedToUs.find(x => x.kind === 'settle')!.label).toBe('Record payment')
      expect(owedByUs.find(x => x.kind === 'settle')!.label).toBe('Record payment made')
    })
  })

  describe('a reminder needs somewhere to send it', () => {
    test.each([
      ['no phone field', undefined],
      ['null phone', null],
      ['empty phone', ''],
      ['whitespace phone', '   '],
    ])('%s — no reminder button rather than one that fails', (_label, phone) => {
      const a = buildBalanceActions({ partyId: 'p', phone, balance: 900, unpaid: [] })
      expect(a.map(x => x.kind)).not.toContain('remind')
      // The payment button still stands — the debt is real either way.
      expect(a.map(x => x.kind)).toContain('settle')
    })
  })

  describe('settled means settled', () => {
    test('a zero balance offers no money action at all', () => {
      const a = buildBalanceActions({ partyId: 'p', phone: '9811111111', balance: 0, unpaid: [] })
      expect(a.map(x => x.kind)).toEqual(['open-party'])
    })

    /*
     * Paise are integers underneath, but this arrives as rupees, and a balance
     * of a tenth of a paisa is a rounding artefact rather than a debt. Showing
     * "Record payment" on an account that reads ₹0.00 makes the app look wrong
     * about the one thing it must be right about.
     */
    test('a fraction of a paisa is not a debt', () => {
      expect(buildBalanceActions({ partyId: 'p', phone: '98', balance: 0.001, unpaid: [] })
        .map(x => x.kind)).toEqual(['open-party'])
      expect(buildBalanceActions({ partyId: 'p', phone: '98', balance: -0.001, unpaid: [] })
        .map(x => x.kind)).toEqual(['open-party'])
    })
  })

  describe('never guess which bill a payment is against', () => {
    test('exactly one unpaid bill — name it, so Settle opens on that bill', () => {
      const a = buildBalanceActions({
        partyId: 'p', phone: '98', balance: 787.5,
        unpaid: [bill('t9', 'INV-0007', 787.5)],
      })
      const settle = a.find(x => x.kind === 'settle')!
      expect(settle.transactionId).toBe('t9')
      expect(settle.invoiceNo).toBe('INV-0007')
      expect(settle.amount).toBe(787.5)
    })

    test('several unpaid bills — name none, and let the shopkeeper choose', () => {
      const a = buildBalanceActions({
        partyId: 'p', phone: '98', balance: 2000,
        unpaid: [bill('t1', 'INV-1', 500), bill('t2', 'INV-2', 700), bill('t3', 'INV-3', 800)],
      })
      const settle = a.find(x => x.kind === 'settle')!
      expect(settle.transactionId).toBeUndefined()
      expect(settle.invoiceNo).toBeUndefined()
      expect(settle.amount).toBeUndefined()
    })

    test('a balance with no unpaid bills behind it still offers Settle, unattached', () => {
      // Running-account balances exist without an invoice — an opening balance,
      // or an advance. Settle handles that; it just has no bill to preselect.
      const settle = buildBalanceActions({ partyId: 'p', phone: '98', balance: 300, unpaid: [] })
        .find(x => x.kind === 'settle')!
      expect(settle.transactionId).toBeUndefined()
    })
  })

  test('every action carries the party it acts on', () => {
    for (const balance of [1000, -1000, 0]) {
      for (const a of buildBalanceActions({ partyId: 'party-42', phone: '98', balance, unpaid: [] })) {
        expect(a.partyId).toBe('party-42')
      }
    }
  })
})
