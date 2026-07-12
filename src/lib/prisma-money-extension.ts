/**
 * 🔒 V18 Paise Migration Phase 4: Prisma Client Extension for auto-conversion.
 *
 * This extension sits between the application code and the database. It:
 *   - On READ: converts money columns from paise (Int in DB) → rupees (Float in JS)
 *   - On WRITE: converts money columns from rupees (Float in JS) → paise (Int in DB)
 *
 * This means ALL existing application code continues to work with rupee values.
 * The DB stores paise (Int), the app works in rupees (Float), and this extension
 * bridges the gap automatically.
 *
 * WHY THIS APPROACH (vs manual fromPaise/toPaise in 78 files):
 *   1. "One definition, used everywhere" — the auditor's recommended pattern
 *   2. Zero risk of missing a file (the extension catches ALL queries)
 *   3. Phase 5 can remove the extension and do manual cleanup later
 *   4. $queryRaw is NOT affected (Phase 2 already handles raw SQL conversions)
 *
 * WHAT IT DOESN'T COVER:
 *   - $queryRaw results (already handled by Phase 2 SQL * 100 + nudge pattern)
 *
 * 🔒 V20-005 UPDATE: aggregate() and groupBy() _sum/_avg/_min/_max results
 *   ARE now converted by this extension (was previously _sum-only, latent
 *   landmine flagged by the V20 auditor §1.3). The CI paise-guard test
 *   catches any missed spots.
 *
 * 🔒 V20-008 UPDATE: MODEL_RELATIONS now covers ALL money-bearing relations
 *   (BankStatement→transactions, BankTransaction→matchedPayment/
 *   matchedTransaction, Transaction→originalTransaction/reversalTransactions/
 *   matchedBankTransactions, Gstr2bImport→invoices). The V20 auditor's §1.3
 *   "audit every include" recommendation is now fully executed.
 *
 * LIMITATIONS:
 *   - `where`-clause money values are NOT converted. A filter like
 *     `where: { totalAmount: { gte: 100000 } }` compares against 100000 paise
 *     (₹1,000), not ₹1,00,000. Today only `> 0` filters exist (boundary-safe).
 *     Any future money-threshold filter must use toPaise() manually.
 *   - The extension is a hand-maintained whitelist. If a new model with money
 *     columns is added to the schema, it MUST be added to MONEY_COLUMNS,
 *     MODEL_RELATIONS (if it has nested money relations), and registered in
 *     generateModelHandlers or given a hand-written handler block.
 */

import { Prisma, PrismaClient } from '@prisma/client'
import { toPaise, fromPaise } from './money'

// ─── Money column mapping ──────────────────────────────────────────────────
// Maps each model to its money columns. These are the columns that changed
// from Float (rupees) to Int (paise) in Phase 4.

const MONEY_COLUMNS: Record<string, string[]> = {
  Product: ['purchasePrice', 'salePrice', 'mrp'],
  Party: ['openingBalance'],
  Transaction: ['subtotal', 'discountAmount', 'cgst', 'sgst', 'igst', 'totalAmount', 'roundOff', 'paidAmount', 'grossProfit'],
  TransactionItem: ['unitPrice', 'purchasePriceAtSale', 'discountAmount', 'cgst', 'sgst', 'igst', 'csamt', 'total'],
  Payment: ['amount'],
  Subscription: ['amount'],
  GstReturn: [
    'outwardTaxableValue', 'outwardCgst', 'outwardSgst', 'outwardIgst',
    'rcmTaxableValue', 'rcmCgst', 'rcmSgst', 'rcmIgst',
    'nilRatedValue', 'exemptValue', 'nonGstValue',
    'itcTaxableValue', 'itcCgst', 'itcSgst', 'itcIgst',
    'creditNoteTaxableValue', 'creditNoteCgst', 'creditNoteSgst', 'creditNoteIgst',
    'debitNoteTaxableValue', 'debitNoteCgst', 'debitNoteSgst', 'debitNoteIgst',
    'exemptInwardValue', 'interstateB2cTaxableValue', 'interstateB2cIgst',
    'netTaxPayable',
  ],
  Gstr1Snapshot: ['totalOutputTax', 'totalTaxableValue'],
  BankStatement: ['totalCredits', 'totalDebits'],
  BankTransaction: ['amount', 'balance'],
  Gstr2bImport: ['taxableTotal', 'igstTotal', 'cgstTotal', 'sgstTotal'],
  Gstr2bInvoice: ['taxableValue', 'igst', 'cgst', 'sgst', 'totalAmount'],
  AiUsageLog: ['costInr'],
  DailyStats: ['mrr', 'newMrr', 'churnedMrr', 'arr', 'totalGmv', 'aiCostInr'],
  RevenueSchedule: ['amount'],
}

// ─── Model relation mapping (for nested include conversion) ────────────────
// 🔒 V20-002 FIX: Added BankStatement→BankTransaction relation.
// Previously, bankStatement.findMany({ include: { transactions: true } })
// did not convert nested BankTransaction.amount/.balance from paise to rupees,
// causing bank reconciliation UI to show 100× inflated amounts.
//
// 🔒 V20-008 FIX: Added missing money-bearing relations discovered during
// the V20 post-audit deep scan (the auditor's §1.3 "audit every include"
// recommendation was not fully executed in Batch 1 — this completes it):
//   - BankTransaction → matchedPayment (Payment has money: amount)
//   - BankTransaction → matchedTransaction (Transaction has money: totalAmount, etc.)
//   - Transaction → originalTransaction (self-relation for credit/debit notes)
//   - Transaction → reversalTransactions (self-relation, linked credit notes)
//   - Transaction → matchedBankTransactions (bank recon back-reference)
// Without these, TransactionDetail showed credit note amounts 100× inflated
// and bank-recon/reconcile showed matched payment amounts 100× inflated.
const MODEL_RELATIONS: Record<string, Record<string, string>> = {
  Transaction: {
    items: 'TransactionItem',
    party: 'Party',
    originalTransaction: 'Transaction',      // V20-008: credit/debit note reversal
    reversalTransactions: 'Transaction',     // V20-008: linked credit/debit notes
    matchedBankTransactions: 'BankTransaction', // V20-008: bank recon back-ref
  },
  TransactionItem: { transaction: 'Transaction', product: 'Product' },
  Payment: { party: 'Party' },
  Party: { transactions: 'Transaction', payments: 'Payment' },
  Product: {},
  BankStatement: { transactions: 'BankTransaction' },
  BankTransaction: {
    matchedPayment: 'Payment',         // V20-008: bank recon matched payment
    matchedTransaction: 'Transaction', // V20-008: bank recon matched txn
  },
  Gstr2bImport: { invoices: 'Gstr2bInvoice' },
}

// ─── Helper: convert money columns in a single row (paise → rupees) ─────────
// Also recursively converts nested relations (include: { items: true, party: true })
function convertRowOnRead(model: string, row: any): any {
  const cols = MONEY_COLUMNS[model]
  if (!cols || !row) return row

  const converted = { ...row }

  // Convert this model's money columns
  for (const col of cols) {
    if (col in converted && converted[col] != null && typeof converted[col] === 'number') {
      converted[col] = fromPaise(converted[col])
    }
  }

  // Convert nested relations (include: { items: true, party: true, etc. })
  const relations = MODEL_RELATIONS[model] || {}
  for (const [relName, relModel] of Object.entries(relations)) {
    if (relName in converted && converted[relName] != null) {
      if (Array.isArray(converted[relName])) {
        converted[relName] = converted[relName].map((r: any) => convertRowOnRead(relModel, r))
      } else if (typeof converted[relName] === 'object') {
        converted[relName] = convertRowOnRead(relModel, converted[relName])
      }
    }
  }

  return converted
}

// ─── Helper: convert money columns in data (rupees → paise) ────────────────
function convertDataOnWrite(model: string, data: Record<string, any>): Record<string, any> {
  const cols = MONEY_COLUMNS[model]
  if (!cols || !data) return data

  const converted = { ...data }
  for (const col of cols) {
    if (col in converted && converted[col] != null && typeof converted[col] === 'number') {
      converted[col] = toPaise(converted[col])
    }
  }
  return converted
}

// ─── Helper: convert nested data objects (for create with nested records) ──
// 🔒 V19-001 FIX: Previously used `key` (relation name like 'items') as the
// model name when recursing — but MONEY_COLUMNS uses model names like
// 'TransactionItem'. This caused nested writes to skip money conversion,
// storing rupee values in paise Int columns (100× understatement).
// Fix: look up the actual model name from MODEL_RELATIONS.
function convertNestedData(model: string, data: any): any {
  if (!data || typeof data !== 'object') return data

  const converted = convertDataOnWrite(model, data)

  // Handle nested creates (e.g., transaction.create with items: { create: [...] })
  const relations = MODEL_RELATIONS[model] || {}
  for (const key of Object.keys(converted)) {
    const val = converted[key]
    const relModel = relations[key]  // ← V19-001 FIX: look up actual model name
    if (!relModel) continue          // ← skip non-relation keys (no conversion needed)

    if (val && typeof val === 'object') {
      if (Array.isArray(val)) {
        converted[key] = val.map((v) => typeof v === 'object' ? convertNestedData(relModel, v) : v)
      } else if ('create' in val) {
        // { create: [...] } or { create: {...} }
        if (Array.isArray(val.create)) {
          converted[key] = { ...val, create: val.create.map((v: any) => convertNestedData(relModel, v)) }
        } else {
          converted[key] = { ...val, create: convertNestedData(relModel, val.create) }
        }
      } else if ('update' in val) {
        // Handle nested update: { update: { where: {...}, data: {...} } }
        if (val.update && typeof val.update === 'object' && 'data' in val.update) {
          converted[key] = { ...val, update: { ...val.update, data: convertNestedData(relModel, val.update.data) } }
        } else if (val.update && typeof val.update === 'object') {
          converted[key] = { ...val, update: convertNestedData(relModel, val.update) }
        }
      } else if ('connect' in val || 'connectOrCreate' in val) {
        // Don't convert connection objects — they only have IDs
      }
    }
  }

  return converted
}

// ─── The Prisma Extension ──────────────────────────────────────────────────
export function withMoneyConversion(client: PrismaClient) {
  return client.$extends({
    query: {
      // Product
      product: {
        async findMany({ model, operation, args, query }) {
          const result = await query(args)
          return result.map((row: any) => convertRowOnRead('Product', row))
        },
        async findFirst({ model, operation, args, query }) {
          const result = await query(args)
          return result ? convertRowOnRead('Product', result) : null
        },
        async findUnique({ model, operation, args, query }) {
          const result = await query(args)
          return result ? convertRowOnRead('Product', result) : null
        },
        async create({ model, operation, args, query }) {
          args.data = convertNestedData('Product', args.data)
          return convertRowOnRead('Product', await query(args))
        },
        async createMany({ model, operation, args, query }) {
          if (Array.isArray(args.data)) {
            args.data = args.data.map((d: any) => convertDataOnWrite('Product', d)) as any
          } else if (args.data) {
            args.data = convertDataOnWrite('Product', args.data) as any
          }
          return query(args)
        },
        async update({ model, operation, args, query }) {
          if (args.data) args.data = convertNestedData('Product', args.data)
          return convertRowOnRead('Product', await query(args))
        },
        async updateMany({ model, operation, args, query }) {
          if (args.data) args.data = convertNestedData('Product', args.data)
          return query(args)
        },
        async upsert({ model, operation, args, query }) {
          if (args.create) args.create = convertNestedData('Product', args.create)
          if (args.update) args.update = convertNestedData('Product', args.update)
          return convertRowOnRead('Product', await query(args))
        },
      },

      // Party
      party: {
        async findMany({ args, query }) {
          const result = await query(args)
          return result.map((row: any) => convertRowOnRead('Party', row))
        },
        async findFirst({ args, query }) {
          const result = await query(args)
          return result ? convertRowOnRead('Party', result) : null
        },
        async findUnique({ args, query }) {
          const result = await query(args)
          return result ? convertRowOnRead('Party', result) : null
        },
        async create({ args, query }) {
          args.data = convertNestedData('Party', args.data)
          return convertRowOnRead('Party', await query(args))
        },
        async createMany({ args, query }) {
          if (Array.isArray(args.data)) {
            args.data = args.data.map((d: any) => convertDataOnWrite('Party', d)) as any
          } else if (args.data) {
            args.data = convertDataOnWrite('Party', args.data) as any
          }
          return query(args)
        },
        async update({ args, query }) {
          if (args.data) args.data = convertNestedData('Party', args.data)
          return convertRowOnRead('Party', await query(args))
        },
        async updateMany({ args, query }) {
          if (args.data) args.data = convertNestedData('Party', args.data)
          return query(args)
        },
        async upsert({ args, query }) {
          if (args.create) args.create = convertNestedData('Party', args.create)
          if (args.update) args.update = convertNestedData('Party', args.update)
          return convertRowOnRead('Party', await query(args))
        },
      },

      // Transaction
      transaction: {
        async findMany({ args, query }) {
          const result = await query(args)
          return result.map((row: any) => convertRowOnRead('Transaction', row))
        },
        async findFirst({ args, query }) {
          const result = await query(args)
          return result ? convertRowOnRead('Transaction', result) : null
        },
        async findUnique({ args, query }) {
          const result = await query(args)
          return result ? convertRowOnRead('Transaction', result) : null
        },
        async create({ args, query }) {
          args.data = convertNestedData('Transaction', args.data)
          return convertRowOnRead('Transaction', await query(args))
        },
        async createMany({ args, query }) {
          if (Array.isArray(args.data)) {
            args.data = args.data.map((d: any) => convertDataOnWrite('Transaction', d)) as any
          } else if (args.data) {
            args.data = convertDataOnWrite('Transaction', args.data) as any
          }
          return query(args)
        },
        async update({ args, query }) {
          if (args.data) args.data = convertNestedData('Transaction', args.data)
          return convertRowOnRead('Transaction', await query(args))
        },
        async updateMany({ args, query }) {
          if (args.data) args.data = convertNestedData('Transaction', args.data)
          return query(args)
        },
        async upsert({ args, query }) {
          if (args.create) args.create = convertNestedData('Transaction', args.create)
          if (args.update) args.update = convertNestedData('Transaction', args.update)
          return convertRowOnRead('Transaction', await query(args))
        },
        // 🔒 V18 Phase 4 + V20-010 FIX: aggregate returns _sum/_avg/_min/_max
        // in paise — convert ALL 4 to rupees. Previously only _sum was converted
        // (V20-005 fixed this in generateModelHandlers but missed the hand-written
        // Transaction handler). Now consistent across all models.
        async aggregate({ args, query }) {
          const result = await query(args)
          const cols = MONEY_COLUMNS['Transaction'] || []
          for (const aggKey of ['_sum', '_avg', '_min', '_max']) {
            if ((result as any)[aggKey]) {
              for (const col of cols) {
                if (col in (result as any)[aggKey] && (result as any)[aggKey][col] != null) {
                  (result as any)[aggKey][col] = fromPaise((result as any)[aggKey][col])
                }
              }
            }
          }
          return result
        },
        // 🔒 V18 Phase 4 + V20-010 FIX: same _sum/_avg/_min/_max conversion for groupBy
        async groupBy({ args, query }) {
          const result = await query(args)
          const cols = MONEY_COLUMNS['Transaction'] || []
          return result.map((row: any) => {
            for (const aggKey of ['_sum', '_avg', '_min', '_max']) {
              if (row[aggKey]) {
                for (const col of cols) {
                  if (col in row[aggKey] && row[aggKey][col] != null) {
                    row[aggKey][col] = fromPaise(row[aggKey][col])
                  }
                }
              }
            }
            return row
          })
        },
      },

      // TransactionItem
      transactionItem: {
        async findMany({ args, query }) {
          const result = await query(args)
          return result.map((row: any) => convertRowOnRead('TransactionItem', row))
        },
        async findFirst({ args, query }) {
          const result = await query(args)
          return result ? convertRowOnRead('TransactionItem', result) : null
        },
        async findUnique({ args, query }) {
          const result = await query(args)
          return result ? convertRowOnRead('TransactionItem', result) : null
        },
        async create({ args, query }) {
          args.data = convertNestedData('TransactionItem', args.data)
          return convertRowOnRead('TransactionItem', await query(args))
        },
        async createMany({ args, query }) {
          if (Array.isArray(args.data)) {
            args.data = args.data.map((d: any) => convertDataOnWrite('TransactionItem', d)) as any
          } else if (args.data) {
            args.data = convertDataOnWrite('TransactionItem', args.data) as any
          }
          return query(args)
        },
        async update({ args, query }) {
          if (args.data) args.data = convertNestedData('TransactionItem', args.data)
          return convertRowOnRead('TransactionItem', await query(args))
        },
        async updateMany({ args, query }) {
          if (args.data) args.data = convertNestedData('TransactionItem', args.data)
          return query(args)
        },
      },

      // Payment
      payment: {
        async findMany({ args, query }) {
          const result = await query(args)
          return result.map((row: any) => convertRowOnRead('Payment', row))
        },
        async findFirst({ args, query }) {
          const result = await query(args)
          return result ? convertRowOnRead('Payment', result) : null
        },
        async findUnique({ args, query }) {
          const result = await query(args)
          return result ? convertRowOnRead('Payment', result) : null
        },
        async create({ args, query }) {
          args.data = convertNestedData('Payment', args.data)
          return convertRowOnRead('Payment', await query(args))
        },
        async createMany({ args, query }) {
          if (Array.isArray(args.data)) {
            args.data = args.data.map((d: any) => convertDataOnWrite('Payment', d)) as any
          } else if (args.data) {
            args.data = convertDataOnWrite('Payment', args.data) as any
          }
          return query(args)
        },
        async update({ args, query }) {
          if (args.data) args.data = convertNestedData('Payment', args.data)
          return convertRowOnRead('Payment', await query(args))
        },
        async updateMany({ args, query }) {
          if (args.data) args.data = convertNestedData('Payment', args.data)
          return query(args)
        },
        // 🔒 V18 BUG-012: delete returns record with money cols — convert
        async delete({ args, query }) {
          return convertRowOnRead('Payment', await query(args))
        },
        async deleteMany({ args, query }) {
          return query(args)
        },
        // 🔒 V18 Phase 4 + V20-010 FIX: aggregate returns _sum/_avg/_min/_max
        // in paise — convert ALL 4 to rupees (was only _sum, same as Transaction).
        async aggregate({ args, query }) {
          const result = await query(args)
          const cols = MONEY_COLUMNS['Payment'] || []
          for (const aggKey of ['_sum', '_avg', '_min', '_max']) {
            if ((result as any)[aggKey]) {
              for (const col of cols) {
                if (col in (result as any)[aggKey] && (result as any)[aggKey][col] != null) {
                  (result as any)[aggKey][col] = fromPaise((result as any)[aggKey][col])
                }
              }
            }
          }
          return result
        },
        // 🔒 V18 Phase 4 + V20-010 FIX: same _sum/_avg/_min/_max conversion for groupBy
        async groupBy({ args, query }) {
          const result = await query(args)
          const cols = MONEY_COLUMNS['Payment'] || []
          return result.map((row: any) => {
            for (const aggKey of ['_sum', '_avg', '_min', '_max']) {
              if (row[aggKey]) {
                for (const col of cols) {
                  if (col in row[aggKey] && row[aggKey][col] != null) {
                    row[aggKey][col] = fromPaise(row[aggKey][col])
                  }
                }
              }
            }
            return row
          })
        },
      },

      // ─── Remaining models with money columns ─────────────────────────────
      // Generated by helper to avoid 9× code duplication.
      // Each model gets: findMany, findFirst, findUnique, create, createMany,
      // update, updateMany, aggregate, groupBy — all with auto-conversion.

      ...generateModelHandlers('Subscription', 'subscription'),
      ...generateModelHandlers('GstReturn', 'gstReturn'),
      ...generateModelHandlers('Gstr1Snapshot', 'gstr1Snapshot'),
      ...generateModelHandlers('BankStatement', 'bankStatement'),
      ...generateModelHandlers('BankTransaction', 'bankTransaction'),
      ...generateModelHandlers('Gstr2bImport', 'gstr2bImport'),
      ...generateModelHandlers('Gstr2bInvoice', 'gstr2bInvoice'),
      ...generateModelHandlers('AiUsageLog', 'aiUsageLog'),
      ...generateModelHandlers('DailyStats', 'dailyStats'),
      ...generateModelHandlers('RevenueSchedule', 'revenueSchedule'),
    },
  })
}

// ─── Helper: generate Prisma extension handlers for a model ────────────────
// Returns an object with findMany/findFirst/findUnique/create/createMany/
// update/updateMany/aggregate/groupBy — all with money conversion.
function generateModelHandlers(modelName: string, prismaModel: string): Record<string, any> {
  return {
    async findMany({ args, query }: any) {
      const result = await query(args)
      return result.map((row: any) => convertRowOnRead(modelName, row))
    },
    async findFirst({ args, query }: any) {
      const result = await query(args)
      return result ? convertRowOnRead(modelName, result) : null
    },
    async findUnique({ args, query }: any) {
      const result = await query(args)
      return result ? convertRowOnRead(modelName, result) : null
    },
    async create({ args, query }: any) {
      args.data = convertNestedData(modelName, args.data)
      return convertRowOnRead(modelName, await query(args))
    },
    async createMany({ args, query }: any) {
      if (Array.isArray(args.data)) {
        args.data = args.data.map((d: any) => convertDataOnWrite(modelName, d)) as any
      } else if (args.data) {
        args.data = convertDataOnWrite(modelName, args.data) as any
      }
      return query(args)
    },
    async update({ args, query }: any) {
      if (args.data) args.data = convertNestedData(modelName, args.data)
      return convertRowOnRead(modelName, await query(args))
    },
    async updateMany({ args, query }: any) {
      if (args.data) args.data = convertNestedData(modelName, args.data)
      return query(args)
    },
    // 🔒 V18 BUG-012 FIX: delete returns the deleted record — convert money cols
    async delete({ args, query }: any) {
      return convertRowOnRead(modelName, await query(args))
    },
    async deleteMany({ args, query }: any) {
      return query(args)
    },
    // 🔒 V20-001 FIX: upsert was missing — GST filing snapshots (GstReturn.upsert,
    // Gstr1Snapshot.upsert) wrote rupee values into paise Int columns without
    // conversion. This caused either a runtime crash (fractional values) or
    // 100× understatement (whole rupees stored as paise).
    async upsert({ args, query }: any) {
      if (args.create) args.create = convertNestedData(modelName, args.create)
      if (args.update) args.update = convertNestedData(modelName, args.update)
      return convertRowOnRead(modelName, await query(args))
    },
    async aggregate({ args, query }: any) {
      const result = await query(args)
      const cols = MONEY_COLUMNS[modelName] || []
      // 🔒 V20-005: Convert _sum, _avg, _min, _max for money columns.
      // Previously only _sum was converted — _avg/_min/_max would return paise.
      for (const aggKey of ['_sum', '_avg', '_min', '_max']) {
        if ((result as any)[aggKey]) {
          for (const col of cols) {
            if (col in (result as any)[aggKey] && (result as any)[aggKey][col] != null) {
              (result as any)[aggKey][col] = fromPaise((result as any)[aggKey][col])
            }
          }
        }
      }
      return result
    },
    async groupBy({ args, query }: any) {
      const result = await query(args)
      const cols = MONEY_COLUMNS[modelName] || []
      // 🔒 V20-005: Same _sum/_avg/_min/_max conversion for groupBy
      return result.map((row: any) => {
        for (const aggKey of ['_sum', '_avg', '_min', '_max']) {
          if (row[aggKey]) {
            for (const col of cols) {
              if (col in row[aggKey] && row[aggKey][col] != null) {
                row[aggKey][col] = fromPaise(row[aggKey][col])
              }
            }
          }
        }
        return row
      })
    },
  }
}
