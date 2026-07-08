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

  // 🔒 V16 M2 + V17 §2.1/§2.2/§2.3: Client-side running-balance formula must
  // agree with the server helpers. V17 §2.1 extracted the logic into
  // `computeStatementRunningBalance()` in `src/lib/statement-balance.ts` so it
  // can be tested behaviorally (see balance-reconciliation-behavioral.test.ts).
  // These static tests verify the formula patterns are present in the lib file
  // AND that PartyProfile.tsx calls the extracted function.
  describe('🔒 V16 M2 + V17 §2.1/§2.2/§2.3 — Client-side running balance matches server', () => {
    it('🔒 V17 §2.1: PartyProfile.tsx imports and calls computeStatementRunningBalance', () => {
      const source = readFile('components/parties/PartyProfile.tsx')
      // After extraction, the component must import and call the pure function.
      // This is the bridge between the UI and the testable logic.
      expect(source).toMatch(/import\s*\{[^}]*computeStatementRunningBalance[^}]*\}\s*from\s*['"]@\/lib\/statement-balance['"]/)
      expect(source).toMatch(/computeStatementRunningBalance\(/)
      // The inline logic must be GONE (no more delta ternaries in the component).
      expect(source).not.toMatch(/t\.type\s*===\s*'sale'\s*\?[^:]*\(t\.totalAmount/)
    })

    it('statement-balance.ts delta signs match computePartyBalance() signs', () => {
      const source = readFile('lib/statement-balance.ts')

      // The server formula (computePartyBalance):
      //   balance = opening + salesOut - purchaseOut - paymentsReceived + paymentsPaid
      //
      // The client `delta` per entry type must produce the same accumulation:
      //   sale     → +(total - paid)   [adds to what they owe]
      //   purchase → -(total - paid)   [subtracts from what they owe]
      //   received → -amount           [customer paid us → reduces what they owe]
      //   paid     → +amount           [we paid supplier → reduces what we owe them]

      // sale delta: +(t.totalAmount - paidAmount)
      expect(source).toMatch(/t\.type\s*===\s*'sale'\s*\?[^:]*\(t\.totalAmount\s*-\s*\(t\.paidAmount/)

      // purchase delta: -(t.totalAmount - paidAmount) — the else branch
      expect(source).toMatch(/:\s*-\(t\.totalAmount\s*-\s*\(t\.paidAmount/)

      // received delta: -p.amount (customer paid us reduces what they owe)
      expect(source).toMatch(/p\.type\s*===\s*'received'\s*\?[^:]*-p\.amount/)

      // paid delta: +p.amount (we paid supplier — the else branch)
      expect(source).toMatch(/-p\.amount\s*:\s*p\.amount/)
    })

    it('🔒 V17 §2.2: statement-balance.ts walks BACKWARD from statsBalance (not forward from openingBalance)', () => {
      const source = readFile('lib/statement-balance.ts')
      // V17 §2.2 fix: the running balance must anchor on statsBalance (the
      // true current balance from the server), NOT on openingBalance.
      // Verify the backward-walk anchor is present.
      expect(source).toMatch(/CURRENT\s*=\s*roundMoney\(statsBalance/)

      // Verify the backward-walk formula: olderBalance = newerBalance - newerDelta
      expect(source).toMatch(/prev\.runningBalance\s*-\s*prev\.delta/)

      // Verify the OLD forward-walk pattern is GONE.
      expect(source).not.toMatch(/OPENING\s*=\s*Number\(party\?\.openingBalance/)
      expect(source).not.toMatch(/Math\.round\(\(running\s*\+\s*entry\.delta\)/)
    })

    it('🔒 V17 §2.3: statement-balance.ts uses roundMoney (not inline Math.round) for float safety', () => {
      const source = readFile('lib/statement-balance.ts')
      // V17 §2.3 fix: must use the shared roundMoney helper (epsilon-corrected,
      // same as the server's computePartyBalance) instead of inline Math.round.
      expect(source).toMatch(/import\s*\{[^}]*roundMoney[^}]*\}\s*from\s*['"]@\/lib\/money['"]/)
      expect(source).toMatch(/roundMoney\(prev\.runningBalance\s*-\s*prev\.delta\)/)
      expect(source).toMatch(/roundMoney\(statsBalance/)

      // Verify the old inline Math.round pattern is GONE.
      expect(source).not.toMatch(/Math\.round\(\(running\s*\+\s*entry\.delta\)\s*\*\s*100\)\s*\/\s*100/)
    })
  })
})
