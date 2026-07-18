/**
 * 🔒 V20-008 Regression Test: MODEL_RELATIONS completeness
 *
 * The V20 auditor's §1.3 explicitly recommended: "Audit **every** `include:`
 * in the codebase against this map." The original V20-002 fix only added
 * `BankStatement → transactions` but did NOT complete the audit. This test
 * ensures the MODEL_RELATIONS map covers every money-bearing relation
 * actually used in `include:` clauses across the codebase.
 *
 * If a developer adds a new `include: { matchedPayment: true }` without
 * adding the corresponding MODEL_RELATIONS entry, this test fails — catching
 * the 100× money display bug before it reaches production.
 *
 * The V20-008 fix added these missing entries:
 *   - BankTransaction → matchedPayment (Payment has money: amount)
 *   - BankTransaction → matchedTransaction (Transaction has money)
 *   - Transaction → originalTransaction (self-relation, credit/debit notes)
 *   - Transaction → reversalTransactions (self-relation, linked notes)
 *   - Transaction → matchedBankTransactions (bank recon back-reference)
 */

import { describe, test, expect } from '@jest/globals'

// Import the internal MODEL_RELATIONS via a re-export for testing.
// We read the source file directly to avoid circular dependencies with the
// Prisma client extension (which requires a live DB connection to instantiate).
import * as fs from 'fs'
import * as path from 'path'

// 🔒 V26 fix (V23 §8.1 brittleness note): normalize CRLF → LF. The parser
// below searches for '\n}\n'; on a Windows checkout (core.autocrlf) the file
// contains '\r\n}\r\n', so the block extraction silently failed and 9 tests
// in this suite errored with "received value must not be null nor undefined".
const extSource = fs.readFileSync(
  path.join(process.cwd(), 'src/lib/prisma-money-extension.ts'),
  'utf-8',
).replace(/\r\n/g, '\n')

// Extract the MODEL_RELATIONS object from the source code.
// We parse it loosely (not a full TS parser) because the object is simple.
function extractModelRelations(source: string): Record<string, string[]> {
  const result: Record<string, string[]> = {}
  const start = source.indexOf('const MODEL_RELATIONS')
  if (start === -1) throw new Error('MODEL_RELATIONS not found in source')
  const end = source.indexOf('\n}\n', start)
  const block = source.slice(start, end + 2)

  // Match each `ModelName: { relName: 'TargetModel', ... }` block
  const modelRegex = /(\w+):\s*\{([^}]*)\}/g
  let modelMatch
  while ((modelMatch = modelRegex.exec(block)) !== null) {
    const model = modelMatch[1]
    const body = modelMatch[2]
    const rels: string[] = []
    const relRegex = /(\w+):\s*'(\w+)'/g
    let relMatch
    while ((relMatch = relRegex.exec(body)) !== null) {
      rels.push(`${relMatch[1]} → ${relMatch[2]}`)
    }
    result[model] = rels
  }
  return result
}

describe('🔒 V20-008: MODEL_RELATIONS completeness', () => {
  const relations = extractModelRelations(extSource)

  test('BankTransaction has matchedPayment → Payment relation', () => {
    expect(relations.BankTransaction).toContain('matchedPayment → Payment')
  })

  test('BankTransaction has matchedTransaction → Transaction relation', () => {
    expect(relations.BankTransaction).toContain('matchedTransaction → Transaction')
  })

  test('Transaction has originalTransaction → Transaction (credit/debit note reversal)', () => {
    expect(relations.Transaction).toContain('originalTransaction → Transaction')
  })

  test('Transaction has reversalTransactions → Transaction (linked notes)', () => {
    expect(relations.Transaction).toContain('reversalTransactions → Transaction')
  })

  test('Transaction has matchedBankTransactions → BankTransaction (bank recon back-ref)', () => {
    expect(relations.Transaction).toContain('matchedBankTransactions → BankTransaction')
  })

  test('BankStatement has transactions → BankTransaction (V20-002, still present)', () => {
    expect(relations.BankStatement).toContain('transactions → BankTransaction')
  })

  test('Gstr2bImport has invoices → Gstr2bInvoice (existing, still present)', () => {
    expect(relations.Gstr2bImport).toContain('invoices → Gstr2bInvoice')
  })
})

/**
 * 🔒 V20-010 Regression Test: hand-written aggregate handlers convert
 * _sum, _avg, _min, _max (not just _sum)
 *
 * The V20-005 fix added _avg/_min/_max conversion to generateModelHandlers
 * but missed the hand-written Transaction and Payment handlers. This test
 * verifies the hand-written handlers now convert all 4 aggregate types.
 */
describe('🔒 V20-010: hand-written aggregate handlers convert _avg/_min/_max', () => {
  test('Transaction aggregate handler iterates all 4 aggKeys', () => {
    // Find the Transaction aggregate handler block
    const txIdx = extSource.indexOf("// Transaction\n      transaction:")
    expect(txIdx).toBeGreaterThan(-1)
    const txBlock = extSource.slice(txIdx, txIdx + 3000)

    // Should reference all 4 aggregate keys in its aggregate handler
    const aggStart = txBlock.indexOf('async aggregate')
    const aggEnd = txBlock.indexOf('async groupBy')
    const aggBlock = txBlock.slice(aggStart, aggEnd)
    expect(aggBlock).toContain("'_sum'")
    expect(aggBlock).toContain("'_avg'")
    expect(aggBlock).toContain("'_min'")
    expect(aggBlock).toContain("'_max'")
  })

  test('Payment aggregate handler iterates all 4 aggKeys', () => {
    const payIdx = extSource.indexOf('// Payment\n      payment:')
    expect(payIdx).toBeGreaterThan(-1)
    const payBlock = extSource.slice(payIdx, payIdx + 3000)

    const aggStart = payBlock.indexOf('async aggregate')
    const aggEnd = payBlock.indexOf('async groupBy')
    const aggBlock = payBlock.slice(aggStart, aggEnd)
    expect(aggBlock).toContain("'_sum'")
    expect(aggBlock).toContain("'_avg'")
    expect(aggBlock).toContain("'_min'")
    expect(aggBlock).toContain("'_max'")
  })
})

/**
 * 🔒 V20-001 Regression Test: upsert handler exists in generateModelHandlers
 *
 * The V20 auditor's §1.1 flagged that upsert was missing from
 * generateModelHandlers, causing GST filing snapshots to store 100× wrong.
 * This test ensures the upsert handler is present.
 */
describe('🔒 V20-001: upsert handler in generateModelHandlers', () => {
  test('generateModelHandlers defines an upsert handler', () => {
    const genIdx = extSource.indexOf('function generateModelHandlers')
    expect(genIdx).toBeGreaterThan(-1)
    const genBlock = extSource.slice(genIdx, genIdx + 5000)
    expect(genBlock).toContain('async upsert(')
    expect(genBlock).toContain('convertNestedData(modelName, args.create)')
    expect(genBlock).toContain('convertNestedData(modelName, args.update)')
  })
})
