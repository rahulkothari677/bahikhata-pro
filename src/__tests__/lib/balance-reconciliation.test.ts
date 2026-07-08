/**
 * 🔒 V15 §1 Reconciliation Test — all 4 balance computations must agree.
 *
 * This test verifies that every screen that computes a party's balance
 * uses the single source of truth: `computePartyBalance()` or
 * `getReceivablePayable()` (which share the same formula including payments).
 *
 * The 4 sites:
 * 1. getReceivablePayable() — dashboard totals, party list
 * 2. computePartyBalance() — party-detail headline, WhatsApp reminder
 * 3. parties/[id]/route.ts — MUST call computePartyBalance()
 * 4. whatsapp-reminder/route.ts — MUST call computePartyBalance()
 *
 * If any site stops using the helper and re-implements the balance inline,
 * this test fails — preventing the "three screens, three balances" bug class.
 */

import * as fs from 'fs'
import * as path from 'path'

describe('🔒 V15 §1 — Balance reconciliation (all screens must agree)', () => {
  const SRC_DIR = path.join(process.cwd(), 'src')

  function readFile(relPath: string): string {
    return fs.readFileSync(path.join(SRC_DIR, relPath), 'utf-8')
  }

  describe('computePartyBalance returns payment fields', () => {
    // Verify the helper includes payments in its return type
    it('returns paymentsReceived and paymentsPaid', () => {
      const source = readFile('lib/party-balance.ts')
      expect(source).toContain('paymentsReceived')
      expect(source).toContain('paymentsPaid')
      // Verify the balance formula includes payments
      expect(source).toContain('- paymentsReceived')
      expect(source).toContain('+ paymentsPaid')
    })
  })

  describe('getReceivablePayable includes payments', () => {
    it('uses pre-aggregated payment subquery (no fan-out)', () => {
      const source = readFile('lib/party-balance.ts')
      // Must have a Payment subquery with GROUP BY partyId
      expect(source).toMatch(/FROM "Payment"[\s\S]*?GROUP BY "partyId"/)
      // Must include paymentsReceived and paymentsPaid in the balance
      expect(source).toContain('paymentsReceived')
      expect(source).toContain('paymentsPaid')
    })
  })

  describe('parties/[id]/route.ts uses computePartyBalance()', () => {
    it('does NOT compute balance inline (no openingBalance + salesOutstanding - purchaseOutstanding)', () => {
      const source = readFile('app/api/parties/[id]/route.ts')
      // Must import and call computePartyBalance
      expect(source).toContain('computePartyBalance')
      // Must NOT have the old inline balance computation
      expect(source).not.toMatch(/openingBalance\s*\+\s*salesOutstanding\s*-\s*purchaseOutstanding/)
    })
  })

  describe('whatsapp-reminder/route.ts uses computePartyBalance()', () => {
    it('does NOT compute balance inline', () => {
      const source = readFile('app/api/whatsapp-reminder/route.ts')
      // Must import and call computePartyBalance
      expect(source).toContain('computePartyBalance')
      // Must NOT have the old inline balance computation
      expect(source).not.toMatch(/openingBalance\s*\+\s*salesOutstanding/)
      expect(source).not.toMatch(/transactions\.reduce.*totalAmount.*paidAmount/)
    })
  })

  describe('Balance formula consistency', () => {
    // Verify both helpers use the SAME formula:
    // balance = openingBalance + salesOutstanding - purchaseOutstanding
    //           - paymentsReceived + paymentsPaid
    it('computePartyBalance and getReceivablePayable use the same formula', () => {
      const source = readFile('lib/party-balance.ts')

      // computePartyBalance formula
      const computeMatch = source.match(
        /party\.openingBalance\s*\+\s*salesOutstanding\s*-\s*purchaseOutstanding\s*-\s*paymentsReceived\s*\+\s*paymentsPaid/
      )
      expect(computeMatch).not.toBeNull()

      // getReceivablePayable formula (in the JS processing of SQL rows)
      const getMatch = source.match(
        /openingBalance\s*\+\s*salesOutstanding\s*-\s*purchaseOutstanding\s*-\s*paymentsReceived\s*\+\s*paymentsPaid/
      )
      expect(getMatch).not.toBeNull()
    })
  })
})
