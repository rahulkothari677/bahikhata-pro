/**
 * 🔒 R9-1 GUARD — all statement exporters must agree with the screen.
 *
 * HISTORY (why this test exists)
 * ------------------------------
 * PartyProfile has THREE statement exporters: Download (HTML), Print, and
 * "Send PDF" (WhatsApps a statement to the customer). Each grew its own
 * row-building logic, and the same money bug was fixed in ONE of them, twice:
 *
 *   • V19-017 fixed pagination in the PRINT exporter only.
 *   • A later fix corrected the DOWNLOAD exporter only.
 *   • "Send PDF" — the one the CUSTOMER receives — still iterated the
 *     paginated 50-row `transactions` array, omitted every Settle payment,
 *     and ADDED credit notes to the amount owed. Its "Balance Due" therefore
 *     overstated the customer's debt on a document bearing the shop's name
 *     and GSTIN.
 *
 * Worked example from real data: a customer whose true balance was ₹1,058.40
 * would receive a PDF demanding ₹3,268.40 — the ₹2,210 of Settle payments she
 * had already made were invisible to the exporter.
 *
 * These tests pin the invariant that actually matters: whatever an exporter
 * prints, its closing figure is the canonical balance, and payments and
 * credit notes move it in the right direction.
 */

import { computeStatementRunningBalance } from '@/lib/statement-balance'
import fs from 'fs'
import path from 'path'

const PARTY_PROFILE = path.join(process.cwd(), 'src/components/parties/PartyProfile.tsx')

describe('R9-1 — statement exporters', () => {
  describe('source-level guards (structural)', () => {
    const src = fs.readFileSync(PARTY_PROFILE, 'utf8')

    test('no exporter iterates the paginated `transactions` array', () => {
      // `transactions` is ONE PAGE (PAGE_SIZE = 50) from /api/parties/[id].
      // Building a statement from it silently truncates and drops payments.
      expect(src).not.toMatch(/transactions\.forEach\(/)
      expect(src).not.toMatch(/transactions\.map\([^)]*\)\s*\.join/)
    })

    test('exporters build rows through the shared helper', () => {
      expect(src).toMatch(/const buildStatementRows = \(\)/)
      // Used by all three exporters (download, print, share-PDF).
      const uses = src.match(/buildStatementRows\(\)/g) || []
      expect(uses.length).toBeGreaterThanOrEqual(3)
    })

    test('the closing figure comes from the canonical balance, never re-derived', () => {
      expect(src).toMatch(/const statementClosing = \(\)/)
      expect(src).toMatch(/const closing = stats\?\.balance \?\? 0/)
      // The old re-derived figure must be gone.
      expect(src).not.toMatch(/const totalDue = totalAmount - totalPaid/)
    })
  })

  describe('behavioural: the closing figure must equal the canonical balance', () => {
    const party = { openingBalance: 0 }

    /** Mirrors what an exporter prints as its closing line. */
    const closingOf = (txns: any[], pays: any[], canonicalBalance: number) => {
      const statement = computeStatementRunningBalance(txns as any, pays as any, canonicalBalance)
      // Newest entry carries the canonical balance by construction.
      return statement.length ? statement[0].runningBalance : canonicalBalance
    }

    test('a sale plus a Settle payment: closing equals the canonical balance', () => {
      const txns = [{ id: 't1', date: new Date('2026-07-01'), type: 'sale', totalAmount: 120, paidAmount: 10, invoiceNo: 'INV-1', _count: { items: 1 } }]
      const pays = [{ id: 'p1', date: new Date('2026-07-02'), type: 'received', amount: 100, mode: 'cash', notes: null }]
      // 120 - 10 invoice-paid - 100 settled = 10 still owed.
      expect(closingOf(txns, pays, 10)).toBeCloseTo(10, 2)
    })

    test('the payment is REPRESENTED (not silently dropped)', () => {
      const txns = [{ id: 't1', date: new Date('2026-07-01'), type: 'sale', totalAmount: 120, paidAmount: 10, invoiceNo: 'INV-1', _count: { items: 1 } }]
      const pays = [{ id: 'p1', date: new Date('2026-07-02'), type: 'received', amount: 100, mode: 'cash', notes: null }]
      const statement = computeStatementRunningBalance(txns as any, pays as any, 10)
      // 1 sale + 1 payment. The old PDF exporter produced 1 row (sale only).
      expect(statement).toHaveLength(2)
      expect(statement.some((e: any) => e.isPayment)).toBe(true)
    })

    test('a credit note REDUCES what the customer owes (old exporter added it)', () => {
      const txns = [
        { id: 't1', date: new Date('2026-07-01'), type: 'sale', totalAmount: 1000, paidAmount: 0, invoiceNo: 'INV-1', _count: { items: 1 } },
        { id: 't2', date: new Date('2026-07-03'), type: 'credit-note', totalAmount: 500, paidAmount: 0, invoiceNo: 'CN-1', _count: { items: 1 } },
      ]
      const statement = computeStatementRunningBalance(txns as any, [] as any, 500)
      const note = statement.find((e: any) => e.invoiceNo === 'CN-1')
      // Negative delta = reduces the balance. The old loop did
      // `totalAmount += t.totalAmount`, inflating the debt by ₹500.
      expect(note!.delta).toBeLessThan(0)
      expect(statement[0].runningBalance).toBeCloseTo(500, 2)
    })
  })
})
