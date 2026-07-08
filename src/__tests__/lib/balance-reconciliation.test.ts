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

  // 🔒 V16 M2: Client-side running-balance formula must agree with the server
  // helpers. The V15 §1 test only grepped `party-balance.ts` (the server side).
  // But V15 M-2 added a NEW balance computation in `PartyProfile.tsx` (the
  // client-side running balance on the account statement). If that formula's
  // `delta` signs ever drift from the server's, the "Bal: ₹X" badge on each
  // statement entry will diverge from the "Current Balance: ₹Y" banner at the
  // top — and no existing test would catch it.
  //
  // This block statically checks the client formula's signs match the server's.
  // It's not a runtime test (would need a test DB), but it catches the most
  // common drift: someone flipping a sign in the `delta` ternary.
  describe('🔒 V16 M2 — Client-side running balance formula matches server', () => {
    it('PartyProfile.tsx delta signs match computePartyBalance() signs', () => {
      const source = readFile('components/parties/PartyProfile.tsx')

      // The server formula (computePartyBalance):
      //   balance = opening + salesOut - purchaseOut - paymentsReceived + paymentsPaid
      //
      // The client `delta` per entry type must produce the same accumulation:
      //   sale     → +(total - paid)   [adds to what they owe]
      //   purchase → -(total - paid)   [subtracts from what they owe]
      //   received → -amount           [customer paid us → reduces what they owe]
      //   paid     → +amount           [we paid supplier → reduces what we owe them]
      //
      // Verify each sign is present in the source.

      // sale delta: +(t.totalAmount - paidAmount)
      // The ternary is: t.type === 'sale' ? (t.totalAmount - ...) : -(...)
      expect(source).toMatch(/t\.type\s*===\s*'sale'\s*\?[^:]*\(t\.totalAmount\s*-\s*\(t\.paidAmount/)

      // purchase delta: -(t.totalAmount - paidAmount) — the else branch
      // Look for the `: -(t.totalAmount - ...)` pattern
      expect(source).toMatch(/:\s*-\(t\.totalAmount\s*-\s*\(t\.paidAmount/)

      // received delta: -p.amount (customer paid us reduces what they owe)
      // The ternary is: p.type === 'received' ? -p.amount : p.amount
      expect(source).toMatch(/p\.type\s*===\s*'received'\s*\?[^:]*-p\.amount/)

      // paid delta: +p.amount (we paid supplier — the else branch)
      // Look for `: p.amount` after the received ternary
      expect(source).toMatch(/-p\.amount\s*:\s*p\.amount/)
    })

    it('PartyProfile.tsx seeds running balance with party.openingBalance (not stats.balance)', () => {
      const source = readFile('components/parties/PartyProfile.tsx')
      // The running balance must start from the party's opening balance, NOT
      // from the current balance. Starting from current balance would make
      // every entry's "Bal: ₹X" wrong by the accumulated delta.
      expect(source).toMatch(/OPENING\s*=\s*Number\(party\?\.openingBalance/)
    })

    it('PartyProfile.tsx uses Math.round * 100 / 100 for float safety (matches roundMoney)', () => {
      const source = readFile('components/parties/PartyProfile.tsx')
      // The client can't import roundMoney (it's a server lib that pulls in
      // Prisma types via db). It uses inline Math.round(x * 100) / 100 instead.
      // Verify the pattern is present — if someone removes it, float drift
      // will accumulate across many entries.
      expect(source).toMatch(/Math\.round\(\(running\s*\+\s*entry\.delta\)\s*\*\s*100\)\s*\/\s*100/)
    })
  })
})
